import "server-only";
import type { Prisma, ImportJob } from "@/generated/prisma/client";
import type { ImportEntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { MAX_IMPORT_ROW_RESULTS } from "./constants";

/**
 * CSV Import Phase 2 — the ImportJob data-access layer. Every function
 * here is organization-scoped exactly like the rest of this app's
 * Client/Lead-family code: a foreign-org id is always treated as
 * nonexistent, never a distinguishable "exists but denied" case (so a
 * forged job id, or another organization's real job id, are
 * indistinguishable rejections — see the approved architecture's own
 * security requirements).
 */

export type ImportRowResultEntry = { row: number; outcome: "imported" | "skipped" | "failed"; message?: string };

export async function createImportJob(params: {
  organizationId: string;
  actorId: string;
  entityType: ImportEntityType;
  filename: string;
  totalRows: number;
  rawContent: string;
}): Promise<ImportJob> {
  return prisma.importJob.create({
    data: {
      organizationId: params.organizationId,
      actorId: params.actorId,
      entityType: params.entityType,
      filename: params.filename,
      totalRows: params.totalRows,
      rawContent: params.rawContent,
      status: "PENDING",
    },
  });
}

/** Org-scoped load — a foreign-org id or a nonexistent id both resolve to `null`, indistinguishable from each other. */
export async function loadImportJob(organizationId: string, importJobId: string): Promise<ImportJob | null> {
  return prisma.importJob.findFirst({ where: { id: importJobId, organizationId } });
}

/**
 * Persists the server-validated column mapping once accepted at the
 * preview step — org-scoped AND status-scoped (only while still
 * PENDING): a job that has already moved past PENDING (PROCESSING/
 * COMPLETED/FAILED) can never have its mapping silently rewritten out
 * from under an in-flight or already-finished execution. Returns
 * whether the write actually happened (false = wrong org, wrong id, or
 * the job was no longer PENDING).
 */
export async function persistImportMapping(
  organizationId: string,
  importJobId: string,
  mapping: unknown,
): Promise<boolean> {
  const result = await prisma.importJob.updateMany({
    where: { id: importJobId, organizationId, status: "PENDING" },
    data: { mappingJson: mapping as Prisma.InputJsonValue },
  });
  return result.count > 0;
}

/**
 * The transactional single-use replay guard (approved architecture's
 * own explicit requirement — "Implement the replay guard transactionally
 * using ImportJob status/state. Do not rely only on disabling the button
 * in React."). A single conditional `UPDATE ... WHERE status = 'PENDING'`
 * is itself atomic at the Postgres row level: two concurrent calls
 * racing to flip the very same row can never both succeed — exactly one
 * updates 1 row, the other updates 0, with no explicit application-level
 * lock or transaction wrapper needed for that guarantee. Returns whether
 * THIS call won the race (false = already PROCESSING/COMPLETED/FAILED,
 * or a forged/foreign-org id — a double-click, a replayed request, or a
 * cross-tenant id are all rejected the same way).
 */
export async function beginImportExecution(organizationId: string, importJobId: string): Promise<boolean> {
  const result = await prisma.importJob.updateMany({
    where: { id: importJobId, organizationId, status: "PENDING" },
    data: { status: "PROCESSING" },
  });
  return result.count > 0;
}

export async function completeImportJob(
  importJobId: string,
  params: { importedCount: number; skippedCount: number; failedCount: number; rowResults: ImportRowResultEntry[] },
): Promise<void> {
  await prisma.importJob.update({
    where: { id: importJobId },
    data: {
      status: "COMPLETED",
      importedCount: params.importedCount,
      skippedCount: params.skippedCount,
      failedCount: params.failedCount,
      // Bounded independent of totalRows — see MAX_IMPORT_ROW_RESULTS's
      // own doc comment; the counts above are always exact regardless.
      rowResultsJson: params.rowResults.slice(0, MAX_IMPORT_ROW_RESULTS) as unknown as Prisma.InputJsonValue,
      completedAt: new Date(),
      // Never retained past a terminal state (Section 15).
      rawContent: null,
    },
  });
}

/** Only for an unrecoverable, execution-level failure — never a single bad row (that outcome is still completeImportJob, with the row counted under failedCount). `reason` must already be a short, safe, user-facing summary — never a raw stack/SQL error (Section 15/18). */
export async function failImportJob(importJobId: string, reason: string): Promise<void> {
  await prisma.importJob.update({
    where: { id: importJobId },
    data: { status: "FAILED", failureReason: reason, completedAt: new Date(), rawContent: null },
  });
}
