/**
 * Authenticated Staff Feedback Widget — pure geometry for the draggable
 * button and its panel. No DOM, no React: everything the drag/resize/placement
 * behaviour decides is a plain function of numbers, so it is unit-tested
 * directly and the component stays a thin event adapter.
 *
 * Positions are stored as the distance from the viewport's RIGHT and BOTTOM
 * edges (not left/top), so the button keeps its place relative to the
 * bottom-right corner when the window is resized, and clamping on resize only
 * ever has to pull it back inside the new bounds.
 */

export const WIDGET_BUTTON_SIZE = 48;
export const WIDGET_EDGE_MARGIN = 8;
export const DRAG_THRESHOLD_PX = 5;
export const KEYBOARD_STEP_PX = 16;
export const PANEL_MAX_WIDTH = 380;
/** Below this viewport width the panel becomes a full-width bottom sheet instead of a popover next to the button. */
export const SHEET_BREAKPOINT_PX = 640;
const PANEL_GAP = 8;
const PANEL_MIN_COMFORTABLE_HEIGHT = 360;

export type Viewport = { width: number; height: number };
/** Distance of the button's right/bottom edge from the viewport's right/bottom edge. */
export type Offset = { right: number; bottom: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Keeps the whole button inside the viewport, at least `margin` from every edge. */
export function clampOffset(
  offset: Offset,
  viewport: Viewport,
  size: number = WIDGET_BUTTON_SIZE,
  margin: number = WIDGET_EDGE_MARGIN,
): Offset {
  return {
    right: clamp(offset.right, margin, viewport.width - size - margin),
    bottom: clamp(offset.bottom, margin, viewport.height - size - margin),
  };
}

/** True once a pointer has moved far enough from where it went down to count as a drag, not a click/tap. */
export function exceedsDragThreshold(dx: number, dy: number, threshold: number = DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(dx, dy) > threshold;
}

/** The offset after dragging by (dx, dy) from `start` — dragging right/down shrinks the right/bottom offsets. */
export function dragOffset(start: Offset, delta: { dx: number; dy: number }, viewport: Viewport): Offset {
  return clampOffset({ right: start.right - delta.dx, bottom: start.bottom - delta.dy }, viewport);
}

const KEY_DELTAS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -KEYBOARD_STEP_PX, dy: 0 },
  ArrowRight: { dx: KEYBOARD_STEP_PX, dy: 0 },
  ArrowUp: { dx: 0, dy: -KEYBOARD_STEP_PX },
  ArrowDown: { dx: 0, dy: KEYBOARD_STEP_PX },
};

/** Keyboard alternative to dragging: Shift + Arrow moves the button by one step. Null for any other key. */
export function keyboardMove(offset: Offset, key: string, viewport: Viewport): Offset | null {
  const delta = KEY_DELTAS[key];
  return delta ? dragOffset(offset, delta, viewport) : null;
}

export type PanelPlacement =
  | { mode: "sheet" }
  | {
      mode: "popover";
      width: number;
      right: number;
      maxHeight: number;
    } & ({ side: "above"; bottom: number } | { side: "below"; top: number });

/**
 * Where the panel opens, given where the button currently is. Narrow
 * viewports get a bottom sheet. Otherwise the panel right-aligns with the
 * button and opens on whichever vertical side has more room, never extending
 * past the viewport — its maxHeight is the room actually available.
 */
export function panelPlacement(
  buttonOffset: Offset,
  viewport: Viewport,
  size: number = WIDGET_BUTTON_SIZE,
  margin: number = WIDGET_EDGE_MARGIN,
): PanelPlacement {
  if (viewport.width < SHEET_BREAKPOINT_PX) return { mode: "sheet" };

  const width = Math.min(PANEL_MAX_WIDTH, viewport.width - margin * 2);
  const right = clamp(buttonOffset.right, margin, viewport.width - width - margin);

  const aboveBottom = buttonOffset.bottom + size + PANEL_GAP;
  const roomAbove = viewport.height - aboveBottom - margin;
  const belowTop = viewport.height - buttonOffset.bottom + PANEL_GAP;
  const roomBelow = buttonOffset.bottom - PANEL_GAP - margin;

  if (roomAbove >= PANEL_MIN_COMFORTABLE_HEIGHT || roomAbove >= roomBelow) {
    return { mode: "popover", side: "above", width, right, bottom: aboveBottom, maxHeight: Math.max(roomAbove, 0) };
  }
  return { mode: "popover", side: "below", width, right, top: belowTop, maxHeight: Math.max(roomBelow, 0) };
}
