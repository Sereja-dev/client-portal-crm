/**
 * Quote Templates Phase 1 — pure, UTC-only date-only arithmetic for
 * QuoteTemplate.validityDays. No Prisma import, no I/O — safe to unit
 * test directly. Mirrors src/lib/invoices/date-only.ts's own persisted
 * convention exactly: every Date here represents 00:00:00.000 UTC on a
 * named calendar date, never a local-timezone instant.
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
 * overflows past the end of a month (e.g. day 32 of January becomes
 * February 1) -- the same property this app's own dashboard/reports
 * period math already relies on for month-boundary arithmetic -- so no
 * separate "does this cross a month/year boundary" branch is needed here
 * either.
 */
export function addValidityDays(basis: Date, days: number): Date {
  const dateOnly = toDateOnlyUtc(basis);
  return new Date(Date.UTC(dateOnly.getUTCFullYear(), dateOnly.getUTCMonth(), dateOnly.getUTCDate() + days));
}
