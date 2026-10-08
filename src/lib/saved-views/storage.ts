/**
 * Tables Improvement Slice D1 — Saved Views V1 (readiness audit, PASS).
 * Browser-local storage only: a Saved View is an OPTIONAL convenience,
 * never Product/database state (locked spec §2). This module owns the
 * entire storage contract — key shape, version, defensive parse, and
 * the four lifecycle operations (Save/Rename/Delete + the plain read
 * every hook/control consumes) — and nothing else: no React, no domain
 * enum, no server-only import, so it is safe to import from both a
 * Server Component (nothing here touches `window` at module scope) and
 * a Client Component (every `localStorage` access is deferred to
 * inside a function body, never at import time).
 *
 * Deliberately NOT responsible for: which URL params a given surface is
 * allowed to persist (that allowlist is owned by each surface's own
 * `saved-view.ts`, e.g. `src/app/(dashboard)/invoices/saved-view.ts`),
 * or any React state/hydration concern (owned by
 * `src/components/list/use-saved-views.ts`).
 */

export const SAVED_VIEWS_STORAGE_VERSION = 1 as const;

/** Per user + organization + surface (locked spec §7). */
export const SAVED_VIEWS_MAX_PER_SCOPE = 20;

export const SAVED_VIEW_NAME_MAX_LENGTH = 60;

/**
 * Stable, explicit surface identifiers (locked spec §4) — never derived
 * from `pathname`, so a future route rename can't silently orphan every
 * existing saved view.
 */
export type SavedViewSurface = "invoices" | "contracts" | "quotes" | "clients" | "projects";

export type SavedView = {
  id: string;
  name: string;
  /** Allowlisted canonical URL param values for the owning surface, as plain strings — see that surface's own saved-view.ts for the exact allowlist. Never validated here; this module treats it as an opaque, already-serializable record. */
  params: Record<string, string>;
  createdAt: string;
};

type SavedViewsStorageV1 = {
  version: typeof SAVED_VIEWS_STORAGE_VERSION;
  views: SavedView[];
};

/**
 * `aqenra:saved-views:v1:<organizationId>:<userId>:<surface>` (locked
 * spec §4) — organization + user + surface + format version all present
 * in every key, so switching identity or organization in the same
 * browser can never read another identity's/org's/surface's views, and
 * a future v2 storage shape can never collide with v1 keys left behind
 * by an older build.
 */
export function buildSavedViewsStorageKey(
  organizationId: string,
  userId: string,
  surface: SavedViewSurface,
): string {
  return `aqenra:saved-views:v1:${organizationId}:${userId}:${surface}`;
}

/**
 * No id-generation dependency (locked spec §6) — `crypto.randomUUID` is
 * a standard browser (and modern Node) global, already relied on
 * elsewhere in this codebase for ids (e.g. test/fixtures/seed.ts's own
 * `randomUUID` import, same underlying API). The string fallback only
 * exists for a hypothetical runtime with no `crypto.randomUUID` at all
 * (older browser) — still unique enough for this purely-client-local,
 * non-security-sensitive id.
 */
export function generateSavedViewId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeSavedViewName(raw: string): string {
  return raw.trim();
}

export function isValidSavedViewName(trimmedName: string): boolean {
  return trimmedName.length > 0 && trimmedName.length <= SAVED_VIEW_NAME_MAX_LENGTH;
}

function isPlainStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === "string");
}

function isValidSavedViewEntry(value: unknown): value is SavedView {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAt === "string" &&
    isPlainStringRecord(candidate.params)
  );
}

/**
 * Defensive parse — never throws. A missing key, invalid JSON, wrong
 * version, or a malformed root all collapse to `[]`; a malformed
 * INDIVIDUAL entry inside an otherwise-valid array is skipped rather
 * than invalidating the whole list (locked spec §8).
 */
export function parseSavedViewsStorage(raw: string | null): SavedView[] {
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
  if (root.version !== SAVED_VIEWS_STORAGE_VERSION || !Array.isArray(root.views)) {
    return [];
  }
  return root.views.filter(isValidSavedViewEntry);
}

function serializeSavedViewsStorage(views: SavedView[]): string {
  const payload: SavedViewsStorageV1 = { version: SAVED_VIEWS_STORAGE_VERSION, views };
  return JSON.stringify(payload);
}

/**
 * Every localStorage read is failure-safe (locked spec §8) — a thrown
 * SecurityError (e.g. storage disabled/blocked) is indistinguishable
 * from "no saved views yet" from this function's own contract, exactly
 * like a missing key or corrupted JSON.
 */
