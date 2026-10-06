"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import {
  readSavedViews,
  saveNewSavedView,
  renameSavedView,
  deleteSavedView,
  SAVED_VIEWS_MAX_PER_SCOPE,
  type SavedView,
  type SavedViewSurface,
} from "@/lib/saved-views/storage";

export type SaveOutcome =
  | { ok: true; view: SavedView }
  | { ok: false; reason: "invalid-name" | "limit-reached" | "write-failed" };

export type RenameOutcome = { ok: true } | { ok: false; reason: "invalid-name" | "not-found" | "write-failed" };

export type DeleteOutcome = { ok: true } | { ok: false; reason: "write-failed" };

const EMPTY_VIEWS: readonly SavedView[] = [];

/**
 * Per-scope (`organizationId:userId:surface`) cached client snapshot —
 * exists ONLY to satisfy `useSyncExternalStore`'s own referential-
 * stability contract (identical need to theme-provider.tsx's own
 * `getClientMode`/`getClientResolvedTheme`): `readSavedViews()` itself
 * always allocates a brand-new array, and handing `useSyncExternalStore`
 * a getSnapshot that returns a different reference on every call (with
 * no real change) risks React treating every render as "the store
 * changed" and re-rendering in a loop. This cache is populated lazily,
 * once per scope, and is the ONLY thing read on every subsequent render
 * until a real save/rename/delete explicitly replaces it (see below) —
 * never written to from inside an effect body, which is what would trip
 * this repo's own `react-hooks/set-state-in-effect` lint rule.
 */
const snapshotCache = new Map<string, SavedView[]>();

function scopeKey(organizationId: string, userId: string, surface: SavedViewSurface): string {
  return `${organizationId}:${userId}:${surface}`;
}

/**
 * No live subscription by design — V1 has no cross-tab sync (locked
 * spec §47). Every real update this hook ever produces flows through
 * its own `override` state below, set directly from a genuine event
 * handler (a Save/Rename/Delete submit — see SavedViewsControl), never
 * through this store's own notify path. Matches theme-provider.tsx's
 * own identical `subscribeNoop`.
 */
function subscribeNoop(): () => void {
  return () => {};
}

function getServerSnapshot(): readonly SavedView[] {
  return EMPTY_VIEWS;
}

/**
 * Tables Improvement Slice D1 — the one shared hook every Saved Views
 * integration uses to hydrate, save, rename, and delete. Owns React
 * state and the hydration-safety contract only; all actual storage
 * logic (key shape, defensive parse, validation, the write itself)
 * lives in `@/lib/saved-views/storage.ts`, called here but never
 * duplicated. Knows nothing about URLs or any domain's own param
 * allowlist (locked spec §17) — `params` is an opaque, already-built
 * record the caller (a surface's SavedViewsControl integration) hands
 * in on `save`.
 *
 * Hydration safety (locked spec §18, critical): `useSyncExternalStore`
 * renders `getServerSnapshot()` (a stable, empty array — identical to
 * what a fresh browser with no saved views would render) during SSR and
 * the FIRST client render, so hydration can never mismatch the server-
 * rendered markup; the real stored list is only read once React swaps
 * to `getClientSnapshot` immediately after mount (the same "SSR
 * placeholder -> real client value" transition theme-provider.tsx's own
 * header comment documents in detail, including why a plain mount
 * `useEffect` calling `setState` was tried and rejected here for the
 * exact same lint reason). A brief post-mount appearance of stored view
 * names once that swap happens is the explicitly accepted tradeoff
 * (locked spec §18's own "a brief post-mount appearance... is
 * acceptable").
 */
export function useSavedViews(organizationId: string, userId: string, surface: SavedViewSurface) {
  const key = scopeKey(organizationId, userId, surface);

  const getClientSnapshot = useCallback((): readonly SavedView[] => {
    const cached = snapshotCache.get(key);
    if (cached) return cached;
    const fresh = readSavedViews(organizationId, userId, surface);
    snapshotCache.set(key, fresh);
    return fresh;
  }, [key, organizationId, userId, surface]);

  const externalViews = useSyncExternalStore(subscribeNoop, getClientSnapshot, getServerSnapshot);

  // Authoritative once set, exactly like theme-provider.tsx's own
  // `override` — every real save/rename/delete below writes here, from
  // a genuine event-handler call site, never a bare effect body.
  const [override, setOverride] = useState<readonly SavedView[] | null>(null);
  const views = override ?? externalViews;

  const save = useCallback(
    (name: string, params: Record<string, string>): SaveOutcome => {
      const result = saveNewSavedView(organizationId, userId, surface, name, params);
      if (!result.ok) {
        return { ok: false, reason: result.reason };
      }
      snapshotCache.set(key, result.views);
      setOverride(result.views);
      return { ok: true, view: result.created };
    },
    [organizationId, userId, surface, key],
  );

  const rename = useCallback(
    (id: string, name: string): RenameOutcome => {
      const result = renameSavedView(organizationId, userId, surface, id, name);
      if (!result.ok) {
        return { ok: false, reason: result.reason };
      }
      snapshotCache.set(key, result.views);
      setOverride(result.views);
      return { ok: true };
    },
    [organizationId, userId, surface, key],
  );

  const remove = useCallback(
    (id: string): DeleteOutcome => {
      const result = deleteSavedView(organizationId, userId, surface, id);
      if (!result.ok) {
        return { ok: false, reason: result.reason };
      }
      snapshotCache.set(key, result.views);
      setOverride(result.views);
      return { ok: true };
    },
    [organizationId, userId, surface, key],
  );

  return {
    views,
    /** Whether `save` is currently guaranteed to fail with "limit-reached" — exposed so the UI can disable Save proactively rather than only reacting after a rejected submit. */
    atLimit: views.length >= SAVED_VIEWS_MAX_PER_SCOPE,
    save,
    rename,
    remove,
  };
}
