/**
 * Invoice Templates V1 — pure, UTC-only date-only arithmetic for
 * InvoiceTemplate.dueDateOffsetDays. No Prisma import, no I/O — safe to
 * unit test directly. Byte-identical logic to
 * src/lib/quote-templates/date.ts's own addValidityDays() (renamed here
 * to match this domain's own "offset" terminology) — mirrors
 * src/lib/invoices/date-only.ts's own persisted convention exactly: every
 * Date here represents 00:00:00.000 UTC on a named calendar date, never a
 * local-timezone instant.
 */

/** Strips any time-of-day component, keeping only the UTC calendar date. */
function toDateOnlyUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Adds `days` whole calendar days to `basis` (normalized to its own UTC
 * calendar date first, so a `basis` carrying a time-of-day component --
 * e.g. a raw `new Date()` at request time -- never contaminates the
 * arithmetic). `Date.UTC` itself correctly normalizes a day value that
 * overflows past the end of a month -- no separate month/year-boundary
 * branch is needed.
 */
export function addDueDateOffsetDays(basis: Date, days: number): Date {
  const dateOnly = toDateOnlyUtc(basis);
  return new Date(Date.UTC(dateOnly.getUTCFullYear(), dateOnly.getUTCMonth(), dateOnly.getUTCDate() + days));
}
