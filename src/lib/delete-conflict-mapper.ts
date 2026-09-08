import "server-only";
import { Prisma } from "@/generated/prisma/client";

export type DeleteConflict = "HAS_DEPENDENT_INVOICES" | "HAS_DEPENDENT_QUOTES" | "UNRECOGNIZED";

type DriverAdapterMeta = {
  modelName?: unknown;
  driverAdapterError?: {
    cause?: { code?: unknown; message?: unknown; detail?: unknown };
  };
};

// Postgres's own RI-trigger errdetail grammar for a restrict violation —
// stable, database-generated text (not a human-authored message), of the
// exact form `Key (id)=(<uuid>) is referenced from table "<ChildTable>".`
// — used identically for any foreign key restrict violation, not
// something specific to this app. This is the only place the actual
// blocking child table's name is available at all on this project's
// Prisma/driver-adapter stack (empirically verified: `error.meta` itself
// carries only `modelName` — the PARENT model being deleted — and
// `driverAdapterError.cause.code`, never a structured constraint/table
// reference the way write-conflict-mapper.ts's own P2002 case gets one).
const RESTRICT_DETAIL_TABLE_PATTERN = /is referenced from table "([^"]+)"/;
// Cross-checked against the constraint name embedded in the adapter
// error's own top-level message (`... foreign key constraint
// "<ChildTable>_<field>_fkey" on table "<ChildTable>"`) — this app's own
// Prisma-generated constraint-naming convention is always
// `{ChildModel}_{field}_fkey`, so requiring the two independently-parsed
// signals to agree (rather than trusting either alone) is what keeps this
// "not brittle": a wording change to only one of Postgres's two strings
// fails closed to UNRECOGNIZED instead of silently mis-attributing a
// violation to the wrong dependent model.
const RESTRICT_MESSAGE_CONSTRAINT_PATTERN = /foreign key constraint "([^"]+)"/;

/**
 * Extracts the real child table that caused a P2039 restrict violation,
 * requiring the `detail` field's own table name and the `message` field's
 * own constraint-name prefix to agree before trusting either. Returns
 * `null` — never guesses — if either string is missing/unrecognized, or
 * if the two signals disagree.
 */
function extractRestrictChildTable(cause: { message?: unknown; detail?: unknown } | undefined): string | null {
  const detail = typeof cause?.detail === "string" ? cause.detail : "";
  const message = typeof cause?.message === "string" ? cause.message : "";

  const detailMatch = RESTRICT_DETAIL_TABLE_PATTERN.exec(detail);
  const constraintMatch = RESTRICT_MESSAGE_CONSTRAINT_PATTERN.exec(message);
  if (!detailMatch || !constraintMatch) return null;

  const tableFromDetail = detailMatch[1];
  if (!constraintMatch[1].startsWith(`${tableFromDetail}_`)) return null;

  return tableFromDetail;
}

/**
 * Post-Hardening Residual Code Audit (P2), extended by Quotes / Estimates
 * Phase 2 — deleteClientAction/deleteProjectAction previously let a
 * blocked delete propagate as an unhandled exception, surfacing only
 * DeleteButton's own generic "Failed to delete {itemName}." toast with no
 * explanation. This maps the specific, empirically verified error shape a
 * Postgres RESTRICT violation actually produces on this project's Prisma/
 * driver-adapter stack: `error.code` is `"P2039"`, and
 * `error.meta.driverAdapterError.cause.code` carries the real underlying
 * Postgres SQLSTATE, `"23001"` (restrict_violation).
 *
 * Schema fact this classification originally relied on (verified against
 * prisma/schema.prisma, since revised twice): `Invoice.clientId` and
 * `Invoice.projectId` used to be the ONLY `onDelete: Restrict` relations
 * pointing at Client/Project respectively — that stopped being true the
 * moment Quotes / Estimates Phase 1 added `Quote.clientId`, also
 * `onDelete: Restrict` against Client. `expectedModelName` alone (the
 * PARENT model being deleted) can no longer disambiguate which child
 * caused a Client-targeted violation, so this function now also inspects
 * `extractRestrictChildTable()` (see its own doc comment for the exact,
 * cross-checked signal) to tell an Invoice-caused violation from a
 * Quote-caused one.
 *
 * Quotes / Estimates Phase 2.4: `Invoice.projectId`'s own FK became
 * `onDelete: SetNull`, so Project no longer has ANY `onDelete: Restrict`
 * child at all — `deleteProjectAction` no longer calls this function with
 * `expectedModelName === "Project"`. The parameter type is left as
 * `"Client" | "Project"` deliberately (this is a generic, reusable
 * classifier, not something to narrow just because today's only caller
 * happens to be Client) — if a future model ever adds a Restrict relation
 * to Project, this function already handles it correctly once called
 * again with `"Project"`, with zero change needed here. Until then,
 * `HAS_DEPENDENT_QUOTES` is only ever returned for
 * `expectedModelName === "Client"`, and `HAS_DEPENDENT_INVOICES` is
 * unreachable in production for either model (kept working, and covered
 * by tests below, purely so this file stays correct on its own terms
 * rather than by relying on nothing else calling it wrong).
 *
 * Fails closed to UNRECOGNIZED for anything not positively matched —
 * every unrelated failure (a different constraint, a connection error, a
 * bug, or a future third Restrict relation this function doesn't know
 * about yet) must keep propagating to the caller's own generic handling,
 * never be silently reclassified.
 */
export function mapDeleteRestrictError(error: unknown, expectedModelName: "Client" | "Project"): DeleteConflict {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2039") {
    return "UNRECOGNIZED";
  }

  const meta = error.meta as DriverAdapterMeta | undefined;
  const cause = meta?.driverAdapterError?.cause;
  const isRestrictViolation = cause?.code === "23001";
  const matchesModel = meta?.modelName === expectedModelName;

  if (!isRestrictViolation || !matchesModel) {
    return "UNRECOGNIZED";
  }

  const childTable = extractRestrictChildTable(cause);
  if (expectedModelName === "Client" && childTable === "Quote") {
    return "HAS_DEPENDENT_QUOTES";
  }
  if (childTable === "Invoice") {
    return "HAS_DEPENDENT_INVOICES";
  }

  return "UNRECOGNIZED";
}
