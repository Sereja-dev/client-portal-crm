import { parseEnumParam, parseSearchParam, type RawSearchParams } from "@/lib/list-params";
import { CLIENT_REQUEST_STATUSES, CLIENT_REQUEST_PRIORITIES, type ClientRequestStatusValue, type ClientRequestPriorityValue } from "@/lib/validation/client-request";

/**
 * Client Requests / Tickets Phase 2A — the Staff list page's own simple
 * `?status=&priority=&assignedTo=` filter bar. Deliberately no free-text
 * search/sort/pagination params — "Do not build a complex search engine
 * in this phase" (§"STAFF LIST").
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseClientRequestStatusFilter(searchParams: RawSearchParams): ClientRequestStatusValue | undefined {
  return parseEnumParam(searchParams.status, CLIENT_REQUEST_STATUSES);
}

export function parseClientRequestPriorityFilter(searchParams: RawSearchParams): ClientRequestPriorityValue | undefined {
  return parseEnumParam(searchParams.priority, CLIENT_REQUEST_PRIORITIES);
}

/**
 * Format-only validation (a well-formed UUID) — same division of
 * responsibility as parseLeadInput's own assignedToUserId comment:
 * whether this id actually belongs to a real Membership in the caller's
 * organization is a database check the domain layer's own filter
 * performs implicitly (a non-matching id simply returns zero rows, never
 * an error) — this parser only guards against a malformed string ever
 * reaching a `@db.Uuid` column filter, which Postgres would otherwise
 * reject with a raw type error instead of an empty result.
 */
export function parseClientRequestAssigneeFilter(searchParams: RawSearchParams): string | undefined {
  const raw = parseSearchParam(searchParams.assignedTo);
  return UUID_PATTERN.test(raw) ? raw : undefined;
}
