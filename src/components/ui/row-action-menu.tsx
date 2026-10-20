"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MoreIcon } from "@/components/ui/icons";

/**
 * Tables Improvement Slice A — the one shared overflow "..." row-action
 * menu primitive (readiness audit §F/§32: no canonical dropdown/menu
 * component existed anywhere in this app before this slice). Purpose:
 * move secondary/destructive row actions (starting with Invoice's own
 * DRAFT-only Delete) out of prominent inline UI, without inventing a
 * generic table framework or adding a third-party dropdown dependency.
 *
 * Architecture: the menu panel is rendered through a React portal
 * (`createPortal`, part of `react-dom` — already a dependency, not a new
 * one) directly onto `document.body`, positioned via the trigger
 * button's own `getBoundingClientRect()` with `position: fixed`. This is
 * deliberate, not incidental: every list-row context this menu is used
 * in lives inside `Table`'s own `overflow-x-auto` wrapper (and, for the
 * Invoice sticky-header pilot, a second bounded-height `overflow-y-auto`
 * ancestor — see invoices/page.tsx's own header comment) — an
 * `position: absolute` panel nested inside either ancestor would risk
 * being silently clipped by that ancestor's own scroll box, the exact
 * "menu does not clip behind table/container" failure mode called out
 * in review. A portal to `document.body` is immune to this by
 * construction: the panel is never a descendant of any scrolling
 * ancestor at all. It also can never lose a z-index fight against
 * `ConfirmDialog` (built on the native `<dialog>` element, which renders
 * in the browser's own top layer unconditionally above all regular/
 * portaled DOM regardless of z-index) — clicking a destructive item
 * inside this menu to open a ConfirmDialog is therefore always safe.
 *
 * Accessibility (WAI-ARIA menu-button disclosure pattern):
 *  - a real `<button>` trigger, `aria-haspopup="menu"`, `aria-expanded`,
 *    `aria-controls` the open panel's id, and a caller-supplied
 *    accessible name (defaults to "More actions").
 *  - Escape closes the menu AND returns focus to the trigger — the one
 *    case this component forces focus itself; every other close path
 *    (clicking outside) intentionally does NOT force focus, so an item's
 *    own effect (ConfirmDialog's own showModal() focus trap, a Link
 *    navigation) is never fought for focus immediately after being
 *    triggered.
 *  - clicking anywhere outside the open panel and the trigger closes it
 *    (capture-phase `pointerdown`, not `click`, so it fires before the
 *    item's own click handler commits — but still lets the item's own
 *    click proceed normally afterward, since this only closes the menu
 *    state, it never calls stopPropagation/preventDefault).
 *  - the panel's own `role="menu"` with plain children is intentionally
 *    unopinionated about item markup — `DeleteButton` (and its own
 *    `ConfirmDialog`) is reused completely unmodified as a child, never
 *    reimplemented, matching the explicit "do not duplicate delete
 *    logic" requirement.
 *  - deliberately NOT closed on item click: `DeleteButton`'s own
 *    `ConfirmDialog` is rendered as a DOM descendant of this menu's own
 *    portaled panel, so collapsing the panel in response to the same
 *    click that opens the dialog would unmount the panel's own subtree —
 *    including the dialog that was *just* opened via `showModal()` —
 *    before the browser ever paints it (a native `<dialog>` promoted to
 *    the top layer is still removed if a DOM ancestor is removed; the
 *    top-layer promotion does not protect it from that). Leaving the
 *    panel's own `open` state untouched on item click sidesteps this
 *    entirely: the modal's own backdrop fully covers the now-inert menu
 *    underneath it, and a successful destructive action (e.g. Delete)
 *    removes the row — and this component instance along with it — via
 *    the existing `router.refresh()` the action already performs, so
 *    there is nothing left to manually close. The only path that still
 *    closes the menu after an in-menu action is the existing outside-
 *    click/Escape handling once the dialog itself has closed.
 *  - touch-usable: every interaction is a plain click/tap, no
 *    hover-only affordance of any kind.
 *
 * Mobile Improvement Slice B3 — the trigger is `h-10 w-10` below `md`
 * (40×40px, comfortably inside common mobile touch-target guidance) and
 * `h-8 w-8` at `md` and up (32×32px, unchanged from this component's
 * original, already-shipped desktop size on Invoices/Contracts) —
 * mobile-only, not global, since the Product concern was raised during
 * mobile verification specifically and desktop's existing size already
 * has no reported issue. `computePosition()` reads the trigger's own
 * live `getBoundingClientRect()`, so no positioning logic needed any
 * change for this.
 *
 * Accessibility Improvement A1 — this panel is now a TRUE WAI-ARIA menu-
 * button widget, not merely menu-shaped markup: opening it (via click,
 * Enter/Space on the trigger, or ArrowDown while the trigger is focused
 * and closed) moves real DOM focus onto its own first enabled menu item;
 * ArrowDown/ArrowUp/Home/End then rove real focus between items (see
 * `getMenuItems()`/`handleMenuKeyDown()` below); Escape still closes and
 * returns focus to the trigger exactly as before. Tab/Shift+Tab are
 * deliberately NOT trapped or cycled — a true ARIA menu is not a modal,
 * so focus is allowed to leave via the browser's own natural tab order;
 * `handleMenuBlur()` simply closes the now-orphaned panel once that
 * happens, rather than fighting it. Each menu item's own real
 * `role="menuitem"` + roving (script-only) `tabIndex={-1}` is applied by
 * `RowActionMenuItem` itself, imperatively, via a ref — see that
 * component's own header comment for why cloning `children` with new
 * props cannot reach the real control here, and why a ref-based DOM
 * query is both sufficient and consistent with this app's existing
 * conventions (NotificationBell's own `close()` already queries/mutates
 * its popover's DOM the same way).
 */