export function readSavedViews(
  organizationId: string,
  userId: string,
  surface: SavedViewSurface,
): SavedView[] {
  try {
    const key = buildSavedViewsStorageKey(organizationId, userId, surface);
    // `globalThis.localStorage`, not `window.localStorage` — identical in
    // a real browser (window IS globalThis there), but this way the one
    // unit-test harness this repo has (vitest's own `environment: "node"`,
    // no `window` global at all) can exercise this module's real
    // read/write/defensive-parse logic directly, by installing a minimal
    // stand-in on `globalThis.localStorage` — see test/unit/saved-views-
    // storage.test.ts's own header comment.
    return parseSavedViewsStorage(globalThis.localStorage.getItem(key));
  } catch {
    return [];
  }
}

type WriteResult = { ok: true } | { ok: false; reason: "write-failed" };

function writeSavedViews(
  organizationId: string,
  userId: string,
  surface: SavedViewSurface,
  views: SavedView[],
): WriteResult {
  try {
    const key = buildSavedViewsStorageKey(organizationId, userId, surface);
    globalThis.localStorage.setItem(key, serializeSavedViewsStorage(views));
    return { ok: true };
  } catch {
    // Covers SecurityError, QuotaExceededError, and any other browser
    // storage failure (locked spec §8) — the caller's own existing list
    // stays fully usable; this never throws into page rendering.
    return { ok: false, reason: "write-failed" };
  }
}

export type SaveSavedViewResult =
  | { ok: true; views: SavedView[]; created: SavedView }
  | { ok: false; reason: "invalid-name" | "limit-reached" | "write-failed" };

/**
 * Saving ALWAYS creates a new view (locked spec §6/§21) — there is no
 * update/overwrite path anywhere in this module.
 */
export function saveNewSavedView(
  organizationId: string,
  userId: string,
  surface: SavedViewSurface,
  name: string,
  params: Record<string, string>,
): SaveSavedViewResult {
  const trimmed = normalizeSavedViewName(name);
  if (!isValidSavedViewName(trimmed)) {
    return { ok: false, reason: "invalid-name" };
  }
  const existing = readSavedViews(organizationId, userId, surface);
  if (existing.length >= SAVED_VIEWS_MAX_PER_SCOPE) {
    // At the cap: never silently overwrite another view (locked spec
    // §7) — existing views are returned completely untouched by the
    // caller (this function performs no write at all in this branch).
    return { ok: false, reason: "limit-reached" };
  }
  const created: SavedView = {
    id: generateSavedViewId(),
    name: trimmed,
    params: { ...params },
    createdAt: new Date().toISOString(),
  };
  const next = [...existing, created];
  const result = writeSavedViews(organizationId, userId, surface, next);
  if (!result.ok) {
    return { ok: false, reason: "write-failed" };
  }
  return { ok: true, views: next, created };
}

export type RenameSavedViewResult =
  | { ok: true; views: SavedView[] }
  | { ok: false; reason: "invalid-name" | "not-found" | "write-failed" };

/** Rename changes only `name` — `id`/`params`/`createdAt` are always carried forward unchanged (locked spec §6/§23). */
export function renameSavedView(
  organizationId: string,
  userId: string,
  surface: SavedViewSurface,
  id: string,
  name: string,
): RenameSavedViewResult {
  const trimmed = normalizeSavedViewName(name);
  if (!isValidSavedViewName(trimmed)) {
    return { ok: false, reason: "invalid-name" };
  }
  const existing = readSavedViews(organizationId, userId, surface);
  if (!existing.some((view) => view.id === id)) {
    return { ok: false, reason: "not-found" };
  }
  const next = existing.map((view) => (view.id === id ? { ...view, name: trimmed } : view));
  const result = writeSavedViews(organizationId, userId, surface, next);
  if (!result.ok) {
    return { ok: false, reason: "write-failed" };
  }
  return { ok: true, views: next };
}

export type DeleteSavedViewResult = { ok: true; views: SavedView[] } | { ok: false; reason: "write-failed" };

/** Removes only the selected saved view (locked spec §24) — every other view is carried forward byte-identical. */
export function deleteSavedView(
  organizationId: string,
  userId: string,
  surface: SavedViewSurface,
  id: string,
): DeleteSavedViewResult {
  const existing = readSavedViews(organizationId, userId, surface);
  const next = existing.filter((view) => view.id !== id);
  const result = writeSavedViews(organizationId, userId, surface, next);
  if (!result.ok) {
    return { ok: false, reason: "write-failed" };
  }
  return { ok: true, views: next };
}
