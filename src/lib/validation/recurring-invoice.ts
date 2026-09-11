import { parseDateOnly } from "@/lib/invoices/date-only";
import { isSupportedInvoiceCurrency } from "@/lib/invoices/currencies";
import {
  calculateInvoiceTotals,
  type CalculatedLineItem,
  type InvoiceCalculationError,
  type LineItemInput,
} from "@/lib/invoices/calculations";
import { INVOICE_DISCOUNT_TYPES, INVOICE_TAX_LABELS, INVOICE_NOTES_MAX_LENGTH } from "@/lib/validation/invoice";
import { isValidInvoiceNumberPrefix, isValidSequence } from "@/lib/recurring-invoices/numbering";

/**
 * Recurring Invoices Phase 1 — field-level validation for the template
 * create/update input. Mirrors src/lib/validation/invoice.ts's own
 * conventions (trim-then-null-if-empty, explicit max lengths, a
 * "field name -> error message" fieldErrors shape) and reuses its
 * generic pieces directly rather than re-declaring them: parseDateOnly,
 * isSupportedInvoiceCurrency, calculateInvoiceTotals, and the
 * INVOICE_DISCOUNT_TYPES/INVOICE_TAX_LABELS/INVOICE_NOTES_MAX_LENGTH
 * constants are all already fully generic (no Invoice-specific coupling).
 *
 * Discount/tax/line-item structural validity is deliberately NOT
 * re-implemented here as a second, parallel numeric validator — it's
 * checked by running the exact same calculateInvoiceTotals() a real
 * generation attempt will later use, and discarding its numeric result
 * (a RecurringInvoice template never persists a precomputed total — see
 * RecurringInvoiceLineItem's own schema comment). A successful `ok: true`
 * result IS the proof this discount/tax/line-item combination is
 * structurally valid and doesn't exceed the current subtotal.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export const RECURRING_INVOICE_NAME_MAX_LENGTH = 200;

export const RECURRENCE_FREQUENCIES = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type RecurrenceFrequencyValue = (typeof RECURRENCE_FREQUENCIES)[number];

export function isValidFrequency(value: unknown): value is RecurrenceFrequencyValue {
  return typeof value === "string" && (RECURRENCE_FREQUENCIES as readonly string[]).includes(value);
}

export const ANCHOR_DAY_MIN = 1;
export const ANCHOR_DAY_MAX = 31;

export function isValidAnchorDay(value: number): boolean {
  return Number.isInteger(value) && value >= ANCHOR_DAY_MIN && value <= ANCHOR_DAY_MAX;
}

export const DUE_DATE_OFFSET_MIN_DAYS = 0;
// A generous, deliberately bounded ceiling — a full year — not a real
// payment-terms subsystem (none exists; see RecurringInvoice.
// dueDateOffsetDays' own schema comment).
export const DUE_DATE_OFFSET_MAX_DAYS = 365;

/** Strict non-negative bounded integer, or null for "omit". Accepts a number or numeric string (the shape a future form input would arrive as). */
export function parseDueDateOffsetDays(raw: unknown): { ok: true; value: number | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: null };
  }
  if (typeof raw !== "number" && typeof raw !== "string") {
    return { ok: false };
  }
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return { ok: false };
  }
  if (parsed < DUE_DATE_OFFSET_MIN_DAYS || parsed > DUE_DATE_OFFSET_MAX_DAYS) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}

/** Strict "YYYY-MM-DD" via the existing parseDateOnly — never raw `new Date(userInput)`. */
export function parseFirstIssueDate(raw: unknown): { ok: true; date: Date } | { ok: false } {
  if (typeof raw !== "string") return { ok: false };
  const result = parseDateOnly(raw);
  if (!result.ok) return { ok: false };
  return { ok: true, date: result.date };
}

/** Trims; empty-after-trim becomes null. Rejects (does not silently truncate) an over-length value. */
export function normalizeOptionalText(raw: unknown, maxLength: number): { ok: true; value: string | null } | { ok: false } {
  const trimmed = String(raw ?? "").trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > maxLength) return { ok: false };
  return { ok: true, value: trimmed };
}

export type RecurringInvoiceLineItemInput = { description: unknown; quantity: unknown; unitPrice: unknown };

export type RecurringInvoiceFieldErrors = Partial<
  Record<
    | "name"
    | "clientId"
    | "projectId"
    | "frequency"
    | "firstIssueDate"
    | "invoiceNumberPrefix"
    | "startingSequence"
    | "dueDateOffsetDays"
    | "currency"
    | "discountType"
    | "discountValue"
    | "taxRatePercent"
    | "taxLabel"
    | "notes"
    | "internalNotes"
    | "lineItems",
    string
  >
