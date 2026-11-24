import "server-only";
import { parseIssuerSnapshot, parseRecipientSnapshot } from "./snapshot-types";

/**
 * Invoice System Official Slice 3, sub-PR 3a — the exhaustive archival
 * classifier (docs/invoicing-architecture.md §4.6, "Second Corrected
 * Design Report" §13). This is a single, exhaustive function — every
 * future consumer (both PDF routes, the read-only view, the Portal query
 * layer, once 3b/3c wire them) must call this instead of independently
 * re-deriving a narrower check, so no code path can ever fall through to
 * treating a partially/invalidly populated row as a valid archive or a
 * valid legacy-eligible row.
 *
 * The result never carries parsed issuer/recipient snapshot values —
 * callers that need the actual snapshot contents (a server-only render
 * path) must call parseIssuerSnapshot()/parseRecipientSnapshot()
 * themselves; this classifier only reports which of the four kinds a row
 * is, plus a coarse, non-leaking reason for an invariant violation.
 */

export type InvoiceArchivalClassification =
  | { kind: "draft" }
  | { kind: "legacy_eligible" }
  | { kind: "archived" }
  | { kind: "archive_deferred" }
  | {
      kind: "invariant_violation";
      reason: "draft_with_archive_fields" | "incomplete_archive_fields" | "snapshot_unparseable";
    };

export type InvoiceArchivalFields = {
  status: string;
  finalizedAt: Date | null;
  pdfStoragePath: string | null;
  pdfGeneratedAt: Date | null;
  issuerSnapshot: unknown;
  recipientSnapshot: unknown;
};

/**
 * Aqenra Free plan — a fifth, deliberate kind: "archive_deferred". Issuing
 * an invoice must never be blocked by the organization's storage
 * allowance being full (owner-approved requirement) — issue-invoice.ts's
 * own reserveStorageBytes-gated archival step can therefore finish a
 * DRAFT -> SENT transition WITHOUT ever writing a PDF to Storage,
 * leaving `finalizedAt`/`issuerSnapshot`/`recipientSnapshot` populated
 * exactly as a normal archived invoice would, but `pdfStoragePath`/
 * `pdfGeneratedAt` both still null — a row shape this classifier
 * previously had no way to represent, that would otherwise have fallen
 * through to "incomplete_archive_fields" and been mistaken for a genuine
 * data-integrity bug. See render-deferred.ts for how such an invoice's
 * PDF is still served — regenerated on demand from this exact frozen
 * snapshot — and src/app/api/invoices/[id]/pdf/route.ts /
 * src/app/api/portal/invoices/[id]/pdf/route.ts / send-invoice-email.ts
 * for every place that regeneration path is wired in.
 */
export function classifyInvoiceArchival(invoice: InvoiceArchivalFields): InvoiceArchivalClassification {
  const hasFinalizedAt = invoice.finalizedAt !== null;
  const hasPath = invoice.pdfStoragePath !== null;
  const hasGeneratedAt = invoice.pdfGeneratedAt !== null;
  const hasIssuerSnapshot = invoice.issuerSnapshot !== null;
  const hasRecipientSnapshot = invoice.recipientSnapshot !== null;

  const populatedCount = [hasFinalizedAt, hasPath, hasGeneratedAt, hasIssuerSnapshot, hasRecipientSnapshot].filter(
    Boolean,
  ).length;
  const allNull = populatedCount === 0;
  const allPresent = populatedCount === 5;
  const isDeferredShape = hasFinalizedAt && hasIssuerSnapshot && hasRecipientSnapshot && !hasPath && !hasGeneratedAt;

  if (invoice.status === "DRAFT") {
    return allNull ? { kind: "draft" } : { kind: "invariant_violation", reason: "draft_with_archive_fields" };
  }

  if (allNull) return { kind: "legacy_eligible" };

  if (!allPresent && !isDeferredShape) return { kind: "invariant_violation", reason: "incomplete_archive_fields" };

  const issuer = parseIssuerSnapshot(invoice.issuerSnapshot);
  const recipient = parseRecipientSnapshot(invoice.recipientSnapshot);
  if (!issuer.ok || !recipient.ok) {
    return { kind: "invariant_violation", reason: "snapshot_unparseable" };
  }

  return isDeferredShape ? { kind: "archive_deferred" } : { kind: "archived" };
}
