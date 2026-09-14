import { isSupportedInvoiceCurrency } from "@/lib/invoices/currencies";
import {
  INVOICE_DISCOUNT_TYPES,
  INVOICE_TAX_LABELS,
  type InvoiceDiscountTypeValue,
  type InvoiceTaxLabelValue,
} from "@/lib/validation/invoice";
import type { QuoteCalculationError, QuoteLineItemInput } from "@/lib/quotes/calculations";

/**
 * Quote Templates Phase 1. Deliberately a NEW, independent parser — never
 * imports from src/lib/validation/quote.ts's own parseQuoteInput (which is
 * coupled to Quote-only fields this model doesn't have: number, target,
 * issueDate, validUntil as an absolute date). Reuses the exact same
 * underlying, already domain-neutral primitives that file itself imports
 * (INVOICE_DISCOUNT_TYPES, INVOICE_TAX_LABELS, isSupportedInvoiceCurrency)
 * — never re-derives them — so a Quote Template can never accept
 * discount/tax/currency data that ordinary Quote creation would reject,
 * without this module forking or touching src/lib/validation/quote.ts or
 * src/lib/validation/invoice.ts at all.
 *
 * Numeric/range validation for items + discount + tax (decimal precision,
 * bounds, "discount can't exceed subtotal", etc.) is deliberately NOT
 * duplicated here — see mapQuoteTemplateCalculationError below, which maps
 * calculateQuoteTotals()'s own error codes (the exact same function real
 * Quote creation calls) onto this module's field-error shape. This file's
 * own job is structural/format parsing only, exactly mirroring
 * parseQuoteInput's own division of labor between itself and
 * calculateQuoteTotals.
 */

// Matches TAG_NAME_MAX_LENGTH's own "bounded free-text field" convention
// (src/lib/tags/normalize.ts) — a short reference label, not an essay.
export const QUOTE_TEMPLATE_NAME_MAX_LENGTH = 100;
// Matches QUOTE_TITLE_MAX_LENGTH exactly (src/lib/validation/quote.ts) —
// this value is copied verbatim onto the new Quote's own `title` field.
export const QUOTE_TEMPLATE_TITLE_MAX_LENGTH = 200;
// Matches QUOTE_NOTES_MAX_LENGTH exactly.
export const QUOTE_TEMPLATE_NOTES_MAX_LENGTH = 10_000;

// A relative day-count, not an absolute date (see QuoteTemplate.validityDays's
// own schema comment). Minimum 1 — 0 must never silently mean "today"
// (indistinguishable from "expires immediately", almost certainly not
// what anyone setting it means); a template that should have NO default
// validity simply leaves this field null instead. Maximum 3650 (10
// years) — generous enough for any real business validity window, bounded
// enough to reject an obviously-mistyped value (e.g. a year typed into a
// days field).
export const QUOTE_TEMPLATE_VALIDITY_DAYS_MIN = 1;
export const QUOTE_TEMPLATE_VALIDITY_DAYS_MAX = 3650;

export type QuoteTemplateFieldErrors = Partial<
  Record<"name" | "title" | "notes" | "currency" | "discountType" | "discountValue" | "taxRatePercent" | "taxLabel" | "validityDays" | "items", string>
>;

export type QuoteTemplateItemErrors = Partial<Record<number, Partial<Record<"description" | "quantity" | "unitPrice", string>>>>;

