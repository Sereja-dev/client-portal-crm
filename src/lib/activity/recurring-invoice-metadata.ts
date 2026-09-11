import { Prisma } from "@/generated/prisma/browser";

/**
 * Recurring Invoices Phase 1. Mirrors src/lib/activity/invoice-metadata.ts's
 * own conventions: CREATED gets a small identifying snapshot, UPDATED is
 * names-only (changed field names, never values), STATUS_CHANGED keeps a
 * from/to shape. notes/internalNotes and every line-item description/
 * quantity/unitPrice value NEVER appear in any RecurringInvoice Activity
 * metadata — only field names (for UPDATED) or nothing at all (for
 * CREATED, beyond the identifying fields below).
 */

export type RecurringInvoiceTrackedSnapshot = {
  name: string | null;
  clientId: string;
  projectId: string | null;
  invoiceNumberPrefix: string;
  dueDateOffsetDays: number | null;
  currency: string;
  discountType: string;
  discountValue: unknown;
  taxRatePercent: unknown;
  taxLabel: string;
  notes: string | null;
  internalNotes: string | null;
  lineItems: { description: string; quantity: unknown; unitPrice: unknown }[];
};

const RECURRING_INVOICE_TRACKED_FIELDS = [
  "name",
  "clientId",
  "projectId",
  "invoiceNumberPrefix",
  "dueDateOffsetDays",
  "currency",
  "discountType",
  "discountValue",
  "taxRatePercent",
  "taxLabel",
  "lineItems",
] as const;

function toDecimalOrNull(value: unknown): InstanceType<typeof Prisma.Decimal> | null {
  if (value === null || value === undefined) return null;
  return Prisma.Decimal.isDecimal(value) ? value : new Prisma.Decimal(String(value));
}

/** Decimal equality, never Number()/String() — mirrors invoice-metadata.ts's own decimalEqual exactly, so "10" and "10.00" compare equal instead of producing a spurious changedFields entry. */
function decimalEqual(a: unknown, b: unknown): boolean {
  const da = toDecimalOrNull(a);
  const db = toDecimalOrNull(b);
  if (da === null || db === null) return da === db;
  return da.equals(db);
}

function scalarOrNullEqual(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  return a === b;
}

function lineItemsEqual(
  a: RecurringInvoiceTrackedSnapshot["lineItems"],
  b: RecurringInvoiceTrackedSnapshot["lineItems"],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].description !== b[i].description) return false;
    if (!decimalEqual(a[i].quantity, b[i].quantity)) return false;
    if (!decimalEqual(a[i].unitPrice, b[i].unitPrice)) return false;
  }
  return true;
}

function fieldEqual(field: (typeof RECURRING_INVOICE_TRACKED_FIELDS)[number], a: unknown, b: unknown): boolean {
  switch (field) {
    case "discountValue":
    case "taxRatePercent":
      return decimalEqual(a, b);
    case "dueDateOffsetDays":
      return scalarOrNullEqual(a, b);
    case "lineItems":
      return lineItemsEqual(a as RecurringInvoiceTrackedSnapshot["lineItems"], b as RecurringInvoiceTrackedSnapshot["lineItems"]);
    default:
      return a === b;
  }
}

/** Field names (never values) that differ between two RecurringInvoice snapshots. `status`/`frequency`/`anchorDay`/`nextIssueDate`/`nextSequence` are deliberately never tracked here — status changes are always their own STATUS_CHANGED event, and the recurrence schedule itself/numbering counter are never editable via updateRecurringInvoice (see recurring-invoices.ts's own header comment). */
export function diffRecurringInvoiceFields(
  before: RecurringInvoiceTrackedSnapshot,
  after: RecurringInvoiceTrackedSnapshot,
): string[] {
  return RECURRING_INVOICE_TRACKED_FIELDS.filter((field) => !fieldEqual(field, before[field], after[field]));
}

export type RecurringInvoiceSnapshotMetadata = {
  name: string | null;
  clientId: string;
  frequency: string;
  invoiceNumberPrefix: string;
  currency: string;
  lineItemCount: number;
  actorName: string;
};

export function buildRecurringInvoiceSnapshotMetadata(
  recurringInvoice: { name: string | null; clientId: string; frequency: string; invoiceNumberPrefix: string; currency: string },
  lineItemCount: number,
  actorName: string,
): RecurringInvoiceSnapshotMetadata {
  return {
    name: recurringInvoice.name,
    clientId: recurringInvoice.clientId,
    frequency: recurringInvoice.frequency,
    invoiceNumberPrefix: recurringInvoice.invoiceNumberPrefix,
    currency: recurringInvoice.currency,
    lineItemCount,
    actorName,
  };
}

export type RecurringInvoiceUpdatedMetadata = {
  name: string | null;
  /** Field names only — e.g. ["currency", "lineItems", "notes"]. Never a value, before or after. */
  changedFields: string[];
  actorName: string;
};

export function buildRecurringInvoiceUpdatedMetadata(
  name: string | null,
  changedFields: string[],
  actorName: string,
): RecurringInvoiceUpdatedMetadata {
  return { name, changedFields, actorName };
}

export type RecurringInvoiceStatusChangedMetadata = {
  name: string | null;
  from: string;
  to: string;
  actorName: string;
};

export function buildRecurringInvoiceStatusChangedMetadata(
  name: string | null,
  from: string,
  to: string,
  actorName: string,
): RecurringInvoiceStatusChangedMetadata {
  return { name, from, to, actorName };
}
