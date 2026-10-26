/**
 * Free Public Beta — Welcome Banner. Sibling subsystem to
 * `@/lib/table-columns/storage.ts` (and `@/lib/saved-views/storage.ts`),
 * deliberately NOT a modification of either: this is its own
 * independent localStorage namespace, mirroring their exact proven
 * discipline — key shape, version, defensive parse, and read/write
 * operations, no React, no server-only import, so it is safe to import
 * from both a Server Component (nothing here touches `window` at module
 * scope) and a Client Component (every `localStorage` access is
 * deferred to inside a function body, never at import time).
 *
 * Deliberately simpler than those two siblings: this stores a single
 * boolean ("has this user dismissed the beta notice"), never an array,
 * never scoped by organization or surface — see `buildFreeBetaBannerStorageKey`'s
 * own doc comment for why the key is user-only.
 */

export const FREE_BETA_BANNER_STORAGE_VERSION = 1 as const;

type FreeBetaBannerStorageV1 = {
  version: typeof FREE_BETA_BANNER_STORAGE_VERSION;
  dismissed: boolean;
};

/**
 * `aqenra:free-beta-banner:v1:<userId>` — deliberately user-only, never
 * organization-scoped (unlike Table Columns/Saved Views, which legitimately
 * vary per workspace). This notice is about the platform being in public
 * beta, not about any one organization — scoping it per-org would force
 * someone who belongs to several organizations to re-dismiss the
 * identical notice once per org, for no benefit. Deliberately not
 * browser-global either: a bare, unscoped key would incorrectly share
 * dismissal across two different staff accounts signing in on the same
 * shared browser. The explicit `v1` segment lets a genuinely new future
 * notice ship under `v2` without reviving this one — no migration of
 * old keys, just a different literal the day that notice exists.
 */
export function buildFreeBetaBannerStorageKey(userId: string): string {
  return `aqenra:free-beta-banner:v1:${userId}`;
}

/**
 * Defensive parse — never throws. A missing key, invalid JSON, wrong
 * version, malformed root, or a `dismissed` that isn't a boolean all
 * collapse to `false` (the safe default: "show the banner"), mirroring
 * `parseTableColumnsStorage`'s own identical "collapse to a safe
 * default, never throw" contract.
 */
export function parseFreeBetaBannerStorage(raw: string | null): boolean {
  if (!raw) {
    return false;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }
  const root = data as Record<string, unknown>;
  if (root.version !== FREE_BETA_BANNER_STORAGE_VERSION || typeof root.dismissed !== "boolean") {
    return false;
  }
  return root.dismissed;
}

function serializeFreeBetaBannerStorage(dismissed: boolean): string {
  const payload: FreeBetaBannerStorageV1 = { version: FREE_BETA_BANNER_STORAGE_VERSION, dismissed };
  return JSON.stringify(payload);
}

/**
 * Every localStorage read is failure-safe — a thrown SecurityError
 * (storage disabled/blocked) is indistinguishable from "no stored
 * preference yet" from this function's own contract, exactly like a
 * missing key or corrupted JSON. `globalThis.localStorage`, not
 * `window.localStorage` — identical reasoning to `table-columns/
 * storage.ts`'s own identical choice: this repo's unit-test harness
 * (vitest, `environment: "node"`, no `window` global at all) can
 * exercise this module's real read/write/defensive-parse logic directly
 * by installing a minimal stand-in on `globalThis.localStorage`.
 */
export function readFreeBetaBannerDismissed(userId: string): boolean {
  try {
    const key = buildFreeBetaBannerStorageKey(userId);
    return parseFreeBetaBannerStorage(globalThis.localStorage.getItem(key));
  } catch {
    return false;
  }
}

export type WriteFreeBetaBannerDismissedResult = { ok: true } | { ok: false; reason: "write-failed" };

/**
 * Every failure mode (SecurityError, QuotaExceededError, any other
 * browser storage failure) is caught and reported, never thrown into
 * page rendering — the caller's own in-memory "dismissed" state stays
 * fully usable for the current mounted session either way.
 */
export function writeFreeBetaBannerDismissed(userId: string, dismissed: boolean): WriteFreeBetaBannerDismissedResult {
  try {
    const key = buildFreeBetaBannerStorageKey(userId);
    globalThis.localStorage.setItem(key, serializeFreeBetaBannerStorage(dismissed));
    return { ok: true };
  } catch {
    return { ok: false, reason: "write-failed" };
  }
}
