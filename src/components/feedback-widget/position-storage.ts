import type { Offset } from "./position";

/**
 * Staff Feedback Widget — remembers where the user parked the floating button.
 *
 * Stores ONLY the button's two coordinates (distance from the viewport's right
 * and bottom edges) in browser-local storage. Never form contents, the
 * account, the workspace or anything else; the key is deliberately not scoped
 * to a user, so nothing identifying is written. Same defensive conventions as
 * the app's other browser-storage modules (versioned payload, failure-safe
 * read and write via `globalThis.localStorage`).
 */

export const FEEDBACK_WIDGET_POSITION_KEY = "aqenra:feedback-widget-position";
const VERSION = 1;
/** Sanity bound on a stored coordinate; anything larger can't be a real on-screen offset. */
const MAX_COORDINATE = 20_000;

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_COORDINATE;
}

/** Corrupt, foreign, wrong-version or out-of-range data is "no stored position". */
export function parseStoredPosition(raw: string | null): Offset | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const root = data as Record<string, unknown>;
  if (root.version !== VERSION || !isCoordinate(root.right) || !isCoordinate(root.bottom)) return null;
  return { right: root.right, bottom: root.bottom };
}

export function serializePosition(offset: Offset): string {
  return JSON.stringify({ version: VERSION, right: Math.round(offset.right), bottom: Math.round(offset.bottom) });
}

export function readStoredPosition(): Offset | null {
  try {
    return parseStoredPosition(globalThis.localStorage.getItem(FEEDBACK_WIDGET_POSITION_KEY));
  } catch {
    return null;
  }
}

/** Never throws: if storage is blocked or full the position simply isn't remembered. */
export function writeStoredPosition(offset: Offset): boolean {
  try {
    globalThis.localStorage.setItem(FEEDBACK_WIDGET_POSITION_KEY, serializePosition(offset));
    return true;
  } catch {
    return false;
  }
}

/**
 * `useSyncExternalStore` plumbing (same hydration-safe pattern as the app's
 * other browser-storage hooks): no live subscription — the button's own state
 * carries every in-session change — and a cached snapshot so repeated renders
 * return the same object and never re-read storage.
 */
let snapshotCache: { value: Offset | null } | null = null;

export function subscribeNoop(): () => void {
  return () => {};
}

export function getStoredPositionSnapshot(): Offset | null {
  if (snapshotCache === null) snapshotCache = { value: readStoredPosition() };
  return snapshotCache.value;
}

/** SSR and the first client render: "nothing stored", so hydration always matches the server markup. */
export function getStoredPositionServerSnapshot(): Offset | null {
  return null;
}

/** Keeps the cached snapshot consistent after a write and persists it. */
export function rememberPosition(offset: Offset): void {
  const rounded = { right: Math.round(offset.right), bottom: Math.round(offset.bottom) };
  snapshotCache = { value: rounded };
  writeStoredPosition(rounded);
}

export function resetStoredPositionCacheForTests(): void {
  snapshotCache = null;
}
