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
import { isUuid } from "@/lib/validation/time-entry";

export const TASK_SORT_FIELDS = ["dueDate", "createdAt"] as const;
export type TaskSortField = (typeof TASK_SORT_FIELDS)[number];

export type TaskListParams = {
  q: string;
  status?: (typeof TASK_STATUSES)[number];
  priority?: (typeof TASK_PRIORITIES)[number];
  /** Dashboard Redesign — ?overdue=true: status != DONE AND dueDate < now. See buildTaskWhere's own doc comment for exact composition semantics. */
  overdue: boolean;
  /** Work Hub V1 — ?mine=true: assigneeId = the current Staff member's own user id. A convenience filter, never a security/visibility boundary (every role sees the same org-wide Task set either way) — see buildTaskWhere's own doc comment. */
  mine: boolean;
  /** Work Hub V1 — ?dueThisWeek=true: dueDate within the rolling next-7-UTC-date-only-days window, including today. Deliberately never implies status != DONE — composes independently, same "separate AND entry" discipline as `overdue`. See buildTaskWhere's own doc comment for the exact boundary. */
  dueThisWeek: boolean;
  /** Work Hub V1 — ?projectId=: the Project Hub's own Tasks tab links back here when its own bounded row list is exceeded. Format-validated only (isUuid), same reasoning as Time's own parseTimeEntryProjectFilter: a foreign-org id simply matches zero rows anyway (the compound `project: { organizationId }` filter already makes that safe) — this only guards a malformed string from ever reaching a `@db.Uuid` column filter. */
  projectId?: string;
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
  const mine = parseBooleanParam(searchParams.mine);
  const dueThisWeek = parseBooleanParam(searchParams.dueThisWeek);
  const rawProjectId = parseSearchParam(searchParams.projectId);
  const projectId = isUuid(rawProjectId) ? rawProjectId : undefined;
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
    mine,
    dueThisWeek,
    projectId,
    sortField: field,
    sortDir: dir,
    sortCombined: combined,
    page,
  };
}

/**
 * UTC calendar-day start for `date` — the same small, deliberately
 * un-exported local copy convention `dashboard/query.ts`'s own identical
 * helper already documents (see that file's header comment on
 * `utcDayStart`): no shared "date utils" import, one extra call site each,
 * kept local to whichever module actually needs it.
 */
function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const DUE_THIS_WEEK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The locked V1 "due this week" boundary (read-only audit §9/§16 — a
 * genuinely open architecture question the audit deliberately left for
 * this cycle to resolve): a rolling next-`DUE_THIS_WEEK_DAYS`-UTC-date-only
 * -days window, including today, NOT an organization-timezone calendar
 * week (Mon–Sun) — deliberately the lower-friction choice that reuses this
 * same file's own `overdue`/"today" boundary style (UTC calendar-day
 * start, exactly matching `dashboard/query.ts`'s own `todayStart`/
 * `todayEnd`) rather than introducing new org-timezone infrastructure for
 * this one filter. Exported so tests can assert the exact boundary
 * (today included, day+6 included, day+7 excluded) without re-deriving it.
 */
export function dueThisWeekRange(now: Date): { start: Date; end: Date } {
  const start = utcDayStart(now);
  const end = new Date(start.getTime() + DUE_THIS_WEEK_DAYS * DAY_MS);
  return { start, end };
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
  { q, status, priority, overdue, mine, dueThisWeek, projectId }: Pick<
    TaskListParams,
    "q" | "status" | "priority" | "overdue" | "mine" | "dueThisWeek" | "projectId"
  >,
  now: Date,
  /** Required only when `mine` is true — the authenticated Staff member's own user id. Never resolved inside this pure query builder (see this function's own existing "no wall-clock read" discipline; the caller already has it from getCurrentMembership()). */
  currentUserId?: string,
): Prisma.TaskWhereInput {
  const conditions: Prisma.TaskWhereInput[] = [{ project: { organizationId } }];
  if (projectId) conditions.push({ projectId });
  if (status) conditions.push({ status });
  if (priority) conditions.push({ priority });
  if (overdue) conditions.push({ status: { not: "DONE" }, dueDate: { lt: now } });
  // Composed as its own separate AND entry, same reasoning as `overdue`
  // above — never merged into the same literal as an explicit `status`
  // filter, so `?dueThisWeek=true&status=DONE` deterministically returns
  // only genuinely-due-this-week DONE tasks, never a silently-widened or
  // silently-dropped filter.
  if (dueThisWeek) {
    const { start, end } = dueThisWeekRange(now);
    conditions.push({ dueDate: { gte: start, lt: end } });
  }
  // `mine` is a convenience filter, not a security boundary (see
  // TaskListParams's own doc comment) — every role composes it
  // identically. Omitted entirely (never `assigneeId: null`) if no
  // currentUserId was supplied, so a caller that forgets to pass it gets
  // "no filter applied", never an accidental "show nothing" or "show only
  // unassigned" surprise.
  if (mine && currentUserId) {
    conditions.push({ assigneeId: currentUserId });
  }
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
