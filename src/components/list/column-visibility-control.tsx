"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "@/components/ui/icons";
import { useColumnVisibility, type ColumnMeta } from "@/components/list/column-visibility-context";

/**
 * Tables Improvement Slice E1 — the shared `Columns` disclosure control:
 * a button that opens a small popover of checkboxes, one per desktop
 * column, plus `Reset to default`. Fully generic — like
 * `SavedViewsControl`, it knows nothing about Invoice/any other domain;
 * `columns` (labels + mandatory flags) is supplied by the caller, and
 * the live hidden-ids state is read from `useColumnVisibility()`
 * (provided by the nearest `ColumnVisibilityProvider` — see that
 * module's own header comment for why a shared ancestor is needed at
 * all, rather than this component calling `useTableColumns` itself).
 *
 * Deliberately NOT built on `RowActionMenu`: that component's
 * `role="menu"`/menuitem semantics are the WAI-ARIA "action menu"
 * pattern (keyboard activation triggers an action and closes the menu),
 * the wrong shape for a set of persistent checkboxes a user toggles
 * freely without the panel closing after each click. This control
 * reuses RowActionMenu's proven portal/fixed-position/outside-click/
 * Escape mechanics (the part that's genuinely domain-neutral
 * "floating panel" plumbing) but exposes a plain `role="group"` panel —
 * the WAI-ARIA disclosure pattern, not the menu-button pattern.
 *
 * Panel content never closes itself on a checkbox click (unlike
 * RowActionMenu's own menu items, which commonly DO close the menu on
 * activation) — toggling columns is meant to be a quick multi-select
 * interaction, closing on every click would make comparing/undoing
 * choices needlessly slow.
 */
export function ColumnVisibilityControl({ columns }: { columns: ColumnMeta[] }) {
  const { hiddenIds, toggle, reset } = useColumnVisibility();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const PANEL_WIDTH = 224;
  const VIEWPORT_MARGIN = 8;

  function computePosition(): void {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(Math.min(rect.left, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN), VIEWPORT_MARGIN);
    setPosition({ top: rect.bottom + 4, left });
  }

  function openPanel(): void {
    computePosition();
    setOpen(true);
  }

  function closePanel(returnFocusToTrigger: boolean): void {
    setOpen(false);
    if (returnFocusToTrigger) {
      triggerRef.current?.focus();
    }
  }

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        closePanel(true);
      }
    }
    function handlePointerDown(event: PointerEvent): void {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      closePanel(false);
    }
    function handleReposition(): void {
      computePosition();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
    };
  }, [open]);

  return (
    <div className="hidden xl:inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? closePanel(false) : openPanel())}
        className="border-border-strong bg-surface text-text-primary focus-visible:ring-focus-ring inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      >
        Columns
        <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open &&
        position &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="group"
            aria-label="Column visibility"
            style={{ position: "fixed", top: position.top, left: position.left, width: PANEL_WIDTH }}
            className="border-border-default bg-surface z-50 rounded-md border py-2 shadow-lg"
          >
            <div className="flex flex-col gap-0.5 px-1">
              {columns.map((column) => {
                const checked = column.mandatory || !hiddenIds.includes(column.id);
                return (
                  <label
                    key={column.id}
                    className="hover:bg-[var(--hover)] flex items-center gap-2 rounded px-2 py-1.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={column.mandatory}
                      onChange={() => toggle(column.id)}
                      className="h-4 w-4"
                    />
                    <span className="text-text-primary flex-1">{column.label}</span>
                    {column.mandatory && <span className="text-text-muted text-xs">Always shown</span>}
                  </label>
                );
              })}
            </div>
            <div className="border-border-subtle mt-2 border-t px-2 pt-2">
              <button
                type="button"
                onClick={reset}
                className="text-text-secondary hover:text-text-primary text-sm font-medium hover:underline"
              >
                Reset to default
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