>;

/** Maps a calculateInvoiceTotals() failure onto this module's own fieldErrors shape — an independent copy of validation/invoice.ts's mapInvoiceCalculationError(), not a shared import: that function's own return type is tied to InvoiceFormState's UI-facing lineItemErrors shape, which this template-level validator has no equivalent of (a RecurringInvoiceLineItem input has no per-row error slot in this phase — there is no UI yet). */
export function mapRecurringInvoiceCalculationError(error: InvoiceCalculationError): RecurringInvoiceFieldErrors {
  switch (error.code) {
    case "EMPTY_LINE_ITEMS":
      return { lineItems: "Add at least one line item." };
    case "TOO_MANY_LINE_ITEMS":
      return { lineItems: "You can add at most 200 line items." };
    case "EMPTY_DESCRIPTION":
    case "DESCRIPTION_TOO_LONG":
    case "ZERO_OR_NEGATIVE_QUANTITY":
    case "QUANTITY_TOO_PRECISE":
    case "QUANTITY_OUT_OF_RANGE":
    case "NEGATIVE_UNIT_PRICE":
    case "UNIT_PRICE_TOO_PRECISE":
    case "UNIT_PRICE_OUT_OF_RANGE":
      return { lineItems: "One or more line items are invalid." };
    case "INVALID_FLAT_AMOUNT":
    case "TOTAL_OUT_OF_RANGE":
      return { lineItems: "This schedule's total is out of range." };
    case "DISCOUNT_PERCENTAGE_OUT_OF_RANGE":
      return { discountValue: "Enter a discount percentage between 0 and 100." };
    case "DISCOUNT_VALUE_INVALID":
      return { discountValue: "Enter a valid discount amount." };
    case "DISCOUNT_EXCEEDS_SUBTOTAL":
      return { discountValue: "Discount cannot exceed the subtotal." };
    case "TAX_RATE_OUT_OF_RANGE":
      return { taxRatePercent: "Enter a tax rate between 0 and 100." };
  }
}

export type ParsedRecurringInvoiceTemplateFields = {
  name: string | null;
  invoiceNumberPrefix: string;
  startingSequence: number;
  dueDateOffsetDays: number | null;
  currency: string;
  discountType: (typeof INVOICE_DISCOUNT_TYPES)[number];
  discountValue: string | null;
  taxRatePercent: string | null;
  taxLabel: (typeof INVOICE_TAX_LABELS)[number];
  notes: string | null;
  internalNotes: string | null;
  /** The validated, trimmed-description / parsed-Decimal snapshot from calculateInvoiceTotals() — never the raw unvalidated input. `lineTotal` is present (calculateInvoiceTotals always computes it) but deliberately never persisted onto RecurringInvoiceLineItem (see that model's own schema comment) — callers read only description/quantity/unitPrice from each entry. */
  lineItems: CalculatedLineItem[];
};

/**
 * Every field a create/update call must validate when supplied — clientId/
 * projectId/frequency/firstIssueDate/anchorDay are deliberately NOT
 * included here: clientId/projectId go through resolveRecurringInvoiceTarget
 * (an existence/ownership check, not a format-only one), and
 * frequency/firstIssueDate/anchorDay are only ever set at creation time
 * (see recurring-invoices.ts's own header comment on why update() never
 * touches the recurrence schedule itself).
 */
