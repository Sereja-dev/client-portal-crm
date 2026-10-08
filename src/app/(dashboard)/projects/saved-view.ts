import type { ProjectListParams } from "./query";

export const PROJECT_SAVED_VIEW_SURFACE = "projects" as const;

/**
 * Tables Improvement Slice D2B — the exact, explicit allowlist of
 * canonical Project list params a Saved View may persist: `q`,
 * `status`, `sort`. Deliberately excludes `page` (D1's own locked rule,
 * unchanged here) and anything not already an existing canonical URL
 * param. Mirrors clients/saved-view.ts's own identical module shape
 * (minus `tag`, which Projects has no equivalent of).
 *
 * Kept in its own tiny pure module rather than added to ./query.ts —
 * see clients/saved-view.ts's own header comment for the full "why"
 * (./query.ts imports `Prisma`; this module's href builder must run on
 * the CLIENT and must not risk pulling the generated Prisma client into
 * the browser bundle). `import type` is erased entirely at build time.
 *
 * Stale custom-status filter hardening interaction (D2B §11, now
 * intentional shipped Product behavior) — see clients/saved-view.ts's
 * own identical comment; `status` here is likewise a live
 * CustomStatusDefinition key, persisted and replayed verbatim with no
 * resolution/validation performed by this module. The resulting
 * zero-rows + "Unavailable status" sentinel rendering on Apply is
 * produced entirely downstream by buildProjectWhere/projects/page.tsx's
 * own existing fail-closed logic.
 */
const ALLOWED_KEYS = ["q", "status", "sort"] as const;

/**
 * Builds the allowlisted, serializable params object a Saved View
 * stores — straight from the already-parsed canonical ProjectListParams
 * the page itself resolved (never from a re-parsed/raw query string).
 * An absent/empty value is omitted entirely, mirroring every other
 * surface's own identical "falsy -> omitted" contract.
 */
export function serializeProjectSavedViewParams(
  listParams: Pick<ProjectListParams, "q" | "status" | "sortCombined">,
): Record<string, string> {
  const params: Record<string, string> = {};
  if (listParams.q) params.q = listParams.q;
  if (listParams.status) params.status = listParams.status;
  if (listParams.sortCombined) params.sort = listParams.sortCombined;
  return params;
}

/**
 * Builds the `/projects?...` href to navigate to when a saved view is
 * applied. Only ever reads the fixed ALLOWED_KEYS above — any other key
 * present in a stored view's own `params` is silently ignored, never
 * replayed into the URL. This never merges with the current page's own
 * URL state — the returned href is built fresh from `params` alone, so
 * applying a view always REPLACES managed view state. The resulting URL
 * re-enters `parseProjectListParams` on the next page load exactly like
 * any other navigation — omitting `page` here always lands on page 1. A
 * stale `status` value is replayed verbatim (D2B §11) — this function
 * performs no resolution/validation of it.
 */
export function buildProjectHrefFromSavedViewParams(params: Record<string, string>): string {
  const usp = new URLSearchParams();
  for (const key of ALLOWED_KEYS) {
    const value = params[key];
    if (value) usp.set(key, value);
  }
  const qs = usp.toString();
  return qs ? `/projects?${qs}` : "/projects";
}
