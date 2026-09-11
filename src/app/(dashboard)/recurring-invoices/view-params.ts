import { parseSearchParam, type RawSearchParams } from "@/lib/list-params";

/**
 * Recurring Invoices Phase 2A — the Staff list page's own `?status=&clientId=`
 * filter parsing. Every parser here fails safely to "no filter applied"
 * for a malformed value — never throws — same discipline Time Tracking's
 * own view-params.ts already established. Only status and client are
 * supported filters in V1 (see the approved Phase 2 spec's own explicit
 * "no frequency filter, no project filter, no occurrence-status filter,
 * no full-text search" scope).
 */

const STATUS_VALUES = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;
export type RecurringInvoiceStatusFilter = (typeof STATUS_VALUES)[number];

export function parseRecurringInvoiceStatusFilter(searchParams: RawSearchParams): RecurringInvoiceStatusFilter | undefined {
  const raw = parseSearchParam(searchParams.status);
  return raw && (STATUS_VALUES as readonly string[]).includes(raw) ? (raw as RecurringInvoiceStatusFilter) : undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Format-only validation — a foreign-org id would simply match zero rows anyway (listRecurringInvoices' own compound WHERE already makes that safe); this only guards a malformed string from ever reaching a `@db.Uuid` column filter. */
export function parseRecurringInvoiceClientFilter(searchParams: RawSearchParams): string | undefined {
  const raw = parseSearchParam(searchParams.clientId);
  return raw && UUID_PATTERN.test(raw) ? raw : undefined;
}
