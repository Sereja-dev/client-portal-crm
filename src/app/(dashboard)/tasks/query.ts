import { Prisma } from "@/generated/prisma/client";
import {
  parseSearchParam,
  parsePageParam,
  parseEnumParam,
  parseBooleanParam,
  parseSortParam,
  type RawSearchParams,
} from "@/lib/list-params";
import { TASK_STATUSES, TASK_PRIORITIES } from "@/lib/validation/task";

export const TASK_SORT_FIELDS = ["dueDate", "createdAt"] as const;
export type TaskSortField = (typeof TASK_SORT_FIELDS)[number];

export type TaskListParams = {
  q: string;
  status?: (typeof TASK_STATUSES)[number];
  priority?: (typeof TASK_PRIORITIES)[number];
  /** Dashboard Redesign — ?overdue=true: status != DONE AND dueDate < now. See buildTaskWhere's own doc comment for exact composition semantics. */
  overdue: boolean;
  sortField: TaskSortField;
  sortDir: "asc" | "desc";
  sortCombined: string;
  page: number;
};

export function parseTaskListParams(
  searchParams: RawSearchParams,
): TaskListParams {
  const q = parseSearchParam(searchParams.q);
  const status = parseEnumParam(searchParams.status, TASK_STATUSES);
  const priority = parseEnumParam(searchParams.priority, TASK_PRIORITIES);
  const overdue = parseBooleanParam(searchParams.overdue);
  const { field, dir, combined } = parseSortParam(
    searchParams.sort,
    TASK_SORT_FIELDS,
    "createdAt:desc",
  );
  const page = parsePageParam(searchParams.page);

  return {
    q,
    status,
    priority,
    overdue,
    sortField: field,
    sortDir: dir,
    sortCombined: combined,
    page,
  };
}

/**
 * `now` is always caller-supplied (never `new Date()` inside here),
 * matching this app's own established "no wall-clock read inside a pure
 * query builder" discipline (e.g. dashboard/query.ts).
 *
 * The `overdue` condition is composed as its own separate `AND` entry,
 * never merged into the same object literal as an explicit `status`
 * filter — a plain object spread would let whichever key comes second
 * silently overwrite the other's `status` constraint, which would either
 * silently drop the user's own explicit status filter or silently weaken
 * the overdue definition depending on ordering. Kept as separate AND
 * conditions instead: `status != DONE` (from `overdue`) and an explicit
 * `status = DONE` (if the caller also passed one) are both true
 * conditions on the SAME field simultaneously — a real, deterministic
 * contradiction Postgres correctly evaluates to zero rows, never a
 * silently-overridden filter. This is the locked behavior for
 * `?status=DONE&overdue=true`: no results, not a weakened overdue
 * definition and not a silently-dropped status filter.
 */
export function buildTaskWhere(
  organizationId: string,
  { q, status, priority, overdue }: Pick<TaskListParams, "q" | "status" | "priority" | "overdue">,
  now: Date,
): Prisma.TaskWhereInput {
  const conditions: Prisma.TaskWhereInput[] = [{ project: { organizationId } }];
  if (status) conditions.push({ status });
  if (priority) conditions.push({ priority });
  if (overdue) conditions.push({ status: { not: "DONE" }, dueDate: { lt: now } });
  if (q) {
    conditions.push({
      OR: [
        { title: { contains: q, mode: "insensitive" as const } },
        { project: { name: { contains: q, mode: "insensitive" as const } } },
      ],
    });
  }
  return conditions.length === 1 ? conditions[0] : { AND: conditions };
}

export function buildTaskOrderBy(
  params: Pick<TaskListParams, "sortField" | "sortDir">,
): Prisma.TaskOrderByWithRelationInput {
  return { [params.sortField]: params.sortDir };
}
