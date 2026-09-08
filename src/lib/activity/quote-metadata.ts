import { Prisma } from "@/generated/prisma/browser";

// Quotes / Estimates Phase 2. Mirrors invoice-metadata.ts's own discipline
// exactly (Decimal-aware equality, ordered item comparison collapsing to
// one "items" field name, never a per-row/per-field breakdown): CREATED
// is a small enriched snapshot; UPDATED is names-only (changed field
// names, never values); STATUS_CHANGED keeps its own {from,to} shape.
// notes and every item description/quantity/unitPrice value NEVER appear
// in any Quote Activity metadata — only field names (for UPDATED) or a
// bare presence marker.

export type QuoteTrackedItem = {
  description: string;
  quantity: unknown;
  unitPrice: unknown;
};

export type QuoteTrackedSnapshot = {
  title: string | null;
  leadId: string | null;
  clientId: string | null;
  issueDate: Date;
  validUntil: Date | null;
  currency: string;
  notes: string | null;
  discountType: string;
  discountValue: unknown;
  taxRatePercent: unknown;
  taxLabel: string;
  items: QuoteTrackedItem[];
};

const QUOTE_TRACKED_FIELDS = [
  "title",
  "leadId",
  "clientId",
  "issueDate",
  "validUntil",
  "currency",
  "notes",
  "discountType",
  "discountValue",
  "taxRatePercent",
  "taxLabel",
  "items",
] as const;

function toDecimalOrNull(value: unknown): InstanceType<typeof Prisma.Decimal> | null {
  if (value === null || value === undefined) return null;
  return Prisma.Decimal.isDecimal(value) ? value : new Prisma.Decimal(String(value));
}

/** Decimal equality, never Number() — a null on either side is only equal to a null on the other. */
function decimalEqual(a: unknown, b: unknown): boolean {
  const da = toDecimalOrNull(a);
  const db = toDecimalOrNull(b);
  if (da === null || db === null) return da === db;
  return da.equals(db);
}

function dateEqual(a: unknown, b: unknown): boolean {
  const at = a instanceof Date ? a.getTime() : null;
  const bt = b instanceof Date ? b.getTime() : null;
  return at === bt;
}

/**
 * Ordered item comparison. A length difference, a reorder, or any single
 * field difference on any row all collapse to "not equal" — the caller
 * (diffQuoteFields) then reports exactly the one field name "items",
 * never a per-row/per-field breakdown, and never the description text
 * itself (read here in memory for the comparison, never emitted).
 */
function itemsEqual(a: QuoteTrackedItem[], b: QuoteTrackedItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].description !== b[i].description) return false;
    if (!decimalEqual(a[i].quantity, b[i].quantity)) return false;
    if (!decimalEqual(a[i].unitPrice, b[i].unitPrice)) return false;
  }
  return true;
}

function fieldEqual(field: (typeof QUOTE_TRACKED_FIELDS)[number], a: unknown, b: unknown): boolean {
  switch (field) {
    case "issueDate":
    case "validUntil":
      return dateEqual(a, b);
    case "discountValue":
    case "taxRatePercent":
      return decimalEqual(a, b);
    case "items":
      return itemsEqual(a as QuoteTrackedItem[], b as QuoteTrackedItem[]);
    default:
      return a === b;
  }
}

/**
 * Field names (never values) that differ between two Quote snapshots.
 * `status` is deliberately not one of the tracked fields here — it is
 * always split out into its own STATUS_CHANGED event by the caller
 * (sendQuoteAction/reopenQuoteAction/the SENT-reset branch of
 * updateQuoteAction), never listed in an UPDATED event's changedFields.
 */
export function diffQuoteFields(before: QuoteTrackedSnapshot, after: QuoteTrackedSnapshot): string[] {
  return QUOTE_TRACKED_FIELDS.filter((field) => !fieldEqual(field, before[field], after[field]));
}

export type QuoteActivityMetadata = {
  number: string;
  status: string;
  actorName: string;
  /** Only present on UPDATED — field names that changed, never their values. */
  changedFields?: string[];
};

export type QuoteStatusChangeMetadata = {
  from: string;
  to: string;
};

export function buildQuoteActivityMetadata(
  quote: { number: string; status: string },
  actorName: string,
  changedFields?: string[],
): QuoteActivityMetadata {
  return {
    number: quote.number,
    status: quote.status,
    actorName,
    ...(changedFields ? { changedFields } : {}),
  };
}

export function buildQuoteStatusChangeMetadata(from: string, to: string): QuoteStatusChangeMetadata {
  return { from, to };
}

export type QuoteConvertedMetadata = {
  number: string;
  invoiceNumber: string;
  actorName: string;
};

/**
 * Quotes / Estimates Phase 2.3 — Quote -> Invoice conversion's own
 * CONVERTED event. Deliberately not the resulting Invoice's id (Activity
 * metadata never carries a raw id a reader could use to probe another
 * record — same discipline every other builder in this file already
 * follows) — only the two human-readable reference numbers.
 */
export function buildQuoteConvertedMetadata(quote: { number: string }, invoiceNumber: string, actorName: string): QuoteConvertedMetadata {
  return { number: quote.number, invoiceNumber, actorName };
}
