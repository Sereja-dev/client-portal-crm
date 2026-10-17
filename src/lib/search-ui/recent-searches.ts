import type { SearchResultType } from "@/lib/search/types";

/**
 * Global Search Slice B (Search Improvement — recent selected results).
 * Browser-local storage only, mirroring saved-views/storage.ts's own
 * entire discipline (key shape, version, defensive parse, no React, no
 * server-only import — safe to import from both a Server and a Client
 * Component, since every `localStorage` access is deferred to inside a
 * function body, never at import time).
 *
 * This stores only the minimal metadata of a search RESULT the user
 * actually selected -- never the raw query text they typed to find it,
 * never a Comment's full body (only the same bounded title/subtitle
 * Global Search itself already shows), and nothing beyond the existing
 * SearchResult shape's own already-display-safe fields.
 */

export const RECENT_SEARCH_RESULTS_VERSION = 1 as const;

/** Approved V1 bound (Slice B spec §8) — not configurable. */
export const MAX_RECENT_SEARCH_RESULTS = 6;

/**
 * Deliberately a subset of SearchResult (src/lib/search/types.ts) --
 * `preview` (a Comment's bounded body snippet) is never part of this
 * shape at all, not even optionally. The one call site that constructs
 * this (search-dialog.tsx's own selection handler) only ever copies
 * type/id/title/subtitle/url off a real SearchResult, so a Comment's
 * preview text can never reach storage even by accident.
 */
export type RecentSearchResult = {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
};

type RecentSearchResultsStorageV1 = {
  version: typeof RECENT_SEARCH_RESULTS_VERSION;
  results: RecentSearchResult[];
};

const SEARCH_RESULT_TYPES: readonly SearchResultType[] = ["CLIENT", "PROJECT", "TASK", "INVOICE", "COMMENT"];

/**
 * `aqenra:search:recent:v1:<organizationId>:<userId>` -- organization +
 * user + format version all present in every key, the exact same proven
 * shape `buildSavedViewsStorageKey` already uses, so switching identity
 * or organization in the same browser can never read another identity's
 * or org's recent results, and a future v2 shape can never collide with
 * v1 keys left behind by an older build. No surface segment (unlike
 * saved views): there is exactly one Global Search per user+org, not one
 * per list page.
 */
export function buildRecentSearchResultsStorageKey(organizationId: string, userId: string): string {
  return `aqenra:search:recent:v1:${organizationId}:${userId}`;
}

/**
 * Accepts only an internal, relative, same-origin path -- never a
 * protocol, never a protocol-relative `//host/...` string, never
 * anything that could be interpreted as pointing off this app. Mirrors
 * the minimum bar Slice B's own spec calls for: a leading `/`, no `//`,
 * no embedded scheme. Search result URLs are always server-built from
 * result-links.ts's own allowlisted templates before they ever reach
 * this storage, but a value read back from localStorage is untrusted by
 * definition (another script, a stale/tampered entry, manual editing of
 * devtools storage) -- so this is re-validated on every read, not just
 * trusted because it was presumably written by this same module once.
 */
export function isSafeInternalResultUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!value.startsWith("/")) return false;
  // Rejects "//evil.example" (protocol-relative) and a bare "/" with
  // nothing after it, which is never a real Search result destination.
  if (value.startsWith("//")) return false;
  // Rejects an embedded scheme before the first real path segment, e.g.
  // a (structurally invalid here, but defensively checked anyway) value
  // like "/\t/evil" that browsers can still interpret as "javascript:"
  // after whitespace-stripping, or a literal "/javascript:alert(1)"
  // that itself contains a colon before any further slash.
  const firstSlashAfterStart = value.indexOf("/", 1);
  const schemeBoundary = firstSlashAfterStart === -1 ? value.length : firstSlashAfterStart;
  if (value.slice(0, schemeBoundary).includes(":")) return false;
  return true;
}

function isSearchResultType(value: unknown): value is SearchResultType {
  return typeof value === "string" && (SEARCH_RESULT_TYPES as readonly string[]).includes(value);
}

function isValidRecentSearchResultEntry(value: unknown): value is RecentSearchResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isSearchResultType(candidate.type) &&
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.title === "string" &&
    candidate.title.length > 0 &&
    (candidate.subtitle === null || typeof candidate.subtitle === "string") &&
    isSafeInternalResultUrl(candidate.url)
  );
}

/**
 * Defensive parse -- never throws. A missing key, invalid JSON, wrong
 * version, or a malformed root all collapse to `[]`; a malformed
 * INDIVIDUAL entry inside an otherwise-valid array is skipped rather
 * than invalidating the whole list -- identical discipline to
 * parseSavedViewsStorage.
 */
export function parseRecentSearchResults(raw: string | null): RecentSearchResult[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return [];
  }
  const root = data as Record<string, unknown>;
  if (root.version !== RECENT_SEARCH_RESULTS_VERSION || !Array.isArray(root.results)) {
    return [];
  }
  return root.results.filter(isValidRecentSearchResultEntry).slice(0, MAX_RECENT_SEARCH_RESULTS);
}

function serializeRecentSearchResults(results: RecentSearchResult[]): string {
  const payload: RecentSearchResultsStorageV1 = { version: RECENT_SEARCH_RESULTS_VERSION, results };
  return JSON.stringify(payload);
}

/**
 * Every localStorage read is failure-safe -- a thrown SecurityError
 * (storage disabled/blocked) is indistinguishable from "no recents yet"
 * from this function's own contract, exactly like a missing key or
 * corrupted JSON. `globalThis.localStorage`, not `window.localStorage`,
 * for the same Node-test-environment reason readSavedViews documents.
 */
export function readRecentSearchResults(organizationId: string, userId: string): RecentSearchResult[] {
  try {
    const key = buildRecentSearchResultsStorageKey(organizationId, userId);
    return parseRecentSearchResults(globalThis.localStorage.getItem(key));
  } catch {
    return [];
  }
}

function writeRecentSearchResults(organizationId: string, userId: string, results: RecentSearchResult[]): void {
  try {
    const key = buildRecentSearchResultsStorageKey(organizationId, userId);
    globalThis.localStorage.setItem(key, serializeRecentSearchResults(results));
  } catch {
    // SecurityError, QuotaExceededError, or any other browser storage
    // failure: the caller's own in-memory list (already computed before
    // this call) stays fully usable for the rest of this session: a
    // write failure must never block navigation or throw into React.
  }
}

/**
 * Adds (or, if the same type+id already exists, moves to front) one
 * selected result, newest-first, trimmed to MAX_RECENT_SEARCH_RESULTS.
 * Always returns the computed next list, even if the underlying write
 * failed -- callers that only care about updating their own in-memory UI
 * state can use this return value directly without a second read.
 */
export function addRecentSearchResult(
  organizationId: string,
  userId: string,
  result: RecentSearchResult,
): RecentSearchResult[] {
  const existing = readRecentSearchResults(organizationId, userId);
  const deduped = existing.filter((r) => !(r.type === result.type && r.id === result.id));
  const next = [result, ...deduped].slice(0, MAX_RECENT_SEARCH_RESULTS);
  writeRecentSearchResults(organizationId, userId, next);
  return next;
}

/** Removes only this organizationId+userId's own recent-results key -- never any other localStorage entry (saved views, table columns, theme, etc.). */
export function clearRecentSearchResults(organizationId: string, userId: string): void {
  try {
    const key = buildRecentSearchResultsStorageKey(organizationId, userId);
    globalThis.localStorage.removeItem(key);
  } catch {
    // Same fail-safe reasoning as writeRecentSearchResults above.
  }
}