export function RowActionMenu({
  label = "More actions",
  align = "end",
  children,
}: {
  label?: string;
  /** Which edge of the trigger the panel's own right/left edge aligns to — "end" (default) right-aligns for a trailing "Actions" column; "start" left-aligns. */
  align?: "start" | "end";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Readiness audit §F / this slice's own §7 — "do not show a useless
  // '...' button containing no actions." A caller that genuinely has no
  // secondary action for a given row should simply not render
  // `RowActionMenu` at all (Invoice's own page never does for a non-
  // DRAFT row) — this is a defensive second layer, not the only
  // enforcement point, so a future caller that accidentally passes
  // `children={someConditionAnd && <Item/>}` which evaluates falsy still
  // can't end up with an empty, clickable-but-pointless trigger. Computed
  // early but never used to skip a hook call below (every hook in this
  // component must run unconditionally on every render, regardless of
  // this value) — only the final JSX return is gated on it.
  const hasContent = children !== null && children !== undefined && children !== false;

  const MENU_WIDTH = 180;
  const VIEWPORT_MARGIN = 8;

  function computePosition(): void {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left =
      align === "end"
        ? Math.max(rect.right - MENU_WIDTH, VIEWPORT_MARGIN)
        : Math.min(rect.left, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN);
    setPosition({ top: rect.bottom + 4, left });
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

  // Accessibility Improvement A1 — the panel's own current real menu
  // items, freshly queried rather than cached: which actions exist (e.g.
  // Archive vs. Restore) can differ between opens, and a disabled item
  // (DeleteButton/ContractArchiveRestoreAction's own `disabled={pending}`
  // mid-action) must never receive roving focus. Scoped to
  // `[role="menuitem"]` specifically — not a generic `button, a[href]`
  // query — so a DeleteButton's own nested, currently-closed
  // ConfirmDialog (a real DOM descendant of this panel while it's open;
  // see this component's own header comment) never counts as a second
  // item: only the one control each RowActionMenuItem itself tags this
  // way (see that component's own header comment) is ever included.
  function getMenuItems(): HTMLElement[] {
    const panel = menuRef.current;
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
      (item) => !item.hasAttribute("disabled"),
    );
  }

  // Accessibility Improvement A1 — moves real focus onto the panel's own
  // first enabled item as soon as it exists in the DOM. No arbitrary
  // timeout: this only runs when `open` flips true, by which point React
  // has already committed the portaled panel (and every RowActionMenuItem
  // child's own role-tagging effect — child effects run before this
  // parent effect on the same commit).
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
    // capture: true so this always observes the click before any item's
    // own handler could call stopPropagation — it never does so itself,
    // it only ever closes this menu's own state.
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeMenu/computePosition are stable-enough local closures re-created each render; re-running this effect only on `open` (not every render) is the intended behavior, matching this exact "mount/unmount listeners only while open" shape every other imperative-dialog-ish component in this app already uses.
  }, [open]);

  // Accessibility Improvement A1 — WAI-ARIA menu-button roving focus.
  // Enter/Space are deliberately not handled here: the focused element is
  // always a real <button>/<a>, so its own native key handling already
  // fires its click exactly once. Escape is also deliberately not handled
  // here — it stays owned by the document-level listener above (which
  // this keydown still reaches via bubbling, but the switch below simply
  // ignores it), the same single source of truth whether focus is on the
  // trigger or inside the panel.
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

  // Accessibility Improvement A1 — Tab/Shift+Tab are real menu-button
  // semantics, never a Tab-trap: neither key is intercepted above, so the
  // browser moves focus on to whatever naturally follows/precedes this
  // portaled panel in document order. This only reacts to that already-
  // decided move by closing the now-orphaned panel — it never calls
  // `.focus()` itself, so focus is never fought or redirected a second
  // time. `relatedTarget` is the element about to receive focus; a move
  // into DeleteButton's own ConfirmDialog (a real DOM descendant of this
  // panel while it's open) still satisfies `contains()`, so confirming a
  // destructive action never closes this panel prematurely.
  function handleMenuBlur(event: ReactFocusEvent<HTMLDivElement>): void {
    const next = event.relatedTarget as Node | null;
    if (next && menuRef.current?.contains(next)) {
      return;
    }
    closeMenu(false);
  }

  // Accessibility Improvement A1 — ArrowDown on the still-closed trigger
  // opens the menu and (via the focus-first-item effect above) focuses
  // its first item, matching standard menu-button keyboard semantics.
  // Enter/Space need no handling here: both already fire this native
  // <button>'s own onClick below. ArrowUp-opens-last-item is deliberately
  // not implemented — optional per this slice's own scope, and
  // unnecessary complexity for a two-state trigger.
  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    if (!open && event.key === "ArrowDown") {
      event.preventDefault();
      openMenu();
    }
  }

  if (!hasContent) {
    return null;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        className="text-text-secondary hover:text-text-primary focus-visible:ring-focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 md:h-8 md:w-8"
      >
        <MoreIcon className="h-4 w-4" />
      </button>
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
            style={{ position: "fixed", top: position.top, left: position.left, width: MENU_WIDTH }}
            className="border-border-default bg-surface z-50 rounded-md border py-1 shadow-lg"
            // Deliberately no onClick here that closes the menu — see
            // this component's own header comment on why item clicks
            // must never collapse (and thereby unmount) this panel.
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * One menu row — a plain padded wrapper, `role="none"` (the real
 * `menuitem` semantics belong to whatever interactive child is placed
 * inside, e.g. DeleteButton's own `<button>`; this wrapper never adds a
 * second, competing role to the same accessibility tree node). Kept
 * deliberately tiny: this is spacing/hover-affordance only, never a
 * second place item-click behavior is defined.
 *
 * Accessibility Improvement A1 — this is also where the real `menuitem`
 * role/roving tab stop actually gets applied, imperatively, via a ref.
 * Every current child (`DeleteButton`, `ContractArchiveRestoreAction`) is
 * a fixed-signature component that does not spread arbitrary props onto
 * its own root node, so `cloneElement(children, {role, tabIndex})` would
 * silently drop both props rather than ever reaching the real `<button>`
 * — there is no DOM for them to land on. Querying/mutating the already-
 * rendered DOM instead sidesteps that entirely, and needs no change to
 * either component's own call signature; it's the same "find it via a
 * ref, mutate it imperatively" shape NotificationBell's own `close()`
 * already uses elsewhere in this app. `querySelector` (singular) returns
 * the first match in document order — always this item's own trigger
 * control, never a Cancel/Confirm button belonging to that same
 * trigger's own `ConfirmDialog`, which every current child renders
 * later/deeper in the same subtree (see DeleteButton's/
 * ContractArchiveRestoreAction's own render output). `tabIndex = -1`
 * (not 0) is deliberate: a menu item is never part of the ordinary
 * sequential Tab order — RowActionMenu's own Arrow/Home/End handling
 * moves real focus between items programmatically instead (see that
 * component's own header comment for why Tab itself is left alone,
 * closing the menu naturally, rather than cycling through these).
 */
export function RowActionMenuItem({ children }: { children: ReactNode }) {
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interactive = itemRef.current?.querySelector<HTMLElement>("button, a[href]");
    if (!interactive) return;
    interactive.setAttribute("role", "menuitem");
    interactive.tabIndex = -1;
  }, []);

  return (
    <div ref={itemRef} role="none" className="hover:bg-[var(--hover)] px-1 py-0.5">
      {children}
    </div>
  );
}
