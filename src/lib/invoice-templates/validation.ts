import { isSupportedInvoiceCurrency } from "@/lib/invoices/currencies";
import {
  INVOICE_DISCOUNT_TYPES,
  INVOICE_TAX_LABELS,
  INVOICE_NOTES_MAX_LENGTH,
  type InvoiceDiscountTypeValue,
  type InvoiceTaxLabelValue,
} from "@/lib/validation/invoice";
import type { InvoiceCalculationError, LineItemInput } from "@/lib/invoices/calculations";

/**
 * Invoice Templates V1. Deliberately a NEW, independent parser — never
 * imports Invoice's own create/update parser (coupled to Invoice-only
 * fields this model doesn't have: invoiceNumber, client/project, mode,
 * issueDate, an absolute dueDate, status). Reuses the exact same
 * underlying, already domain-neutral primitives that module itself
 * imports (INVOICE_DISCOUNT_TYPES, INVOICE_TAX_LABELS,
 * isSupportedInvoiceCurrency, INVOICE_NOTES_MAX_LENGTH) — never
 * re-derives them — so an Invoice Template can never accept discount/
 * tax/currency/notes data that ordinary Invoice creation would reject.
 * Mirrors src/lib/quote-templates/validation.ts's own identical division
 * of labor exactly.
 *
 * Numeric/range validation for items + discount + tax is deliberately
 * NOT duplicated here — see mapInvoiceTemplateCalculationError below,
 * which maps calculateInvoiceTotals()'s own error codes (the exact same
 * function real Invoice creation calls) onto this module's field-error
 * shape.
 */

export const INVOICE_TEMPLATE_NAME_MAX_LENGTH = 100;
// Matches INVOICE_NOTES_MAX_LENGTH exactly (src/lib/validation/invoice.ts)
// — reused for both notes and internalNotes, the same way Invoice's own
// parser applies one shared limit to both fields.
export const INVOICE_TEMPLATE_NOTES_MAX_LENGTH = INVOICE_NOTES_MAX_LENGTH;

// A relative day-count, not an absolute date (see
// InvoiceTemplate.dueDateOffsetDays's own schema comment). Minimum 0 is
// allowed here (unlike QuoteTemplate.validityDays' minimum of 1) — a due
// date equal to the issue date ("due on receipt") is a genuine, common
// Invoice term, not an ambiguous "expires immediately" the way a Quote's
// validity window would be. Maximum 3650 (10 years), matching
// QuoteTemplate's own bound.
export const INVOICE_TEMPLATE_DUE_DATE_OFFSET_DAYS_MIN = 0;
export const INVOICE_TEMPLATE_DUE_DATE_OFFSET_DAYS_MAX = 3650;

export type InvoiceTemplateFieldErrors = Partial<
  Record<"name" | "currency" | "discountType" | "discountValue" | "taxRatePercent" | "taxLabel" | "notes" | "internalNotes" | "dueDateOffsetDays" | "items", string>
>;

export type InvoiceTemplateItemErrors = Partial<Record<number, Partial<Record<"description" | "quantity" | "unitPrice", string>>>>;

