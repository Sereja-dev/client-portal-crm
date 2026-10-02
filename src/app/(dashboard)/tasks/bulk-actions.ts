"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { changeTaskStatus, changeTaskAssignee, changeTaskPriority, type TaskMutationResult } from "@/lib/tasks/mutations";
import { TASK_BULK_MAX, type BulkTaskActionResult } from "@/lib/tasks/bulk-types";

/**
 * Bulk Task actions V1 (read-only audit §10/§21-§23) — LIST VIEW ONLY.
 * Allowed V1 actions: change status, change assignee, change priority.
 * Deliberately NOT bulk delete/archive/due-date/project-move — deferred
 * from V1 as destructive/ambiguous (see the audit's own §10 recommendation).
 *
 * Bounded, never a giant variable-size `prisma.$transaction([...])` across
 * every selected row (the proven Leads Pipeline P2028 anti-pattern this
 * app's own established lesson forbids) — each Task is processed as its
 * own independent, already-transactional call into
 * `src/lib/tasks/mutations.ts` (the exact same domain functions Task
 * Board's own single-card drop uses, so single/Board/Bulk semantics can
 * never drift — read-only audit §24). A stale/cross-org id fails safely
 * for that one row only (NOT_FOUND) — it can never mutate another
 * tenant's row, and never aborts the rows that DID succeed.
 *
 * `TASK_BULK_MAX`/`BulkTaskActionResult` live in their own plain
 * `bulk-types.ts` module, not here — this file has a top-level "use
 * server" directive, and Next.js requires every export of such a file to
 * be an async function; re-exporting a const/type from here breaks the
 * build ("The module has no exports at all" — confirmed directly).
 */
async function runBulk(taskIds: string[], mutate: (taskId: string) => Promise<TaskMutationResult>): Promise<BulkTaskActionResult> {
  // Never trusts the client-supplied count alone — hard-capped
  // server-side regardless of what the UI's own selection limit already
  // enforces.
  const boundedIds = taskIds.slice(0, TASK_BULK_MAX);

  let updatedCount = 0;
  const failures: { taskId: string; reason: string }[] = [];

  for (const taskId of boundedIds) {
    const result = await mutate(taskId);
    if (result.ok) {
      updatedCount++;
    } else {
      failures.push({ taskId, reason: result.reason });
    }
  }

  revalidatePath("/tasks");
  return { updatedCount, failedCount: failures.length, failures };
}

export async function bulkUpdateTaskStatusAction(taskIds: string[], newStatus: string): Promise<BulkTaskActionResult> {
  if (taskIds.length > TASK_BULK_MAX) {
    return { updatedCount: 0, failedCount: taskIds.length, failures: [{ taskId: "", reason: "TOO_MANY_SELECTED" }] };
  }
  const { user, organizationId } = await getCurrentUserOrganization();
  return runBulk(taskIds, (taskId) => changeTaskStatus(organizationId, { id: user.id, name: user.name }, taskId, newStatus));
}

export async function bulkUpdateTaskAssigneeAction(
  taskIds: string[],
  assigneeId: string | null,
): Promise<BulkTaskActionResult> {
  if (taskIds.length > TASK_BULK_MAX) {
    return { updatedCount: 0, failedCount: taskIds.length, failures: [{ taskId: "", reason: "TOO_MANY_SELECTED" }] };
  }
  const { user, organizationId } = await getCurrentUserOrganization();
  return runBulk(taskIds, (taskId) =>
    changeTaskAssignee(organizationId, { id: user.id, name: user.name }, taskId, assigneeId),
  );
}

export async function bulkUpdateTaskPriorityAction(taskIds: string[], newPriority: string): Promise<BulkTaskActionResult> {
  if (taskIds.length > TASK_BULK_MAX) {
    return { updatedCount: 0, failedCount: taskIds.length, failures: [{ taskId: "", reason: "TOO_MANY_SELECTED" }] };
  }
  const { user, organizationId } = await getCurrentUserOrganization();
  return runBulk(taskIds, (taskId) =>
    changeTaskPriority(organizationId, { id: user.id, name: user.name }, taskId, newPriority),
  );
}
