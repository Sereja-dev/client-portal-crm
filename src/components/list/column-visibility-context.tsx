"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useTableColumns } from "@/components/list/use-table-columns";
import type { TableColumnsSurface } from "@/lib/table-columns/storage";

export type ColumnMeta = { id: string; label: string; mandatory: boolean };

type ColumnVisibilityState = {
  hiddenIds: readonly string[];
  isVisible: (id: string) => boolean;
  toggle: (id: string) => void;
  reset: () => void;
};

const ColumnVisibilityContext = createContext<ColumnVisibilityState | null>(null);

/**
 * Tables Improvement Slice E1 — the one place `useTableColumns` is
 * actually called for a given page render. Exists because the `Columns`
 * button (placed in the controls band, alongside Saved Views — locked
 * spec §12) and the desktop table it controls (rendered much further
 * down the same page, inside the `total > 0` branch) are SIBLING
 * subtrees under the Server Component page, not JSX-adjacent — they
 * cannot share a single hook call by simple prop-threading without
 * restructuring the page's existing conditional layout (explicitly
 * forbidden — locked spec §12's own "do not redesign surrounding
 * controls"). Wrapping the relevant page region in this one Provider
 * instead lets both subtrees consume the exact same live React state
 * via Context, so a checkbox toggle re-renders both instantly with no
 * page navigation — the same outcome a single shared hook call would
 * give, without moving either subtree's existing position in the page.
 *
 * `children` is ordinary server-rendered JSX (EmptyState, SearchFilterBar,
 * Pagination, RecordCardList, etc.) passed straight through unchanged —
 * this Provider has no opinion about anything except the one Context
 * value it supplies; every surface's own Client Component boundary
 * (`InvoiceDesktopTable`, `ColumnVisibilityControl`) is the only thing
 * that actually reads it.
 */
export function ColumnVisibilityProvider({
  organizationId,
  userId,
  surface,
  knownColumnIds,
  mandatoryColumnIds,
  children,
}: {
  organizationId: string;
  userId: string;
  surface: TableColumnsSurface;
  /** Referentially stable — see `useTableColumns`'s own identical requirement. */
  knownColumnIds: readonly string[];
  mandatoryColumnIds: readonly string[];
  children: ReactNode;
}) {
  const state = useTableColumns(organizationId, userId, surface, knownColumnIds, mandatoryColumnIds);
  return <ColumnVisibilityContext.Provider value={state}>{children}</ColumnVisibilityContext.Provider>;
}

/**
 * Throws if used outside a `ColumnVisibilityProvider` — a programming
 * error (a consumer rendered outside the one place that provides this
 * state), not a runtime condition any real page render should ever hit,
 * so failing loudly here is correct rather than silently defaulting to
 * "everything visible" (which would mask the bug instead of surfacing
 * it during development).
 */
export function useColumnVisibility(): ColumnVisibilityState {
  const context = useContext(ColumnVisibilityContext);
  if (!context) {
    throw new Error("useColumnVisibility must be used within a ColumnVisibilityProvider");
  }
  return context;
}
