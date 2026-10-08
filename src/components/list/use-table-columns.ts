"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import {
  readHiddenColumnIds,
  writeHiddenColumnIds,
  normalizeHiddenColumnIds,
  type TableColumnsSurface,
} from "@/lib/table-columns/storage";

const EMPTY_HIDDEN: readonly string[] = [];

/**
 * Per-scope (`organizationId:userId:surface`) cached client snapshot —
 * exists ONLY to satisfy `useSyncExternalStore`'s own referential-
 * stability contract, identical need and identical fix to
 * `use-saved-views.ts`'s own `snapshotCache`: `readHiddenColumnIds()`
 * itself always allocates a fresh array, and handing
 * `useSyncExternalStore` a getSnapshot that returns a different
 * reference on every call risks React treating every render as "the
 * store changed." Populated lazily, once per scope, and the ONLY thing
 * read on every subsequent render until a real toggle/reset explicitly
 * replaces it — never written to from inside an effect body (would trip
 * this repo's own `react-hooks/set-state-in-effect` lint rule).
 */
const snapshotCache = new Map<string, string[]>();

function scopeKey(organizationId: string, userId: string, surface: TableColumnsSurface): string {
  return `${organizationId}:${userId}:${surface}`;
}

/**
 * No live subscription by design — V1 has no cross-tab sync, matching
 * Saved Views' own identical choice. Every real update this hook ever
 * produces flows through its own `override` state below, set directly
 * from a genuine event handler (a checkbox toggle or Reset click — see
 * `ColumnVisibilityControl`), never through this store's own notify
 * path. Matches `use-saved-views.ts`'s own identical `subscribeNoop`.
 */
function subscribeNoop(): () => void {
  return () => {};
}

function getServerSnapshot(): readonly string[] {
  return EMPTY_HIDDEN;
}

/**
 * Tables Improvement Slice E1 — the shared hook any Column
 * Customization integration uses to hydrate, toggle, and reset. Owns
 * React state and the hydration-safety contract only; all actual
 * storage logic (key shape, defensive parse, normalization, the write
 * itself) lives in `@/lib/table-columns/storage.ts`, called here but
 * never duplicated — exactly mirroring `use-saved-views.ts`'s own
 * relationship to `saved-views/storage.ts`.
 *
 * Hydration safety (critical, same reasoning as Saved Views):
 * `useSyncExternalStore` renders `getServerSnapshot()` (a stable, empty
 * array — "every column visible," the same default a fresh browser with
 * no stored preference would render) during SSR and the FIRST client
 * render, so hydration can never mismatch the server-rendered markup;
 * the real stored hidden-ids are only read once React swaps to
 * `getClientSnapshot` immediately after mount. A brief post-mount
 * removal of a user-hidden column is the explicitly accepted tradeoff
 * (locked spec §9 — "a brief post-mount removal... is acceptable"),
 * identical to Saved Views' own "brief post-mount appearance" tradeoff.
 *
 * `knownColumnIds`/`mandatoryColumnIds` must be referentially stable
 * across renders (a module-level `as const` tuple from the surface's
 * own column-metadata module, e.g. `INVOICE_COLUMN_IDS` /
 * `INVOICE_MANDATORY_COLUMN_IDS` in `invoices/columns.ts`) — never a
 * freshly-allocated array literal passed inline at the call site, which
 * would defeat this hook's own `useCallback` memoization and could
 * cause `useSyncExternalStore` to treat every render as a store change.
 */
export function useTableColumns(
  organizationId: string,
  userId: string,
  surface: TableColumnsSurface,
  knownColumnIds: readonly string[],
  mandatoryColumnIds: readonly string[],
) {
  const key = scopeKey(organizationId, userId, surface);

  const getClientSnapshot = useCallback((): readonly string[] => {
    const cached = snapshotCache.get(key);
    if (cached) return cached;
    const fresh = normalizeHiddenColumnIds(
      readHiddenColumnIds(organizationId, userId, surface),
      knownColumnIds,
      mandatoryColumnIds,
    );
    snapshotCache.set(key, fresh);
    return fresh;
  }, [key, organizationId, userId, surface, knownColumnIds, mandatoryColumnIds]);

  const externalHidden = useSyncExternalStore(subscribeNoop, getClientSnapshot, getServerSnapshot);

  // Authoritative once set, exactly like `use-saved-views.ts`'s own
  // `override` — every real toggle/reset below writes here, from a
  // genuine event-handler call site, never a bare effect body.
  const [override, setOverride] = useState<readonly string[] | null>(null);
  const hiddenIds = override ?? externalHidden;

  const toggle = useCallback(
    (id: string) => {
      // Mandatory columns are never toggleable — defended here too
      // (not only in the picker UI's own `disabled` checkbox), so no
      // future caller of this hook can accidentally hide one by
      // calling `toggle` directly.
      if (mandatoryColumnIds.includes(id)) {
        return;
      }
      const next = hiddenIds.includes(id) ? hiddenIds.filter((existing) => existing !== id) : [...hiddenIds, id];
      const normalized = normalizeHiddenColumnIds(next, knownColumnIds, mandatoryColumnIds);
      writeHiddenColumnIds(organizationId, userId, surface, normalized);
      snapshotCache.set(key, normalized);
      setOverride(normalized);
    },
    [hiddenIds, knownColumnIds, mandatoryColumnIds, organizationId, userId, surface, key],
  );

  const reset = useCallback(() => {
    writeHiddenColumnIds(organizationId, userId, surface, []);
    snapshotCache.set(key, []);
    setOverride([]);
  }, [organizationId, userId, surface, key]);

  const isVisible = useCallback((id: string) => !hiddenIds.includes(id), [hiddenIds]);

  return { hiddenIds, isVisible, toggle, reset };
}
