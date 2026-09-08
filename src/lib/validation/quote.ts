import { parseDateOnly } from "@/lib/invoices/date-only";
import { isSupportedInvoiceCurrency } from "@/lib/invoices/currencies";
import { isUuid } from "@/lib/validation/lead";
import {
  INVOICE_DISCOUNT_TYPES,
  INVOICE_TAX_LABELS,
  type InvoiceDiscountTypeValue,
  type InvoiceTaxLabelValue,
} from "@/lib/validation/invoice";
import type { QuoteCalculationError, QuoteLineItemInput } from "@/lib/quotes/calculations";

/**
 * Quotes / Estimates Phase 2. Plain-object input, not FormData — no Quote
 * form UI exists yet (a later phase), matching Leads Phase 2's own exact
 * precedent (src/lib/validation/lead.ts's own header comment) exactly:
 * every action below takes these already-typed inputs directly; a future
 * form layer can build a FormData -> this-shape adapter without this
 * module changing at all.
 *
 * Reuses Invoice's own discount/tax enums and currency/date-only helpers
 * directly (INVOICE_DISCOUNT_TYPES, INVOICE_TAX_LABELS,
 * isSupportedInvoiceCurrency, parseDateOnly) — all four are already fully
 * domain-neutral (see src/lib/quotes/calculations.ts's own header comment
 * for the identical reasoning already proven for calculateInvoiceTotals),
 * so mirroring Invoice's validation semantics here means importing the
 * same functions, never re-deriving them.
 *
 * Unlike Invoice, a Quote has no "flat amount" mode — every Quote is
 * itemized (see this module's own `items` field below); there is no
 * `mode`/`amount` field to parse at all.
 */

// No existing Invoice precedent bounds invoiceNumber's own length (it has
// none today) — this is a deliberately conservative cap for a real
// reference number, not an essay, chosen independently rather than
// inheriting an absent bound.
export const QUOTE_NUMBER_MAX_LENGTH = 50;
export const QUOTE_TITLE_MAX_LENGTH = 200;
// Matches this app's one existing convention for a large freeform text
// field (INVOICE_NOTES_MAX_LENGTH, LEAD_NOTES_MAX_LENGTH).
export const QUOTE_NOTES_MAX_LENGTH = 10_000;
export const QUOTE_RECIPIENT_NAME_MAX_LENGTH = 200;
export const QUOTE_RECIPIENT_EMAIL_MAX_LENGTH = 320; // RFC 5321 maximum

export type QuoteFieldErrors = Partial<
  Record<
    | "number"
    | "title"
    | "target"
    | "issueDate"
    | "validUntil"
    | "currency"
    | "notes"
    | "discountType"
    | "discountValue"
    | "taxRatePercent"
    | "taxLabel"
    | "items",
    string
  >
>;

export type QuoteItemErrors = Partial<Record<number, Partial<Record<"description" | "quantity" | "unitPrice", string>>>>;

