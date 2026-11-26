import "server-only";

/**
 * Production Observability Correction 1 — bounded, non-disclosing
 * diagnostics for the Invoice Issue/PDF pipeline (issue-invoice.ts) and
 * its two PDF download routes (staff and Portal). Reuses Stability
 * Correction F5's own audited principle exactly (see
 * src/lib/client-portal/analytics-events.ts's own header comment): a
 * fixed, stable event key plus one or more allowlisted enum fields only
 * — never the caught error, never any identifier, never
 * message/stack/cause/digest/Prisma metadata/provider response/Storage
 * error detail, never an Invoice number/email/URL/Storage path/signed
 * URL/filename/token/environment value/request data. This is not a
 * generic logging framework — two narrow, closed-enum functions, kept
 * local to the Invoice/PDF subsystem, mirroring the single allowlisted
 * `classification` field F5 already established as this codebase's own
 * precedent for exactly this kind of signal.
 *
 * `src/app/api/invoices/[id]/pdf/route.ts` and
 * `src/app/api/portal/invoices/[id]/pdf/route.ts` each carry their own
 * static security-check assertion ("contains no console logging of any
 * kind" — scripts/security-checks/check-invoice-issue-security.mjs
 * checks #11h/#13j) against their own raw file text. Both routes call
 * `logInvoicePdfLedgerMismatch` below (a plain function call, never the
 * literal text `console.`) rather than logging directly, so that
 * existing invariant continues to hold unmodified — deliberate, not
 * incidental.
 */

const ISSUE_FAILURE_EVENT = "[invoice-issue] Issue pipeline failure.";
const PDF_LEDGER_MISMATCH_EVENT = "[invoice-pdf] Canonical path/ledger mismatch.";

/**
 * The bounded set of Issue-pipeline failure stages this module will ever
 * log — deliberately finer-grained than IssueInvoiceErrorCode itself
 * (several of these collapse to the same public FINALIZATION_FAILED code
 * today; that code alone cannot distinguish which internal stage failed,
 * which is exactly the missing triage signal this correction adds).
 */
export type InvoiceIssueFailureStage =
  | "snapshot_invalid"
  | "render_failed"
  | "pdf_too_large"
  | "identity_build_failed"
  | "ledger_create_failed"
  | "ledger_ownership_check_failed"
  | "ledger_ownership_lost"
  | "upload_failed"
  | "storage_not_configured"
  | "transaction_failed"
  /**
   * Aqenra Free plan — the storage reservation this attempt took back in
   * step C0 was already expired by the time the final transaction ran
   * (consumeStorageReservation's own check, src/lib/billing/storage-
   * reservation.ts). Distinct from an ordinary up-front STORAGE_LIMIT_REACHED
   * rejection (never logged) — this one is logged because it signals a
   * pipeline run that took unusually long, worth operational visibility.
   */
  | "storage_reservation_lost";

/**
 * Logs exactly one fixed message plus the one allowlisted `stage` field —
 * never a caught error, never any identifier. Callers never pass an
 * error/unknown value to this function at all (there is no parameter for
 * one), so nothing beyond a value from the closed `InvoiceIssueFailureStage`
 * union can ever reach this log line, regardless of what actually failed.
 */
export function logInvoiceIssueFailure(stage: InvoiceIssueFailureStage): void {
  console.error(ISSUE_FAILURE_EVENT, { stage });
}

/** Which of the two structurally-identical PDF download routes logged the mismatch. */
export type InvoicePdfRouteScope = "staff" | "portal";

/**
 * A thrown canonical-path rebuild is `rebuild_failed`; a successfully
 * rebuilt path that disagrees with the persisted path is `path_mismatch`
 * — the single most operationally significant signal in this file, since
 * it indicates the ledger and the Invoice's own persisted path have
 * drifted apart. Deliberately never includes invoiceId or any other
 * identifier — `scope` alone (which route observed it) is the only
 * additional context logged.
 */
export type InvoicePdfLedgerMismatchReason = "rebuild_failed" | "path_mismatch";

export function logInvoicePdfLedgerMismatch(reason: InvoicePdfLedgerMismatchReason, scope: InvoicePdfRouteScope): void {
  console.error(PDF_LEDGER_MISMATCH_EVENT, { reason, scope });
}
