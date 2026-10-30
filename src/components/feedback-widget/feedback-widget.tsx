"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { SupportIcon, CloseIcon } from "@/components/ui/icons";
import { BugReportForm, SupportForm } from "./feedback-forms";
import {
  getStoredPositionServerSnapshot,
  getStoredPositionSnapshot,
  rememberPosition,
  subscribeNoop,
} from "./position-storage";
import {
  clampOffset,
  dragOffset,
  exceedsDragThreshold,
  keyboardMove,
  panelPlacement,
  type Offset,
  type PanelPlacement,
  type Viewport,
} from "./position";

/**
 * Authenticated Staff Feedback Widget — a floating, draggable button that opens
 * a small non-modal panel with two tabs: "Support" and "Report a bug".
 *
 * Behaviour decisions (all deliberate):
 *  - Draggable with a pointer; a movement under the drag threshold is a click/
 *    tap, anything more is a drag and swallows the click that follows it.
 *    Shift+Arrow moves it from the keyboard, so dragging is never the only way.
 *  - Always clamped inside the viewport, and re-clamped on resize. Position is
 *    held in memory for the session (it survives client-side navigation because
 *    the Staff layout persists); nothing is written to localStorage/cookies, so
 *    the Cookie Policy's storage list is unchanged.
 *  - The panel is non-modal (aria-modal="false"): it never traps focus or
 *    blocks the page, and typed text survives closing it. Escape closes it and
 *    returns focus to the button. On narrow screens it is a bottom sheet.
 *  - Only transitions that respect prefers-reduced-motion; no animation while
 *    dragging.
 *  - Fixed-position, so it can never create horizontal page overflow.
 */

type TabKey = "support" | "bug";

// h-12 w-12 above is WIDGET_BUTTON_SIZE (48px) in position.ts — the drag clamping relies on that size.
// Default spot: bottom-right. On phones 5.5rem clears both the fixed bottom navigation and, on the focused
// create/edit routes that hide that bar, the global footer's legal links.
const DEFAULT_CLASSES = "right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-8 sm:right-6";
const SUPPRESS_CLICK_MS = 350;

