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