function trimmedOrNull(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Every field a caller may ever supply directly to create/update a Quote
 * Template's own content. Deliberately excludes organizationId,
 * createdByUserId, archivedAt, createdAt/updatedAt — none of these are
 * ever caller-supplied (see service.ts).
 */
export type QuoteTemplateWritableInput = {
  name: unknown;
  title?: unknown;
  notes?: unknown;
  currency: unknown;
  discountType?: unknown;
  discountValue?: unknown;
  taxRatePercent?: unknown;
  taxLabel?: unknown;
  validityDays?: unknown;
  items: unknown;
};

export type ParsedQuoteTemplateValues = {
  name: string;
  title: string | null;
  notes: string | null;
  currency: string;
  discountType: InvoiceDiscountTypeValue;
  discountValue: string | null;
  taxRatePercent: string | null;
  taxLabel: InvoiceTaxLabelValue;
  validityDays: number | null;
  items: QuoteLineItemInput[];
};

/** Format-only item parsing — mirrors src/lib/validation/quote.ts's own parseRawItem/parseItems exactly (never trusts `position` from the caller; positions are always server-assigned, contiguous 0..n-1, matching QuoteItem's own documented contract). */
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

function parseItems(raw: unknown): { fieldError?: string; itemErrors?: QuoteTemplateItemErrors; items: QuoteLineItemInput[] } {
  if (!Array.isArray(raw)) {
    return { items: [] };
  }
  if (raw.length > 500) {
    return { fieldError: "This item list is too large.", items: [] };
  }

  const items: QuoteLineItemInput[] = [];
  let itemErrors: QuoteTemplateItemErrors | undefined;

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

function parseValidityDays(raw: unknown): { value: number | null; error?: string } {
  const trimmed = trimmedOrNull(raw);
  if (!trimmed) return { value: null };

  if (!/^\d+$/.test(trimmed)) {
    return { value: null, error: "Enter a whole number of days." };
  }
  const value = Number(trimmed);
  if (value < QUOTE_TEMPLATE_VALIDITY_DAYS_MIN || value > QUOTE_TEMPLATE_VALIDITY_DAYS_MAX) {
    return { value: null, error: `Enter a value between ${QUOTE_TEMPLATE_VALIDITY_DAYS_MIN} and ${QUOTE_TEMPLATE_VALIDITY_DAYS_MAX}.` };
  }
  return { value };
}

export function parseQuoteTemplateInput(input: QuoteTemplateWritableInput): {
  values: ParsedQuoteTemplateValues;
  fieldErrors: QuoteTemplateFieldErrors;
  itemErrors?: QuoteTemplateItemErrors;
} {
  const name = trimmedOrNull(input.name) ?? "";
  const title = trimmedOrNull(input.title);
  const notes = trimmedOrNull(input.notes);
  const currencyRaw = trimmedOrNull(input.currency)?.toUpperCase() ?? "";

  const fieldErrors: QuoteTemplateFieldErrors = {};

  if (!name) {
    fieldErrors.name = "Template name is required.";
  } else if (name.length > QUOTE_TEMPLATE_NAME_MAX_LENGTH) {
    fieldErrors.name = `Must be ${QUOTE_TEMPLATE_NAME_MAX_LENGTH} characters or fewer.`;
  }

  if (title && title.length > QUOTE_TEMPLATE_TITLE_MAX_LENGTH) {
    fieldErrors.title = `Must be ${QUOTE_TEMPLATE_TITLE_MAX_LENGTH} characters or fewer.`;
  }

  if (notes && notes.length > QUOTE_TEMPLATE_NOTES_MAX_LENGTH) {
    fieldErrors.notes = `Must be ${QUOTE_TEMPLATE_NOTES_MAX_LENGTH} characters or fewer.`;
  }

  if (!currencyRaw) {
    fieldErrors.currency = "Select a currency.";
  } else if (!isSupportedInvoiceCurrency(currencyRaw)) {
    fieldErrors.currency = "This currency isn't supported for quotes.";
  }

  const discountTypeRaw = String(input.discountType ?? "NONE");
  const isValidDiscountType = (INVOICE_DISCOUNT_TYPES as readonly string[]).includes(discountTypeRaw);
  if (!isValidDiscountType) {
    fieldErrors.discountType = "Select a valid discount type.";
  }
  const discountType: InvoiceDiscountTypeValue = isValidDiscountType ? (discountTypeRaw as InvoiceDiscountTypeValue) : "NONE";

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

  const { value: validityDays, error: validityDaysError } = parseValidityDays(input.validityDays);
  if (validityDaysError) {
    fieldErrors.validityDays = validityDaysError;
  }

  const { fieldError: itemsFieldError, itemErrors, items } = parseItems(input.items);
  if (itemsFieldError) {
    fieldErrors.items = itemsFieldError;
  }

  return {
    values: { name, title, notes, currency: currencyRaw, discountType, discountValue, taxRatePercent, taxLabel, validityDays, items },
    fieldErrors,
    itemErrors,
  };
}

export function hasQuoteTemplateFormErrors(fieldErrors: QuoteTemplateFieldErrors, itemErrors?: QuoteTemplateItemErrors): boolean {
  return Boolean(Object.keys(fieldErrors).length > 0 || (itemErrors && Object.keys(itemErrors).length > 0));
}

/**
 * Maps calculateQuoteTotals()'s own error codes onto this module's
 * field-error shape — a Quote-Template-specific analog of
 * src/lib/validation/quote.ts's own mapQuoteCalculationError, kept as an
 * independent, small copy (never imported from that file, which returns
 * Quote's own QuoteFieldErrors shape and would otherwise couple this
 * module to Quote's exact field set) rather than a shared abstraction —
 * the two are identical in spirit, not in type. EMPTY_LINE_ITEMS is a
 * real, reachable case here (unlike Quote's own callers, a Quote Template
 * is created directly from this module, not from a Quote-specific action
 * that separately enforces "at least one item" upstream) — mapped the
 * same way Quote's own version already does.
 */
export function mapQuoteTemplateCalculationError(error: QuoteCalculationError): {
  fieldErrors?: QuoteTemplateFieldErrors;
  itemErrors?: QuoteTemplateItemErrors;
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
      // Structurally unreachable -- a Quote Template always calls
      // calculateQuoteTotals with subtotalSource.mode: "lineItems", never
      // "flat" (see service.ts). Kept as an exhaustive switch case so
      // this function still compiles against QuoteCalculationError's full
      // union without a runtime default branch masking a real future gap.
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
      return { fieldErrors: { items: "This template's total is out of range." } };
  }
}