function readViewport(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

// Window size as an external store, so the displayed position is DERIVED (clamped to the current
// window at render time) rather than copied into state by a resize effect. Cached so an unchanged
// size returns the identical object.
let viewportCache: Viewport | null = null;
function getViewportSnapshot(): Viewport {
  const next = readViewport();
  if (!viewportCache || viewportCache.width !== next.width || viewportCache.height !== next.height) viewportCache = next;
  return viewportCache;
}
function subscribeViewport(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}
function getServerViewport(): Viewport | null {
  return null;
}

function readOffset(element: HTMLElement): Offset {
  const rect = element.getBoundingClientRect();
  return { right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.bottom };
}

export function FeedbackWidget({
  accountEmail,
  workspaceName,
  supportAvailable,
  bugReportAvailable,
}: {
  accountEmail: string;
  workspaceName: string;
  supportAvailable: boolean;
  bugReportAvailable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [tab, setTab] = useState<TabKey>(supportAvailable ? "support" : "bug");
  // Where the user parked the button: moved this session, else remembered from a previous visit. Never
  // clamped in state — shrinking the window must not forget the preferred spot for when it grows back.
  const [moved, setMoved] = useState<Offset | null>(null);
  const stored = useSyncExternalStore(subscribeNoop, getStoredPositionSnapshot, getStoredPositionServerSnapshot);
  const viewport = useSyncExternalStore(subscribeViewport, getViewportSnapshot, getServerViewport);
  const chosen = moved ?? stored;
  // Null (CSS default position) on the server and the hydrating render, so markup always matches.
  const offset = chosen && viewport ? clampOffset(chosen, viewport) : null;
  const [dragging, setDragging] = useState(false);
  const [placement, setPlacement] = useState<PanelPlacement>({ mode: "sheet" });

  const buttonRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({ support: null, bug: null });
  const drag = useRef<{ pointerId: number; startX: number; startY: number; startOffset: Offset; moved: boolean } | null>(null);
  const suppressClickUntil = useRef(0);

  const panelId = useId();
  const hintId = useId();
  const tabIdBase = useId();

  const recomputePlacement = useCallback(() => {
    if (!buttonRef.current) return;
    setPlacement(panelPlacement(readOffset(buttonRef.current), readViewport()));
  }, []);

  // Keep the open panel usable when the button moves or the window resizes.
  const offsetRight = offset?.right;
  const offsetBottom = offset?.bottom;
  useLayoutEffect(() => {
    if (open) recomputePlacement();
  }, [open, offsetRight, offsetBottom, viewport, recomputePlacement]);

  // On open, move focus into the panel (the selected tab); on close, back to the button.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      tabRefs.current[tab]?.focus();
    } else if (wasOpen.current) {
      buttonRef.current?.focus();
    }
    wasOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus only on open/close, not on every tab change
  }, [open]);

  const close = useCallback(() => setOpen(false), []);
  const toggle = () => {
    setHasOpened(true);
    setOpen((current) => !current);
  };

  if (!supportAvailable && !bugReportAvailable) return null;

  // ---- drag --------------------------------------------------------------
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: readOffset(element),
      moved: false,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved) {
      if (!exceedsDragThreshold(dx, dy)) return;
      state.moved = true;
      setDragging(true);
    }
    setMoved(dragOffset(state.startOffset, { dx, dy }, readViewport()));
  };

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (state.moved) {
      suppressClickUntil.current = performance.now() + SUPPRESS_CLICK_MS;
      rememberPosition(readOffset(event.currentTarget));
    }
    drag.current = null;
    setDragging(false);
  };

  const onButtonClick = () => {
    if (performance.now() < suppressClickUntil.current) return; // the click that ends a drag is not a toggle
    toggle();
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
      return;
    }
    if (!event.shiftKey || !buttonRef.current) return;
    const next = keyboardMove(readOffset(buttonRef.current), event.key, readViewport());
    if (next) {
      event.preventDefault();
      setMoved(next);
      rememberPosition(next);
    }
  };

  // ---- tabs --------------------------------------------------------------
  const order: TabKey[] = ["support", "bug"];
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = order.indexOf(tab);
    let next: TabKey | null = null;
    if (event.key === "ArrowRight") next = order[(index + 1) % order.length];
    else if (event.key === "ArrowLeft") next = order[(index - 1 + order.length) % order.length];
    else if (event.key === "Home") next = order[0];
    else if (event.key === "End") next = order[order.length - 1];
    if (next) {
      event.preventDefault();
      setTab(next);
      tabRefs.current[next]?.focus();
    }
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const buttonStyle: CSSProperties | undefined = offset ? { right: offset.right, bottom: offset.bottom } : undefined;

  const panelStyle: CSSProperties =
    placement.mode === "sheet"
      ? {}
      : {
          width: placement.width,
          right: placement.right,
          maxHeight: placement.maxHeight,
          ...(placement.side === "above" ? { bottom: placement.bottom } : { top: placement.top }),
        };
  const panelClasses =
    placement.mode === "sheet"
      ? "inset-x-2 bottom-2 max-h-[calc(100dvh-1rem)] pb-[env(safe-area-inset-bottom)]"
      : "";

  const tabClasses = (key: TabKey) =>
    `flex-1 border-b-2 px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset ${
      tab === key ? "border-accent text-text-primary" : "border-transparent text-text-muted hover:text-text-primary"
    }`;

  return (
    <div className="print:hidden">
      {/*
        In-flow end-of-page clearance (the button itself is fixed, so it reserves nothing). From md up the
        button sits 32px from the bottom edge, which put its top 7px over the last row's actions and the
        pagination "Next" link once scrolled to the end (content ends 24px of <main> padding + the global
        footer above the edge). On phones the bottom navigation's own spacer already clears it. <main> is
        flex-1, so on a page shorter than the window this takes room from <main> and adds no scroll.
      */}
      <div aria-hidden="true" data-testid="feedback-widget-clearance" className="hidden h-5 shrink-0 md:block" />
      <button
        ref={buttonRef}
        type="button"
        onClick={onButtonClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onButtonKeyDown}
        aria-label="Feedback: contact support or report a bug"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={hintId}
        style={buttonStyle}
        className={`focus-visible:ring-focus-ring fixed z-40 flex h-12 w-12 touch-none items-center justify-center rounded-full bg-accent text-white shadow-[var(--aqenra-shadow-lg)] select-none hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-safe:transition-colors ${
          offset ? "" : DEFAULT_CLASSES
        } ${dragging ? "cursor-grabbing" : "cursor-grab"} ${open ? "max-sm:hidden" : ""}`}
      >
        <SupportIcon className="h-6 w-6" />
      </button>
      <span id={hintId} className="sr-only">
        Drag to move. With the keyboard, hold Shift and press an arrow key to move.
      </span>

      {hasOpened && (
        <div
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-label="Feedback"
          hidden={!open}
          onKeyDown={onPanelKeyDown}
          style={panelStyle}
          className={`border-border-default bg-surface fixed z-50 flex flex-col overflow-y-auto rounded-xl border shadow-[var(--aqenra-shadow-lg)] ${panelClasses}`}
        >
          <div className="flex items-center justify-between gap-4 px-4 pt-4">
            <h2 className="text-text-primary text-base font-semibold">Feedback</h2>
            <button
              type="button"
              onClick={close}
              aria-label="Close feedback"
              className="focus-visible:ring-focus-ring text-text-muted hover:text-text-primary rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>

          <div role="tablist" aria-label="Feedback type" className="border-border-default mt-3 flex border-b px-4">
            {order.map((key) => (
              <button
                key={key}
                ref={(node) => {
                  tabRefs.current[key] = node;
                }}
                id={`${tabIdBase}-${key}-tab`}
                type="button"
                role="tab"
                aria-selected={tab === key}
                aria-controls={`${tabIdBase}-${key}-panel`}
                tabIndex={tab === key ? 0 : -1}
                onClick={() => setTab(key)}
                onKeyDown={onTabKeyDown}
                className={tabClasses(key)}
              >
                {key === "support" ? "Support" : "Report a bug"}
              </button>
            ))}
          </div>

          <div className="p-4">
            <div id={`${tabIdBase}-support-panel`} role="tabpanel" aria-labelledby={`${tabIdBase}-support-tab`} hidden={tab !== "support"}>
              {supportAvailable ? (
                <SupportForm accountEmail={accountEmail} workspaceName={workspaceName} />
              ) : (
                <p className="text-text-secondary text-sm">Support messages aren&rsquo;t available right now. Please try again later.</p>
              )}
            </div>
            <div id={`${tabIdBase}-bug-panel`} role="tabpanel" aria-labelledby={`${tabIdBase}-bug-tab`} hidden={tab !== "bug"}>
              {bugReportAvailable ? (
                <BugReportForm accountEmail={accountEmail} workspaceName={workspaceName} />
              ) : (
                <p className="text-text-secondary text-sm">
                  Bug reporting isn&rsquo;t available yet. Please use the Support tab to tell us about the problem.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