export function parseRecurringInvoiceTemplateFields(input: {
  name?: unknown;
  invoiceNumberPrefix: unknown;
  startingSequence?: unknown;
  dueDateOffsetDays?: unknown;
  currency: unknown;
  discountType?: unknown;
  discountValue?: unknown;
  taxRatePercent?: unknown;
  taxLabel?: unknown;
  notes?: unknown;
  internalNotes?: unknown;
  lineItems: RecurringInvoiceLineItemInput[];
}): { ok: true; values: ParsedRecurringInvoiceTemplateFields } | { ok: false; fieldErrors: RecurringInvoiceFieldErrors } {
  const fieldErrors: RecurringInvoiceFieldErrors = {};

  const nameResult = normalizeOptionalText(input.name, RECURRING_INVOICE_NAME_MAX_LENGTH);
  if (!nameResult.ok) {
    fieldErrors.name = `Must be ${RECURRING_INVOICE_NAME_MAX_LENGTH} characters or fewer.`;
  }

  if (!isValidInvoiceNumberPrefix(input.invoiceNumberPrefix)) {
    fieldErrors.invoiceNumberPrefix = "Enter a short invoice-number prefix (e.g. \"INV-\").";
  }

  const startingSequenceRaw = input.startingSequence ?? 1;
  const startingSequence =
    typeof startingSequenceRaw === "number" ? startingSequenceRaw : Number(startingSequenceRaw);
  if (!isValidSequence(startingSequence)) {
    fieldErrors.startingSequence = "Enter a positive whole number.";
  }

  const dueDateOffsetResult = parseDueDateOffsetDays(input.dueDateOffsetDays);
  if (!dueDateOffsetResult.ok) {
    fieldErrors.dueDateOffsetDays = `Enter a whole number of days between ${DUE_DATE_OFFSET_MIN_DAYS} and ${DUE_DATE_OFFSET_MAX_DAYS}, or leave blank.`;
  }

  const currencyRaw = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "";
  if (!isSupportedInvoiceCurrency(currencyRaw)) {
    fieldErrors.currency = "Select a supported currency.";
  }

  const discountTypeRaw = typeof input.discountType === "string" ? input.discountType : "NONE";
  const isValidDiscountType = (INVOICE_DISCOUNT_TYPES as readonly string[]).includes(discountTypeRaw);
  if (!isValidDiscountType) {
    fieldErrors.discountType = "Select a valid discount type.";
  }
  const discountType = (isValidDiscountType ? discountTypeRaw : "NONE") as (typeof INVOICE_DISCOUNT_TYPES)[number];

  const discountValueRaw = typeof input.discountValue === "string" ? input.discountValue.trim() : "";
  let discountValue: string | null = null;
  if (discountType !== "NONE") {
    if (!discountValueRaw) {
      fieldErrors.discountValue = "Enter a discount value.";
    } else {
      discountValue = discountValueRaw;
    }
  }

  const taxRatePercentRaw = typeof input.taxRatePercent === "string" ? input.taxRatePercent.trim() : "";
  const taxRatePercent = taxRatePercentRaw === "" ? null : taxRatePercentRaw;

  const taxLabelRaw = typeof input.taxLabel === "string" ? input.taxLabel : "TAX";
  const isValidTaxLabel = (INVOICE_TAX_LABELS as readonly string[]).includes(taxLabelRaw);
  if (!isValidTaxLabel) {
    fieldErrors.taxLabel = "Select a valid tax label.";
  }
  const taxLabel = (isValidTaxLabel ? taxLabelRaw : "TAX") as (typeof INVOICE_TAX_LABELS)[number];

  const notesResult = normalizeOptionalText(input.notes, INVOICE_NOTES_MAX_LENGTH);
  if (!notesResult.ok) {
    fieldErrors.notes = `Must be ${INVOICE_NOTES_MAX_LENGTH} characters or fewer.`;
  }
  const internalNotesResult = normalizeOptionalText(input.internalNotes, INVOICE_NOTES_MAX_LENGTH);
  if (!internalNotesResult.ok) {
    fieldErrors.internalNotes = `Must be ${INVOICE_NOTES_MAX_LENGTH} characters or fewer.`;
  }

  if (!Array.isArray(input.lineItems) || input.lineItems.length === 0) {
    fieldErrors.lineItems = "Add at least one line item.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  // Structural + financial validity (non-empty descriptions, valid
  // quantity/unitPrice, discount-vs-subtotal, tax range) is checked by
  // actually running calculateInvoiceTotals() — see this module's own
  // header comment. Its numeric result is discarded here; only its
  // ok/error verdict matters at template-save time.
  const calc = calculateInvoiceTotals({
    subtotalSource: { mode: "lineItems", lineItems: input.lineItems as LineItemInput[] },
    discount: discountType === "NONE" ? { type: "NONE" } : { type: discountType, value: discountValue ?? "" },
    taxRatePercent,
  });
  if (!calc.ok) {
    return { ok: false, fieldErrors: mapRecurringInvoiceCalculationError(calc.error) };
  }

  return {
    ok: true,
    values: {
      name: nameResult.ok ? nameResult.value : null,
      invoiceNumberPrefix: (input.invoiceNumberPrefix as string).trim(),
      startingSequence,
      dueDateOffsetDays: dueDateOffsetResult.ok ? dueDateOffsetResult.value : null,
      currency: currencyRaw,
      discountType,
      discountValue,
      taxRatePercent,
      taxLabel,
      notes: notesResult.ok ? notesResult.value : null,
      internalNotes: internalNotesResult.ok ? internalNotesResult.value : null,
      lineItems: calc.lineItems,
    },
  };
}