function trimmedOrNull(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Every field a caller may ever supply directly to create/update a
 * Quote's own content. Deliberately excludes organizationId, status,
 * subtotal/discountAmount/taxAmount/total (always server-recalculated —
 * see calculateQuoteTotals), approvedAt/declinedAt/sentAt (each only
 * ever set by its own dedicated lifecycle action), convertedInvoiceId,
 * createdByUserId, archivedAt, createdAt/updatedAt, and
 * recipientName/recipientEmail (derived server-side during send — see
 * sendQuoteAction — never accepted as an authoritative snapshot from the
 * caller).
 */
export type QuoteWritableInput = {
  number: unknown;
  title?: unknown;
  leadId?: unknown;
  clientId?: unknown;
  issueDate: unknown;
  validUntil?: unknown;
  currency: unknown;
  notes?: unknown;
  discountType?: unknown;
  discountValue?: unknown;
  taxRatePercent?: unknown;
  taxLabel?: unknown;
  items: unknown;
};

export type ParsedQuoteTarget =
  | { kind: "client"; clientId: string }
  | { kind: "lead"; leadId: string };

export type ParsedQuoteValues = {
  number: string;
  title: string | null;
  target: ParsedQuoteTarget | null;
  issueDate: Date;
  validUntil: Date | null;
  currency: string;
  notes: string | null;
  discountType: InvoiceDiscountTypeValue;
  discountValue: string | null;
  taxRatePercent: string | null;
  taxLabel: InvoiceTaxLabelValue;
  items: QuoteLineItemInput[];
};

export type ParseQuoteInputResult =
  | { ok: true; values: ParsedQuoteValues }
  | { ok: false; fieldErrors: QuoteFieldErrors; itemErrors?: QuoteItemErrors };

/**
 * Parses a single raw item entry into a well-shaped
 * {description, quantity, unitPrice} triple — format only (a string
 * description, a quantity/unitPrice that at least look like a decimal
 * input). The actual numeric range/precision validation (matching
 * Invoice's own Decimal(10,3)/Decimal(10,2) bounds exactly) happens later,
 * inside calculateQuoteTotals — this function's only job is rejecting a
 * structurally malformed entry before that pure calculation function ever
 * sees it.
 */
function parseRawItem(raw: unknown): { ok: true; item: QuoteLineItemInput } | { ok: false } {
  if (typeof raw !== "object" || raw === null) return { ok: false };
  const record = raw as Record<string, unknown>;
  const description = String(record.description ?? "");
  const quantity = record.quantity;
  const unitPrice = record.unitPrice;
  if (
    (typeof quantity !== "string" && typeof quantity !== "number") ||
    (typeof unitPrice !== "string" && typeof unitPrice !== "number")
  ) {
    return { ok: false };
  }
  return { ok: true, item: { description, quantity, unitPrice } };
}

/**
 * Parses the `items` field into a QuoteLineItemInput[] — never trusts
 * `position` from the caller (positions are always server-assigned,
 * contiguous 0..n-1, in the action itself, matching InvoiceLineItem's own
 * documented contract exactly). Returns a field error on `items` for a
 * missing/non-array/oversized submission, or a per-index item error for
 * a single malformed entry — the same two-tier error shape
 * parseInvoiceForm's own lineItems decoding already uses.
 */
function parseItems(raw: unknown): { fieldError?: string; itemErrors?: QuoteItemErrors; items: QuoteLineItemInput[] } {
  if (!Array.isArray(raw)) {
    return { fieldError: "Add at least one item.", items: [] };
  }
  if (raw.length === 0) {
    return { fieldError: "Add at least one item.", items: [] };
  }
  // MAX_QUOTE_LINE_ITEMS itself is enforced later by calculateQuoteTotals
  // (TOO_MANY_LINE_ITEMS) — this is only a defensive upper bound so an
  // absurdly large payload never even reaches that pure function's own
  // loop.
  if (raw.length > 500) {
    return { fieldError: "This item list is too large.", items: [] };
  }

  const items: QuoteLineItemInput[] = [];
  let itemErrors: QuoteItemErrors | undefined;

  raw.forEach((entry, index) => {
    const parsed = parseRawItem(entry);
    if (!parsed.ok) {
      itemErrors = { ...(itemErrors ?? {}), [index]: { description: "This item is invalid." } };
      return;
    }
    items.push(parsed.item);
  });

  return { itemErrors, items };
}

/**
 * Format-only target validation: creation/update must supply exactly one
 * of leadId/clientId, each a well-formed UUID. Whether that id actually
 * belongs to a real Lead/Client in the caller's own organization — and,
 * for an already-converted Lead, upgrading the target to carry both ids —
 * is resolved server-side by src/lib/quotes/target.ts's own
 * resolveQuoteTarget(), which this parser deliberately never calls (no
 * database read in this pure module).
 */
function parseTarget(leadIdRaw: unknown, clientIdRaw: unknown): { target: ParsedQuoteTarget | null; error?: string } {
  const leadId = trimmedOrNull(leadIdRaw);
  const clientId = trimmedOrNull(clientIdRaw);

  if (leadId && clientId) {
    return { target: null, error: "Provide either a lead or a client, not both." };
  }
  if (!leadId && !clientId) {
    return { target: null, error: "Select a lead or a client." };
  }
  if (leadId) {
    if (!isUuid(leadId)) {
      return { target: null, error: "Select a valid lead." };
    }
    return { target: { kind: "lead", leadId } };
  }
  // clientId is guaranteed non-null here (the !leadId && !clientId case
  // above already returned).
  if (!isUuid(clientId as string)) {
    return { target: null, error: "Select a valid client." };
  }
  return { target: { kind: "client", clientId: clientId as string } };
}

export function parseQuoteInput(input: QuoteWritableInput): {
  values: ParsedQuoteValues;
  fieldErrors: QuoteFieldErrors;
  itemErrors?: QuoteItemErrors;
} {
  const number = trimmedOrNull(input.number) ?? "";
  const title = trimmedOrNull(input.title);
  const currencyRaw = trimmedOrNull(input.currency)?.toUpperCase() ?? "";
  const notes = trimmedOrNull(input.notes);

  const fieldErrors: QuoteFieldErrors = {};

  if (!number) {
    fieldErrors.number = "Quote number is required.";
  } else if (number.length > QUOTE_NUMBER_MAX_LENGTH) {
    fieldErrors.number = `Must be ${QUOTE_NUMBER_MAX_LENGTH} characters or fewer.`;
  }

  if (title && title.length > QUOTE_TITLE_MAX_LENGTH) {
    fieldErrors.title = `Must be ${QUOTE_TITLE_MAX_LENGTH} characters or fewer.`;
  }

  const { target, error: targetError } = parseTarget(input.leadId, input.clientId);
  if (targetError) {
    fieldErrors.target = targetError;
  }

  let issueDate: Date | null = null;
  const issueDateParsed = parseDateOnly(trimmedOrNull(input.issueDate) ?? "");
  if (!issueDateParsed.ok) {
    fieldErrors.issueDate = "Enter a valid issue date.";
  } else {
    issueDate = issueDateParsed.date;
  }

  let validUntil: Date | null = null;
  const validUntilRaw = trimmedOrNull(input.validUntil);
  if (validUntilRaw) {
    const validUntilParsed = parseDateOnly(validUntilRaw);
    if (!validUntilParsed.ok) {
      fieldErrors.validUntil = "Enter a valid date.";
    } else {
      validUntil = validUntilParsed.date;
      if (issueDate && validUntil.getTime() < issueDate.getTime()) {
        fieldErrors.validUntil = "Cannot be earlier than the issue date.";
      }
    }
  }

  if (!currencyRaw) {
    fieldErrors.currency = "Select a currency.";
  } else if (!isSupportedInvoiceCurrency(currencyRaw)) {
    fieldErrors.currency = "This currency isn't supported for quotes.";
  }

  if (notes && notes.length > QUOTE_NOTES_MAX_LENGTH) {
    fieldErrors.notes = `Must be ${QUOTE_NOTES_MAX_LENGTH} characters or fewer.`;
  }

  const discountTypeRaw = String(input.discountType ?? "NONE");
  const isValidDiscountType = (INVOICE_DISCOUNT_TYPES as readonly string[]).includes(discountTypeRaw);
  if (!isValidDiscountType) {
    fieldErrors.discountType = "Select a valid discount type.";
  }
  const discountType: InvoiceDiscountTypeValue = isValidDiscountType
    ? (discountTypeRaw as InvoiceDiscountTypeValue)
    : "NONE";

  let discountValue: string | null = null;
  if (discountType !== "NONE") {
    const raw = trimmedOrNull(input.discountValue);
    if (!raw) {
      fieldErrors.discountValue = "Enter a discount value.";
    } else {
      discountValue = raw;
    }
  }

  const taxRatePercent = trimmedOrNull(input.taxRatePercent);

  const taxLabelRaw = String(input.taxLabel ?? "TAX");
  const isValidTaxLabel = (INVOICE_TAX_LABELS as readonly string[]).includes(taxLabelRaw);
  if (!isValidTaxLabel) {
    fieldErrors.taxLabel = "Select a valid tax label.";
  }
  const taxLabel: InvoiceTaxLabelValue = isValidTaxLabel ? (taxLabelRaw as InvoiceTaxLabelValue) : "TAX";

  const { fieldError: itemsFieldError, itemErrors, items } = parseItems(input.items);
  if (itemsFieldError) {
    fieldErrors.items = itemsFieldError;
  }

  return {
    values: {
      number,
      title,
      target,
      issueDate: issueDate ?? new Date(0),
      validUntil,
      currency: currencyRaw,
      notes,
      discountType,
      discountValue,
      taxRatePercent,
      taxLabel,
      items,
    },
    fieldErrors,
    itemErrors,
  };
}

export function hasQuoteFormErrors(fieldErrors: QuoteFieldErrors, itemErrors?: QuoteItemErrors): boolean {
  return Boolean(Object.keys(fieldErrors).length > 0 || (itemErrors && Object.keys(itemErrors).length > 0));
}

/**
 * Maps every calculateQuoteTotals() error code to Quote's own field-error
 * shape — a thin, quote-specific analog of
 * src/lib/validation/invoice.ts's own mapInvoiceCalculationError, never
 * re-deriving the underlying calculation logic itself (see
 * src/lib/quotes/calculations.ts's own header comment). Differs only in
 * the field name for line items (`items`, matching Quote's own field name,
 * not Invoice's `lineItems`) and in never handling INVALID_FLAT_AMOUNT/
 * EMPTY_LINE_ITEMS's flat-mode branch — a Quote has no flat-amount mode
 * at all (see this module's own header comment).
 */
export function mapQuoteCalculationError(error: QuoteCalculationError): {
  fieldErrors?: QuoteFieldErrors;
  itemErrors?: QuoteItemErrors;
} {
  switch (error.code) {
    case "EMPTY_LINE_ITEMS":
      return { fieldErrors: { items: "Add at least one item." } };
    case "TOO_MANY_LINE_ITEMS":
      return { fieldErrors: { items: "You can add at most 200 items." } };
    case "EMPTY_DESCRIPTION":
      return { itemErrors: { [error.index]: { description: "Enter a description." } } };
    case "DESCRIPTION_TOO_LONG":
      return { itemErrors: { [error.index]: { description: "Description is too long (max 500 characters)." } } };
    case "ZERO_OR_NEGATIVE_QUANTITY":
      return { itemErrors: { [error.index]: { quantity: "Enter a quantity greater than zero." } } };
    case "QUANTITY_TOO_PRECISE":
      return { itemErrors: { [error.index]: { quantity: "Quantity allows at most 3 decimal places." } } };
    case "QUANTITY_OUT_OF_RANGE":
      return { itemErrors: { [error.index]: { quantity: "Quantity is too large." } } };
    case "NEGATIVE_UNIT_PRICE":
      return { itemErrors: { [error.index]: { unitPrice: "Enter a unit price of zero or more." } } };
    case "UNIT_PRICE_TOO_PRECISE":
      return { itemErrors: { [error.index]: { unitPrice: "Unit price allows at most 2 decimal places." } } };
    case "UNIT_PRICE_OUT_OF_RANGE":
      return { itemErrors: { [error.index]: { unitPrice: "Unit price is too large." } } };
    case "INVALID_FLAT_AMOUNT":
      // Structurally unreachable — a Quote always calls calculateQuoteTotals
      // with subtotalSource.mode: "lineItems" (see the actions module),
      // never "flat". Kept as an exhaustive switch case so this function
      // still compiles against QuoteCalculationError's full union without
      // a runtime default branch masking a real future gap.
      return { fieldErrors: { items: "Add at least one item." } };
    case "DISCOUNT_PERCENTAGE_OUT_OF_RANGE":
      return { fieldErrors: { discountValue: "Enter a discount percentage between 0 and 100." } };
    case "DISCOUNT_VALUE_INVALID":
      return { fieldErrors: { discountValue: "Enter a valid discount amount." } };
    case "DISCOUNT_EXCEEDS_SUBTOTAL":
      return { fieldErrors: { discountValue: "Discount cannot exceed the subtotal." } };
    case "TAX_RATE_OUT_OF_RANGE":
      return { fieldErrors: { taxRatePercent: "Enter a tax rate between 0 and 100." } };
    case "TOTAL_OUT_OF_RANGE":
      return { fieldErrors: { items: "This quote's total is out of range." } };
  }
}
