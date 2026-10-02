import { parseEnumParam, parseSearchParam, type RawSearchParams } from "@/lib/list-params";
import { TASK_STATUSES, type TaskStatusValue } from "@/lib/validation/task";

/**
 * Projects & Tasks Work Hub V1 — the Tasks List/Board view switch, mirroring
 * `leads/view-params.ts`'s own `parseLeadView`/`buildLeadsHref` exactly (a
 * pure UI-mode concern, never security-relevant: an invalid/missing value
 * always falls back safely to "list" rather than throwing or widening any
 * query scope — organizationId-based scoping in query.ts/board-query.ts is
 * completely unaffected by this).
 *
 * List remains the default (unlike Leads, which made Pipeline the new
 * default) — the read-only audit found no existing Product convention
 * strongly justifying Board-by-default for a brand-new V1 surface, and
 * defaulting to the already-familiar List is the lower-risk choice.
 */
export const TASK_VIEWS = ["list", "board"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export function parseTaskView(searchParams: RawSearchParams): TaskView {
  return parseEnumParam(searchParams.view, TASK_VIEWS) ?? "list";
}

/**
 * Which single column the Board's own mobile switcher currently shows —
 * a DIFFERENT, dedicated param (`boardStatus`), deliberately never the
 * same `?status=` the List view's own status filter/dropdown uses. Both
 * List and Board's own desktop multi-column view must show every status
 * when no explicit `?status=` filter is set; if the mobile switcher wrote
 * into that same param, switching to List (or the Board's own desktop
 * view) would suddenly and silently filter down to just one status —
 * exactly the "one control silently erases an unrelated one" failure this
 * feature's own locked filter-composition discipline forbids. Falls back
 * safely to the first status ("TODO") for any invalid/missing value —
 * never security-relevant, purely a UI-mode default.
 */
export function parseBoardMobileStatus(searchParams: RawSearchParams): TaskStatusValue {
  const raw = parseSearchParam(searchParams.boardStatus);
  return (TASK_STATUSES as readonly string[]).includes(raw) ? (raw as TaskStatusValue) : TASK_STATUSES[0];
}

/**
 * Builds a `/tasks?...` href from a plain params object, omitting any
 * falsy value entirely rather than emitting an empty query param —
 * identical contract to buildLeadsHref. Used by both the List page's own
 * filter bar/pagination and the Board's own filter-preserving view toggle,
 * so switching `view` never silently drops an active `status`/`priority`/
 * `q`/`mine`/`overdue`/`dueThisWeek`/`sort` filter.
 */
export function buildTasksHref(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value);
  }
  const qs = usp.toString();
  return qs ? `/tasks?${qs}` : "/tasks";
}
