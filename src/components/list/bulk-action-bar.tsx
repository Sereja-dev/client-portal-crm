"use client";

import type { ReactNode } from "react";

/**
 * Tables Improvement Slice C — the smallest shared UI shell for a list's
 * bulk-action toolbar, factored out of Tasks' own already-proven
 * TaskBulkToolbar (src/components/tasks/task-bulk-toolbar.tsx, left
 * completely unmodified — Tasks is reference precedent only in this
 * slice). This shell owns ONLY: the selected-count display, the
 * sticky-bottom responsive presentation, the "Clear selection" control,
 * and a slot for whatever domain-specific action/value controls + Apply
 * button the caller needs — it never knows what domain it's rendered
 * for, never imports a domain enum, and never calls a server action
 * itself (the Apply button's own click handler, enabled/disabled logic,
 * and the server action it calls all live in the caller's own children,
 * exactly like TaskBulkToolbar's own Apply button lives inline in that
 * component rather than in a shared shell — the only thing this slice
 * changes is that the OUTER chrome is now shared across Contracts/
 * Requests instead of being copy-pasted a third and fourth time).
 *
 * Renders nothing at all when selectedCount is 0 — matches
 * TaskBulkToolbar's own identical `if (selectedIds.length === 0) return
 * null;` guard, so no empty toolbar ever occupies layout space.
 */
export function BulkActionBar({
  selectedCount,
  maxSelectable,
  onClear,
  clearDisabled = false,
  children,
}: {
  selectedCount: number;
  /** Shown as "(max N)" once the selection has reached the cap, so the ceiling is always visible, never a silent server-side-only limit. */
  maxSelectable: number;
  onClear: () => void;
  clearDisabled?: boolean;
  /** Domain-specific action/value controls + the Apply button itself. */
  children: ReactNode;
}) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="border-border-default bg-surface sticky bottom-4 z-10 mt-4 flex flex-wrap items-center gap-3 rounded-lg border p-4 shadow-lg"
    >
      <span className="text-text-primary text-sm font-medium">
        {selectedCount} selected
        {selectedCount >= maxSelectable && ` (max ${maxSelectable})`}
      </span>

      {children}

      <button
        type="button"
        onClick={onClear}
        disabled={clearDisabled}
        className="text-text-secondary text-sm hover:underline disabled:cursor-not-allowed disabled:opacity-60"
      >
        Clear selection
      </button>
    </div>
  );
}
