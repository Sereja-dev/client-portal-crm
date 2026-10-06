import type { ContractListParams } from "./query";

export const CONTRACT_SAVED_VIEW_SURFACE = "contracts" as const;

/**
 * Tables Improvement Slice D1 — the exact, explicit allowlist of
 * canonical Contract list params a Saved View may persist (locked spec
 * §10): `q`, `status`, `client`, `project`, `archived`, `sort`. No
 * selected-row/bulk-selection state, no row-menu state, no derived
 * display status, no separate quick-chip identity — all of those are
 * either transient UI state or already fully represented by `status`.
 *
 * Kept in its own tiny pure module rather than added to ./query.ts, for
 * the identical reason documented in invoices/saved-view.ts's own header
 * comment: ./query.ts imports `Prisma` for a type, and this module's own
 * href builder below must run on the CLIENT (building the "Apply" link
 * inside SavedViewsControl) — importing ./query.ts there would risk
 * pulling the generated Prisma client into the browser bundle.
 */
const ALLOWED_KEYS = ["q", "status", "client", "project", "archived", "sort"] as const;

/**
 * Builds the allowlisted, serializable params object a Saved View
 * stores — straight from the already-parsed canonical ContractListParams
 * the page itself resolved (locked spec §11). A stale/foreign-org
 * `clientId`/`projectId` is stored verbatim, exactly as the canonical
 * state already holds it — this function has no awareness of, and does
 * not weaken, the stale-entity-filter fail-closed fix (contracts/
 * query.ts's own `buildContractEntityFilterOptions`); it only mirrors
 * whatever `listParams` already is (locked spec §10/§29).
 */
export function serializeContractSavedViewParams(
  listParams: Pick<ContractListParams, "q" | "status" | "clientId" | "projectId" | "archived" | "sortCombined">,
): Record<string, string> {
  const params: Record<string, string> = {};
  if (listParams.q) params.q = listParams.q;
  if (listParams.status) params.status = listParams.status;
  if (listParams.clientId) params.client = listParams.clientId;
  if (listParams.projectId) params.project = listParams.projectId;
  if (listParams.archived) params.archived = "1";
  if (listParams.sortCombined) params.sort = listParams.sortCombined;
  return params;
}

/**
 * Builds the `/contracts?...` href to navigate to when a saved view is
 * applied. Only ever reads the fixed ALLOWED_KEYS above, silently
 * ignoring any other stored key (locked spec §9). A stored stale
 * `client`/`project` id is passed straight through unchanged — applying
 * such a view lands on exactly the same URL the user was on when they
 * saved it, which re-enters `parseContractListParams` +
 * `buildContractEntityFilterOptions` fresh on that next page load,
 * naturally reproducing the fail-closed "Unavailable client"/
 * "Unavailable project" sentinel with zero new logic (locked spec §29).
 * Never merges with the current page's own URL state (locked spec §19).
 */
export function buildContractHrefFromSavedViewParams(params: Record<string, string>): string {
  const usp = new URLSearchParams();
  for (const key of ALLOWED_KEYS) {
    const value = params[key];
    if (value) usp.set(key, value);
  }
  const qs = usp.toString();
  return qs ? `/contracts?${qs}` : "/contracts";
}
