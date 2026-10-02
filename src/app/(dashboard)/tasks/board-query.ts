import { prisma } from "@/lib/prisma";
import { TASK_STATUSES, type TaskStatusValue } from "@/lib/validation/task";
import { buildTaskWhere, type TaskListParams } from "./query";

/**
 * Task Board V1 — the Board's own query layer. Mirrors Leads Pipeline's
 * own `pipeline-query.ts` architecture (read-only audit §7/§19): every
 * column gets its own bounded, exact-counted query, never one paginated
 * list query reused blindly (which would silently show only the first
 * page of whichever status happens to sort first).
 *
 * Unlike Leads Pipeline, Task's own status set is a small, fixed enum
 * (`TASK_STATUSES`, always exactly 4 values) — never a variable,
 * per-organization-defined set of custom statuses. That's exactly why
 * this can safely use a plain `Promise.all` of exactly 4 independent
 * reads (never a `runWithBoundedConcurrency` worker pool, and never a
 * `prisma.$transaction([...])` batch — the proven Leads Pipeline P2028
 * incident precedent this app's own established lesson forbids): 4 is a
 * small, constant fan-out, not the unbounded/growing one that incident
 * was about.
 */

// A generous, documented cap on how many cards render per column —
// mirrors PIPELINE_STAGE_CARD_BOUND's own reasoning exactly: large enough
// that a normal board renders in full, small enough to bound worst-case
// query/render cost. Never silently pretended to be exhaustive —
// TaskBoardColumn.truncated is exact (computed from the real count, not
// from whether the bound happened to be hit).
export const TASK_BOARD_COLUMN_BOUND = 50;

export type TaskBoardCard = {
  id: string;
  title: string;
  /** Always equal to the column this card is rendered in — selected explicitly (not implied from the column) so `isTaskOverdue` and any other per-card logic never has to trust an external "which column am I in" assumption. */
  status: string;
  priority: string;
  dueDate: Date | null;
  project: { id: string; name: string };
  assignee: { id: string; name: string } | null;
};

export type TaskBoardColumn = {
  status: TaskStatusValue;
  cards: TaskBoardCard[];
  total: number;
  truncated: boolean;
};

/** Filters compose identically to the List view (buildTaskWhere) — the Board respects every active filter, never a second, parallel filter implementation. */
export async function fetchTaskBoardColumns(
  organizationId: string,
  filters: Pick<TaskListParams, "q" | "priority" | "overdue" | "mine" | "dueThisWeek" | "projectId">,
  now: Date,
  currentUserId?: string,
): Promise<TaskBoardColumn[]> {
  const columns = await Promise.all(
    TASK_STATUSES.map(async (status): Promise<TaskBoardColumn> => {
      const where = buildTaskWhere(organizationId, { ...filters, status }, now, currentUserId);
      const [cards, total] = await Promise.all([
        prisma.task.findMany({
          where,
          orderBy: [{ createdAt: "desc" }],
          take: TASK_BOARD_COLUMN_BOUND,
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            project: { select: { id: true, name: true } },
            assignee: { select: { id: true, name: true } },
          },
        }),
        prisma.task.count({ where }),
      ]);
      return { status, cards, total, truncated: total > cards.length };
    }),
  );

  return columns;
}
