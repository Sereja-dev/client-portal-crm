/**
 * Recurring Invoices Phase 2B-1 — mirrors src/lib/notifications/jobs/types.ts's
 * own JobSummary discipline (aggregate counts only, safe to hand straight
 * back as a cron route's JSON response, logged, or asserted on in tests —
 * never anything identifying: no schedule id, client name, invoice
 * number, note, or failureReason). A fresh type, not that one reused —
 * the outcome vocabulary genuinely differs (generated/skipped/failed/
 * errored has no equivalent to claimed/sent/deleted), matching this
 * repo's own per-feature-type convention (e.g. TimeEntryFormState/
 * InvoiceFormState never share one shape either).
 */
export type RecurringInvoiceJobSummary = {
  scanned: number;
  generated: number;
  skipped: number;
  failed: number;
  errored: number;
};

export function emptyRecurringInvoiceJobSummary(): RecurringInvoiceJobSummary {
  return { scanned: 0, generated: 0, skipped: 0, failed: 0, errored: 0 };
}
