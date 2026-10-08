import type { ClientListParams } from "./query";

export const CLIENT_SAVED_VIEW_SURFACE = "clients" as const;

/**
 * Tables Improvement Slice D2B — the exact, explicit allowlist of
 * canonical Client list params a Saved View may persist: `q`, `status`,
 * `tag`, `sort`. Deliberately excludes `page` (D1's own locked rule,
 * unchanged here) and anything not already an existing canonical URL
 * param. Mirrors quotes/saved-view.ts's own identical module shape.
 *
 * Kept in its own tiny pure module rather than added to ./query.ts, for
 * the identical reason documented in quotes/saved-view.ts's own header
 * comment: ./query.ts imports `Prisma` (for buildClientWhere/
 * buildClientOrderBy's own return types) and is otherwise exclusively
 * consumed by the Server Component page. This module's own href builder
 * below must run on the CLIENT (it builds the "Apply" link's href
 * inside SavedViewsControl) — importing ./query.ts there would risk
 * pulling the generated Prisma client into the browser bundle. `import
 * type` above is erased entirely at build time, so referencing
 * `ClientListParams` as a type only is safe either side of that
 * boundary.
 *
 * Stale custom-status filter hardening interaction (D2B §11, now
 * intentional shipped Product behavior, not a defect to guard against)
 * — `status` here is a live CustomStatusDefinition key, not a fixed
 * enum. A Saved View that stores a `status` key which later becomes
 * unresolvable (never existed in this org at Apply time — the same
 * "unresolved" condition buildClientWhere's own fail-closed branch
 * already handles) is persisted and replayed VERBATIM by this module,
 * exactly like every other value: this module never validates `status`
 * against live CustomStatusDefinition rows (it has no DB access and
 * must not gain any), so the stale intent survives the serialize/apply
 * round-trip unchanged. The resulting zero-rows + "Unavailable status"
 * sentinel rendering on Apply is produced entirely downstream, by the
 * exact same query/page-level fail-closed logic that already handles a
 * stale key typed directly into the URL — there is nothing Saved-View-
 * specific to implement here. `tag` (a Tag id) has an identical "stale
 * id resolves to zero rows, never broadens" fail-closed contract
 * already (see buildClientWhere's own tagFilter comment), and is
 * likewise just an opaque string to this module.
 */
const ALLOWED_KEYS = ["q", "status", "tag", "sort"] as const;

/**
 * Builds the allowlisted, serializable params object a Saved View
 * stores — straight from the already-parsed canonical ClientListParams
 * the page itself resolved (never from a re-parsed/raw query string).
 * An absent/empty value is omitted entirely, mirroring every other
 * surface's own identical "falsy -> omitted" contract. Note the stored
 * key is `tag` (the URL param name), even though the parsed field is
 * `tagId` — this module reads/writes the URL's own vocabulary, not the
 * parsed type's internal field names.
 */
export function serializeClientSavedViewParams(
  listParams: Pick<ClientListParams, "q" | "status" | "tagId" | "sortCombined">,
): Record<string, string> {
  const params: Record<string, string> = {};
  if (listParams.q) params.q = listParams.q;
  if (listParams.status) params.status = listParams.status;
  if (listParams.tagId) params.tag = listParams.tagId;
  if (listParams.sortCombined) params.sort = listParams.sortCombined;
  return params;
}

/**
 * Builds the `/clients?...` href to navigate to when a saved view is
 * applied. Only ever reads the fixed ALLOWED_KEYS above — any other key
 * present in a stored view's own `params` (e.g. a hand-edited
 * localStorage value, or a future surface version) is silently ignored,
 * never replayed into the URL. This never merges with the current
 * page's own URL state — the returned href is built fresh from `params`
 * alone, so applying a view always REPLACES managed view state. The
 * resulting URL is not trusted as validated; it re-enters
 * `parseClientListParams` on the next page load exactly like any other
 * navigation — in particular, omitting `page` here always lands on
 * page 1. A stale `status` or `tag` value is replayed verbatim (D2B
 * §11/§13) — this function performs no resolution/validation of either.
 */
export function buildClientHrefFromSavedViewParams(params: Record<string, string>): string {
  const usp = new URLSearchParams();
  for (const key of ALLOWED_KEYS) {
    const value = params[key];
    if (value) usp.set(key, value);
  }
  const qs = usp.toString();
  return qs ? `/clients?${qs}` : "/clients";
}
