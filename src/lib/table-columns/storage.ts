/**
 * Tables Improvement Slice E1 — Column Customization V1. Sibling
 * subsystem to `@/lib/saved-views/storage.ts`, deliberately NOT a
 * modification of it: column visibility and Saved Views are two
 * independent localStorage namespaces that must never read or write
 * each other's keys (locked spec §17 — "Saved Views remain filter/sort
 * state only"). This module owns the entire storage contract for
 * Column Customization — key shape, version, defensive parse, and the
 * read/write/normalize operations — mirroring `saved-views/storage.ts`'s
 * own proven discipline exactly: no React, no domain enum, no
 * server-only import, so it is safe to import from both a Server
 * Component (nothing here touches `window` at module scope) and a
 * Client Component (every `localStorage` access is deferred to inside a
 * function body, never at import time).
 *
 * Deliberately NOT responsible for: which columns a given surface has,
 * their labels, or which ones are mandatory (that metadata is owned by
 * each surface's own small column-metadata module, e.g.
 * `src/app/(dashboard)/invoices/columns.ts`), or any React state/
 * hydration concern (owned by `src/components/list/use-table-columns.ts`).
 */

export const TABLE_COLUMNS_STORAGE_VERSION = 1 as const;

/**
 * Stable, explicit surface identifiers — never derived from `pathname`,
 * matching Saved Views' own identical reasoning. Starts with exactly
 * one value (locked spec §38 — Invoices only in this slice); widening
 * this union is how a future slice adds a second surface, exactly
 * mirroring how `SavedViewSurface` has been widened once per Saved
 * Views slice.
 */
export type TableColumnsSurface = "invoices";

type TableColumnsStorageV1 = {
  version: typeof TABLE_COLUMNS_STORAGE_VERSION;
  hiddenIds: string[];
};

/**
 * `aqenra:table-columns:v1:<organizationId>:<userId>:<surface>` —
 * same shape as `buildSavedViewsStorageKey`'s own identical key
 * convention, with a distinct `table-columns` namespace segment so the
 * two subsystems can never collide even if a future surface name were
 * ever reused between them.
 */
export function buildTableColumnsStorageKey(
  organizationId: string,
  userId: string,
  surface: TableColumnsSurface,
): string {
  return `aqenra:table-columns:v1:${organizationId}:${userId}:${surface}`;
}

/**
 * Defensive parse — never throws. A missing key, invalid JSON, wrong
 * version, malformed root, or a `hiddenIds` that isn't an array of
 * strings all collapse to `[]` (every column visible — the safe
 * default), mirroring `parseSavedViewsStorage`'s own identical
 * "collapse to empty, never throw" contract. Non-string entries inside
 * an otherwise-valid array are dropped individually rather than
 * invalidating the whole array.
 */
export function parseTableColumnsStorage(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
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
  if (root.version !== TABLE_COLUMNS_STORAGE_VERSION || !Array.isArray(root.hiddenIds)) {
    return [];
  }
  return root.hiddenIds.filter((id): id is string => typeof id === "string");
}

function serializeTableColumnsStorage(hiddenIds: string[]): string {
  const payload: TableColumnsStorageV1 = { version: TABLE_COLUMNS_STORAGE_VERSION, hiddenIds };
  return JSON.stringify(payload);
}

/**
 * Every localStorage read is failure-safe — a thrown SecurityError
 * (storage disabled/blocked) is indistinguishable from "no stored
 * preference yet" from this function's own contract, exactly like a
 * missing key or corrupted JSON. `globalThis.localStorage`, not
 * `window.localStorage` — identical reasoning to
 * `saved-views/storage.ts`'s own identical choice: this repo's one
 * unit-test harness (vitest, `environment: "node"`, no `window` global
 * at all) can exercise this module's real read/write/defensive-parse
 * logic directly by installing a minimal stand-in on
 * `globalThis.localStorage`.
 */
export function readHiddenColumnIds(
  organizationId: string,
  userId: string,
  surface: TableColumnsSurface,
): string[] {
  try {
    const key = buildTableColumnsStorageKey(organizationId, userId, surface);
    return parseTableColumnsStorage(globalThis.localStorage.getItem(key));
  } catch {
    return [];
  }
}

export type WriteTableColumnsResult = { ok: true } | { ok: false; reason: "write-failed" };

/**
 * Raw write — stores exactly the `hiddenIds` array it's given, with no
 * normalization performed here (normalization is the caller's own
 * responsibility, via `normalizeHiddenColumnIds` below, so this
 * function stays a dumb, surface-agnostic storage primitive — it has no
 * idea what a "mandatory column" is). Every failure mode (SecurityError,
 * QuotaExceededError, any other browser storage failure) is caught and
 * reported, never thrown into page rendering — the caller's own
 * existing in-memory state stays fully usable either way.
 */
export function writeHiddenColumnIds(
  organizationId: string,
  userId: string,
  surface: TableColumnsSurface,
  hiddenIds: string[],
): WriteTableColumnsResult {
  try {
    const key = buildTableColumnsStorageKey(organizationId, userId, surface);
    globalThis.localStorage.setItem(key, serializeTableColumnsStorage(hiddenIds));
    return { ok: true };
  } catch {
    return { ok: false, reason: "write-failed" };
  }
}

/**
 * The one normalization rule every consumer of a raw `hiddenIds` array
 * (whether freshly read from storage, or about to be written after a
 * toggle) must apply before trusting it: an unknown id (a column this
 * surface no longer has, or never had — a stale/hand-edited/future-
 * version value) is dropped, a mandatory id is dropped (locked spec §19
 * — "Do not hide mandatory columns under any circumstance, even if
 * localStorage is hand-edited"), and duplicates collapse to one entry.
 * Order is not meaningful here (this module stores a SET of hidden ids,
 * never an ordering — V1 has no column reordering at all), so the
 * returned array's order is simply "first occurrence order," not a
 * guarantee callers should rely on.
 *
 * Deliberately pure and surface-agnostic — this file still has no idea
 * what "Invoice #" or "Status" means, only that it was told which ids
 * are known and which are mandatory by its caller.
 */
export function normalizeHiddenColumnIds(
  raw: string[],
  knownColumnIds: readonly string[],
  mandatoryColumnIds: readonly string[],
): string[] {
  const known = new Set(knownColumnIds);
  const mandatory = new Set(mandatoryColumnIds);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of raw) {
    if (!known.has(id) || mandatory.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}
