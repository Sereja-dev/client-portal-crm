"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

/**
 * Sidebar Account Menu V1 — a sibling to RowActionMenu
 * (src/components/ui/row-action-menu.tsx), deliberately not a
 * generalization of it: the read-only audit's own evaluation found that
 * RowActionMenu's hardcoded 3-dot trigger and downward-only positioning
 * would need real API changes to support a custom trigger element and an
 * upward direction, and RowActionMenu is already relied on, unmodified,
 * by many existing row-action call sites — safer to leave it completely
 * untouched than risk it for an unrelated feature.
 *
 * This file mirrors RowActionMenu's own proven accessibility/portal
 * pattern exactly (same WAI-ARIA menu-button shape, same portal-to-
 * document.body positioning so the sidebar's own layout can never clip
 * it, same Escape/outside-click/roving-focus behavior) with exactly two
 * differences: the trigger is caller-supplied (a render prop, so the
 * sidebar's own compact avatar+name+email row can be the trigger instead
 * of a fixed icon button) and position is computed upward from the
 * trigger's own top edge instead of downward from its bottom edge.
 *
 * RowActionMenuItem (the same import, unmodified) is reused directly for
 * item markup — it only ever queries its own `[role="menuitem"]`-tagged
 * child via a ref, with no dependency on which parent menu contains it,
 * so it is exactly as safe to reuse here as it already is across every
 * existing RowActionMenu call site.
 */
export function PopoverMenu({
  label,
  trigger,
  children,
}: {
  /** The accessible name for the menu panel itself (e.g. "Account menu"). */
  label: string;
  /** Render-prop trigger — receives the exact props/handlers to spread onto whatever element the caller wants as the clickable row. */
  trigger: (props: {
    ref: Ref<HTMLButtonElement>;
    onClick: () => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
    "aria-haspopup": "menu";
    "aria-expanded": boolean;
    "aria-controls": string | undefined;
    "aria-label": string;
  }) => ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ bottom: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const MENU_WIDTH = 224;
  const VIEWPORT_MARGIN = 8;

  // Opens upward from the trigger's own top edge — `bottom` (viewport-
  // relative, the same `position: fixed` coordinate space RowActionMenu's
  // own `top` uses) rather than `top`, so the panel grows upward
  // regardless of how tall its content ends up being. `left` aligns to
  // the trigger's own left edge (`align: "start"` in RowActionMenu's own
  // terms) — correct for a bottom-left-pinned sidebar footer; there is no
  // "end"-aligned case for this component's one caller, so it is not
  // parameterized.
  function computePosition(): void {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      bottom: window.innerHeight - rect.top + 4,
      left: Math.min(rect.left, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN),
    });
  }

  function openMenu(): void {
    computePosition();
    setOpen(true);
  }

  function closeMenu(returnFocusToTrigger: boolean): void {
    setOpen(false);
    if (returnFocusToTrigger) {
      triggerRef.current?.focus();
    }
  }

  function getMenuItems(): HTMLElement[] {
    const panel = menuRef.current;
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
      (item) => !item.hasAttribute("disabled"),
    );
  }

  useEffect(() => {
    if (!open) return;
    getMenuItems()[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        closeMenu(true);
      }
    }
    function handlePointerDown(event: PointerEvent): void {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      closeMenu(false);
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

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const items = getMenuItems();
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        items[currentIndex === -1 ? 0 : (currentIndex + 1) % items.length].focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        items[currentIndex === -1 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length].focus();
        break;
      case "Home":
        event.preventDefault();
        items[0].focus();
        break;
      case "End":
        event.preventDefault();
        items[items.length - 1].focus();
        break;
      default:
        break;
    }
  }

  function handleMenuBlur(event: ReactFocusEvent<HTMLDivElement>): void {
    const next = event.relatedTarget as Node | null;
    if (next && menuRef.current?.contains(next)) {
      return;
    }
    closeMenu(false);
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    if (!open && event.key === "ArrowDown") {
      event.preventDefault();
      openMenu();
    }
  }

  // Closes when a Link item is clicked — Next.js's own client-side
  // navigation never unmounts Sidebar (it's part of the persistent
  // dashboard layout), so without this `open` would otherwise just sit
  // `true` across the route change, leaving the panel visibly floating
  // over the next page. Scoped to `a[href]` specifically: a plain
  // `<button type="submit">` (Sign out) must NOT be closed this way — a
  // synchronous `setOpen(false)` here would unmount the portal's own
  // `<form>` out from under the browser's native submit-on-click
  // handling before the request is actually dispatched, silently
  // cancelling the sign-out (confirmed directly: adding this for every
  // click broke the real Sign-out E2E test). Sign out needs no explicit
  // close at all — its Server Action ends in a real `redirect("/login")`,
  // which already unmounts everything via the resulting page navigation.
  function handleMenuClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if ((event.target as HTMLElement).closest("a[href]")) {
      closeMenu(false);
    }
  }

  return (
    <>
      {trigger({
        ref: triggerRef,
        onClick: () => (open ? closeMenu(false) : openMenu()),
        onKeyDown: handleTriggerKeyDown,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? menuId : undefined,
        "aria-label": label,
      })}
      {open &&
        position &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={handleMenuKeyDown}
            onBlur={handleMenuBlur}
            onClick={handleMenuClick}
            style={{ position: "fixed", bottom: position.bottom, left: position.left, width: MENU_WIDTH }}
            className="border-border-default bg-surface z-50 rounded-md border py-1 shadow-lg"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
