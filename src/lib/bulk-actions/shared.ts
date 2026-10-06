/**
 * Tables Improvement Slice C — the one shared constant/type every bulk
 * surface (client-side cap-awareness hook, each domain's own server-side
 * bulk-actions.ts) needs, mirroring src/lib/tasks/bulk-types.ts's own
 * exact precedent and its own stated reason for existing as a tiny,
 * standalone module: a "use server" file can only ever export async
 * functions (re-exporting a const/type from one breaks the build), and a
 * "use client" file is its own boundary — a plain module with NEITHER
 * directive is the one thing safely importable from both sides.
 *
 * Deliberately NOT a per-domain duplicate (ContractBulkMax,
 * RequestBulkMax, ...) — one shared ceiling, reused everywhere, so a
 * future change to the limit can never update one domain's enforcement
 * and silently miss another.
 */
export const BULK_SELECTION_MAX = 50;

export type BulkActionResult = {
  updatedCount: number;
  failedCount: number;
  /** Bounded — at most one entry per failed id, never the full selection echoed back. */
  failures: { id: string; reason: string }[];
};
