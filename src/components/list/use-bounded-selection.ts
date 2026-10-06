"use client";

import { useState } from "react";
import { BULK_SELECTION_MAX } from "@/lib/bulk-actions/shared";

export { BULK_SELECTION_MAX };

/**
 * Selection is current-rendered-result-set only — plain ephemeral
 * client state, never persisted to localStorage/DB/URL/session (locked
 * spec §8). Unlike Tasks (whose own page size already bounds "select
 * all" to at most PAGE_SIZE=10, well under the cap, so TaskListWithSelection's
 * own toggleAll needs no cap-awareness at all), Contracts and Support
 * Requests have no pagination — a rendered list can exceed 50 rows, so
 * this hook is the one place that conservative behavior lives: `toggleAll`
 * is only ever meant to be invoked by a caller whose own "select all"
 * control is already disabled when `visibleIds.length > max` (never a
 * control labeled "select all" that silently selects only the first
 * `max` instead) — the `.slice` below is defense-in-depth for that
 * invariant, not the primary enforcement of it.
 */
export function useBoundedSelection(visibleIds: readonly string[], max: number = BULK_SELECTION_MAX) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string): void {
    setSelected((prev) => {
      if (prev.has(id)) {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }
      if (prev.size >= max) {
        return prev;
      }
      return new Set(prev).add(id);
    });
  }

  function toggleAll(): void {
    setSelected((prev) => (prev.size > 0 ? new Set() : new Set(visibleIds.slice(0, max))));
  }

  function clear(): void {
    setSelected(new Set());
  }

  return {
    selected,
    toggle,
    toggleAll,
    clear,
    /** Whether a "select all (current results)" control may be safely offered at all — never enabled for a rendered set larger than the cap. */
    canSelectAll: visibleIds.length > 0 && visibleIds.length <= max,
    /** Whether an not-yet-selected row's own checkbox should be disabled (the cap is reached and this id isn't one of the already-selected ones). */
    isAtCap: selected.size >= max,
  };
}
