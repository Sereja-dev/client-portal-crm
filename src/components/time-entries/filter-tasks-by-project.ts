/**
 * Time Tracking Phase 2A (Staff UI) — the pure Project -> Task filtering
 * logic behind TimeEntryForm's own dependent select. Split out
 * specifically so it's unit-testable without a DOM/component-interaction
 * harness (this repo has none — see
 * lead-capture-forms/fields-config-editor-logic.ts's own identical
 * precedent and doc comment for the fuller story).
 *
 * No server round-trip is involved: the calling page fetches every
 * organization Task once (each already carrying its own projectId), and
 * this function does a plain in-memory filter over that already-fetched
 * array whenever the selected Project changes — never a new Prisma
 * query. Server/domain validation (createTimeEntry/updateTimeEntry's own
 * Task-belongs-to-Project check) remains the actual authorization
 * boundary; this is a UI convenience only.
 */

export type TimeEntryTaskOption = { id: string; title: string; projectId: string };

/** Every Task belonging to `projectId`, or an empty array when no Project is selected (never "all tasks" — a Task option must always be scoped to a real, currently-selected Project). */
export function filterTasksByProject(tasks: TimeEntryTaskOption[], projectId: string | null): TimeEntryTaskOption[] {
  if (!projectId) {
    return [];
  }
  return tasks.filter((task) => task.projectId === projectId);
}

/** True if `taskId` is one of `tasks`' own ids that also belongs to `projectId` — used to decide whether a Project change must clear the currently-selected Task. */
export function isTaskValidForProject(tasks: TimeEntryTaskOption[], taskId: string, projectId: string | null): boolean {
  return filterTasksByProject(tasks, projectId).some((task) => task.id === taskId);
}
