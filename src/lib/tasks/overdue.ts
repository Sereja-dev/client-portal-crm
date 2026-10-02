/**
 * Projects & Tasks Work Hub V1 — the one canonical "is this Task overdue"
 * check, reused everywhere a Task is rendered (global Task List, Task
 * Board cards, Project Hub's own Tasks tab). Never re-derived ad hoc per
 * surface — this is exactly the existing rule `tasks/query.ts`'s own
 * `buildTaskWhere` and `dashboard/query.ts` already established and
 * enforce server-side (`status != DONE && dueDate < now`); this helper
 * exists only so client-rendered rows (which already have the row's own
 * `status`/`dueDate` in hand from a bounded query) can show the same
 * indicator without a second round trip, never a client-side reimplementation
 * of the semantic itself.
 *
 * A task with no due date is never overdue — `null` fails the comparison
 * safely by construction (never coerced to a "far past"/"far future"
 * sentinel). A DONE task is never overdue regardless of dueDate, matching
 * the read-only audit's own explicit "DONE safety" requirement.
 */
export function isTaskOverdue(
  task: { status: string; dueDate: Date | string | null },
  now: Date,
): boolean {
  if (task.status === "DONE" || task.dueDate === null) {
    return false;
  }
  const dueDate = task.dueDate instanceof Date ? task.dueDate : new Date(task.dueDate);
  return dueDate.getTime() < now.getTime();
}
