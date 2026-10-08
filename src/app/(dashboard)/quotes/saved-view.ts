import type { QuoteListParams } from "./query";

export const QUOTE_SAVED_VIEW_SURFACE = "quotes" as const;

/**
 * Tables Improvement Slice D2A — the exact, explicit allowlist of
 * canonical Quote list params a Saved View may persist: `q`, `status`,
 * `targetType`, `archived`, `sort`. Deliberately excludes `page` (D1's
 * own locked rule, unchanged here) and anything not already an existing
 * canonical URL param.
 *
 * Kept in its own tiny pure module rather than added to ./query.ts, for
 * the identical reason documented in invoices/saved-view.ts's and
 * contracts/saved-view.ts's own header comments: ./query.ts imports
 * `Prisma` (for `buildQuoteOrderBy`'s own return type) and is otherwise
 * exclusively consumed by the Server Component page. This module's own
 * href builder below must run on the CLIENT (it builds the "Apply"
 * link's href inside SavedViewsControl) — importing ./query.ts there
 * would risk pulling the generated Prisma client into the browser
 * bundle. `import type` above is erased entirely at build time, so
 * referencing `QuoteListParams` as a type only is safe either side of
 * that boundary.
 *
 * Quotes has no stale-entity-filter risk at all (confirmed by the
 * dedicated D2 readiness audit, re-verified here before implementing):
 * `status` is a fixed literal enum (QUOTE_STATUS_FILTER_VALUES,
 * including the two derived EXPIRED/CONVERTED pseudo-values, which are
 * themselves just fixed strings, never tied to any deletable row) and
 * `targetType` is a fixed 2-value enum — neither is a live
 * CustomStatusDefinition key or a foreign-key id, so there is no
 * "unresolved key" failure mode for this module to guard against, and
 * no sentinel/fail-closed remediation is needed here.
 */
const ALLOWED_KEYS = ["q", "status", "targetType", "archived", "sort"] as const;

/**
 * Builds the allowlisted, serializable params object a Saved View
 * stores — straight from the already-parsed canonical QuoteListParams
 * the page itself resolved (never from a re-parsed/raw query string).
 * An absent/empty value is omitted entirely, mirroring the Invoice/
 * Contract serializers' own identical "falsy -> omitted" contract. A
 * derived status value (EXPIRED/CONVERTED) is stored as-is — it's
 * already just the canonical filter string the page itself accepted,
 * with no separate encoding.
 */
export function serializeQuoteSavedViewParams(
  listParams: Pick<QuoteListParams, "q" | "status" | "targetType" | "archived" | "sortCombined">,
): Record<string, string> {
  const params: Record<string, string> = {};
  if (listParams.q) params.q = listParams.q;
  if (listParams.status) params.status = listParams.status;
  if (listParams.targetType) params.targetType = listParams.targetType;
  if (listParams.archived) params.archived = "1";
  if (listParams.sortCombined) params.sort = listParams.sortCombined;
  return params;
}

/**
 * Builds the `/quotes?...` href to navigate to when a saved view is
 * applied. Only ever reads the fixed ALLOWED_KEYS above — any other key
 * present in a stored view's own `params` (e.g. a hand-edited
 * localStorage value, or a future surface version) is silently ignored,
 * never replayed into the URL. This never merges with the current
 * page's own URL state — the returned href is built fresh from `params`
 * alone, so applying a view always REPLACES managed view state. The
 * resulting URL is not trusted as validated; it re-enters
 * `parseQuoteListParams` on the next page load exactly like any other
 * navigation — in particular, omitting `page` here always lands on
 * page 1.
 */
export function buildQuoteHrefFromSavedViewParams(params: Record<string, string>): string {
  const usp = new URLSearchParams();
  for (const key of ALLOWED_KEYS) {
    const value = params[key];
    if (value) usp.set(key, value);
  }
  const qs = usp.toString();
  return qs ? `/quotes?${qs}` : "/quotes";
}
