import { parseSearchParam, type RawSearchParams } from "@/lib/list-params";
import { parseTimeEntryWorkDate, isUuid } from "@/lib/validation/time-entry";

/**
 * Time Tracking Phase 2A — the Staff list page's own
 * `?from=&to=&projectId=&userId=&billable=&archived=` filter parsing.
 * Every parser here fails safely to "no filter applied" for a malformed
 * value — never throws, never leaks a raw parse error to the page.
 *
 * `from`/`to` deliberately reuse parseTimeEntryWorkDate (Phase 1's own
 * strict calendar-date parser) — never Activity's own looser
 * `new Date(raw)` parsing (see activity/query.ts's own
 * parseDateInputParam), so a malformed date filter here behaves exactly
 * like a malformed workDate anywhere else in this feature, not a second,
 * more permissive parsing rule.
 */

export function parseTimeEntryFromDateFilter(searchParams: RawSearchParams): Date | undefined {
  const raw = parseSearchParam(searchParams.from);
  if (!raw) return undefined;
  const result = parseTimeEntryWorkDate(raw);
  return result.ok ? result.date : undefined;
}

export function parseTimeEntryToDateFilter(searchParams: RawSearchParams): Date | undefined {
  const raw = parseSearchParam(searchParams.to);
  if (!raw) return undefined;
  const result = parseTimeEntryWorkDate(raw);
  return result.ok ? result.date : undefined;
}

/** Format-only validation, same reasoning as Client Requests' own parseClientRequestAssigneeFilter: a foreign-org id would simply match zero rows anyway (listTimeEntries' own compound WHERE already makes that safe), this only guards a malformed string from ever reaching a `@db.Uuid` column filter. */
export function parseTimeEntryProjectFilter(searchParams: RawSearchParams): string | undefined {
  const raw = parseSearchParam(searchParams.projectId);
  return isUuid(raw) ? raw : undefined;
}

export function parseTimeEntryUserFilter(searchParams: RawSearchParams): string | undefined {
  const raw = parseSearchParam(searchParams.userId);
  return isUuid(raw) ? raw : undefined;
}

export function parseTimeEntryBillableFilter(searchParams: RawSearchParams): boolean | undefined {
  const raw = parseSearchParam(searchParams.billable);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

/**
 * Mobile Improvement Slice B2 — the exact, Product-approved active-count
 * rule for the five fields collapsed into Time's own mobile Filter
 * disclosure: from/to/projectId/userId/billable, each worth at most 1.
 * Takes the already-parsed values directly (page.tsx's own five
 * separate `parseTimeEntry*Filter` calls), not a raw searchParams
 * re-parse. `archived` is intentionally excluded — it's controlled by
 * its own separate "Show archived" link (a view switch, not a filter
 * refinement — see TimeEntryFilterBar's own header comment), never
 * rendered inside this disclosure at all.
 */
export function computeTimeEntryActiveFilterCount(filters: {
  from: Date | undefined;
  to: Date | undefined;
  projectId: string | undefined;
  userId: string | undefined;
  billable: boolean | undefined;
}): number {
  let count = 0;
  if (filters.from) count += 1;
  if (filters.to) count += 1;
  if (filters.projectId) count += 1;
  if (filters.userId) count += 1;
  if (filters.billable !== undefined) count += 1;
  return count;
}
