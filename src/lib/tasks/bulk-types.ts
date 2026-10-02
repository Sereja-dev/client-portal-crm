/**
 * Bulk Task actions V1 — the shared constant/type both the server actions
 * (bulk-actions.ts, a "use server" file — which can only ever export
 * async functions, nothing else) and the client toolbar component
 * (task-bulk-toolbar.tsx) need. Deliberately its own tiny, plain module
 * (no "use server", no "server-only") so it's safe to import from either
 * side.
 */
export const TASK_BULK_MAX = 50;

export type BulkTaskActionResult = {
  updatedCount: number;
  failedCount: number;
  /** Bounded — at most one entry per failed id, never the full selection echoed back. */
  failures: { taskId: string; reason: string }[];
};