function trimmedOrNull(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Every field a caller may ever supply directly to create/update an
 * Invoice Template's own content. Deliberately excludes organizationId,
 * createdByUserId, archivedAt, createdAt/updatedAt — none of these are
 * ever caller-supplied (see service.ts). Deliberately excludes clientId/
 * projectId — Invoice Templates V1 never accepts either (Product Owner
 * decision; see InvoiceTemplate's own schema comment).
 */
export type InvoiceTemplateWritableInput = {
  name: unknown;
  currency: unknown;
  discountType?: unknown;
  discountValue?: unknown;
  taxRatePercent?: unknown;
  taxLabel?: unknown;
  notes?: unknown;
  internalNotes?: unknown;
  dueDateOffsetDays?: unknown;
  items: unknown;
};

export type ParsedInvoiceTemplateValues = {
  name: string;
  currency: string;
  discountType: InvoiceDiscountTypeValue;
  discountValue: string | null;
  taxRatePercent: string | null;
  taxLabel: InvoiceTaxLabelValue;
  notes: string | null;
  internalNotes: string | null;
  dueDateOffsetDays: number | null;
  items: LineItemInput[];
};

/** Format-only item parsing — mirrors src/lib/quote-templates/validation.ts's own parseRawItem/parseItems exactly (never trusts `position` from the caller; positions are always server-assigned, contiguous 0..n-1). */
function parseRawItem(raw: unknown): { ok: true; item: LineItemInput } | { ok: false } {
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

function parseItems(raw: unknown): { fieldError?: string; itemErrors?: InvoiceTemplateItemErrors; items: LineItemInput[] } {
  if (!Array.isArray(raw)) {
    return { items: [] };
  }
  if (raw.length > 500) {
    return { fieldError: "This item list is too large.", items: [] };
  }

  const items: LineItemInput[] = [];
  let itemErrors: InvoiceTemplateItemErrors | undefined;

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

function parseDueDateOffsetDays(raw: unknown): { value: number | null; error?: string } {
  const trimmed = trimmedOrNull(raw);
  if (!trimmed) return { value: null };

  if (!/^\d+$/.test(trimmed)) {
    return { value: null, error: "Enter a whole number of days." };
  }
  const value = Number(trimmed);
  if (value < INVOICE_TEMPLATE_DUE_DATE_OFFSET_DAYS_MIN || value > INVOICE_TEMPLATE_DUE_DATE_OFFSET_DAYS_MAX) {
    return { value: null, error: `Enter a value between ${INVOICE_TEMPLATE_DUE_DATE_OFFSET_DAYS_MIN} and ${INVOICE_TEMPLATE_DUE_DATE_OFFSET_DAYS_MAX}.` };
  }
  return { value };
}

export function parseInvoiceTemplateInput(input: InvoiceTemplateWritableInput): {
  values: ParsedInvoiceTemplateValues;
  fieldErrors: InvoiceTemplateFieldErrors;
  itemErrors?: InvoiceTemplateItemErrors;
} {
  const name = trimmedOrNull(input.name) ?? "";
  const notes = trimmedOrNull(input.notes);
  const internalNotes = trimmedOrNull(input.internalNotes);
  const currencyRaw = trimmedOrNull(input.currency)?.toUpperCase() ?? "";

  const fieldErrors: InvoiceTemplateFieldErrors = {};

  if (!name) {
    fieldErrors.name = "Template name is required.";
  } else if (name.length > INVOICE_TEMPLATE_NAME_MAX_LENGTH) {
    fieldErrors.name = `Must be ${INVOICE_TEMPLATE_NAME_MAX_LENGTH} characters or fewer.`;
  }

  if (notes && notes.length > INVOICE_TEMPLATE_NOTES_MAX_LENGTH) {
    fieldErrors.notes = `Must be ${INVOICE_TEMPLATE_NOTES_MAX_LENGTH} characters or fewer.`;
  }

  if (internalNotes && internalNotes.length > INVOICE_TEMPLATE_NOTES_MAX_LENGTH) {
    fieldErrors.internalNotes = `Must be ${INVOICE_TEMPLATE_NOTES_MAX_LENGTH} characters or fewer.`;
  }

  if (!currencyRaw) {
    fieldErrors.currency = "Select a currency.";
  } else if (!isSupportedInvoiceCurrency(currencyRaw)) {
    fieldErrors.currency = "This currency isn't supported for invoices.";
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

  const { value: dueDateOffsetDays, error: dueDateOffsetDaysError } = parseDueDateOffsetDays(input.dueDateOffsetDays);
  if (dueDateOffsetDaysError) {
    fieldErrors.dueDateOffsetDays = dueDateOffsetDaysError;
  }

  const { fieldError: itemsFieldError, itemErrors, items } = parseItems(input.items);
  if (itemsFieldError) {
    fieldErrors.items = itemsFieldError;
  }

  return {
    values: { name, currency: currencyRaw, discountType, discountValue, taxRatePercent, taxLabel, notes, internalNotes, dueDateOffsetDays, items },
    fieldErrors,
    itemErrors,
  };
}

export function hasInvoiceTemplateFormErrors(fieldErrors: InvoiceTemplateFieldErrors, itemErrors?: InvoiceTemplateItemErrors): boolean {
  return Boolean(Object.keys(fieldErrors).length > 0 || (itemErrors && Object.keys(itemErrors).length > 0));
}

/**
 * Maps calculateInvoiceTotals()'s own error codes onto this module's
 * field-error shape — an Invoice-Template-specific analog of
 * src/lib/validation/invoice.ts's own mapInvoiceCalculationError, kept as
 * an independent, small copy (never imported from that file, which
 * returns Invoice's own InvoiceFormState shape and is mode-dependent —
 * flat vs itemized — a distinction this always-itemized template model
 * doesn't have) rather than a shared abstraction.
 */
export function mapInvoiceTemplateCalculationError(error: InvoiceCalculationError): {
  fieldErrors?: InvoiceTemplateFieldErrors;
  itemErrors?: InvoiceTemplateItemErrors;
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
      // Structurally unreachable -- an Invoice Template always calls
      // calculateInvoiceTotals with subtotalSource.mode: "lineItems",
      // never "flat" (see service.ts). Kept as an exhaustive switch case
      // so this function still compiles against InvoiceCalculationError's
      // full union without a runtime default branch masking a real
      // future gap.
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
