import { describe, expect, it } from "vitest";
import {
  clampOffset,
  dragOffset,
  exceedsDragThreshold,
  keyboardMove,
  KEYBOARD_STEP_PX,
  panelPlacement,
  WIDGET_BUTTON_SIZE,
  WIDGET_EDGE_MARGIN,
} from "@/components/feedback-widget/position";

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 320, height: 568 };

describe("clampOffset", () => {
  it("leaves an in-bounds offset alone", () => {
    expect(clampOffset({ right: 100, bottom: 100 }, DESKTOP)).toEqual({ right: 100, bottom: 100 });
  });
  it("keeps the whole button inside every edge, with a margin", () => {
    const max = { right: DESKTOP.width - WIDGET_BUTTON_SIZE - WIDGET_EDGE_MARGIN, bottom: DESKTOP.height - WIDGET_BUTTON_SIZE - WIDGET_EDGE_MARGIN };
    expect(clampOffset({ right: -50, bottom: -50 }, DESKTOP)).toEqual({ right: WIDGET_EDGE_MARGIN, bottom: WIDGET_EDGE_MARGIN });
    expect(clampOffset({ right: 99999, bottom: 99999 }, DESKTOP)).toEqual(max);
  });
  it("pulls a desktop position back in when the window shrinks to a phone size", () => {
    const clamped = clampOffset({ right: 1000, bottom: 700 }, PHONE);
    expect(clamped.right).toBeLessThanOrEqual(PHONE.width - WIDGET_BUTTON_SIZE - WIDGET_EDGE_MARGIN);
    expect(clamped.bottom).toBeLessThanOrEqual(PHONE.height - WIDGET_BUTTON_SIZE - WIDGET_EDGE_MARGIN);
  });
  it("never returns a negative or NaN offset even for a degenerate viewport", () => {
    const result = clampOffset({ right: 10, bottom: 10 }, { width: 10, height: 10 });
    expect(result.right).toBeGreaterThanOrEqual(WIDGET_EDGE_MARGIN);
    expect(Number.isNaN(result.right) || Number.isNaN(result.bottom)).toBe(false);
  });
});

describe("drag vs click", () => {
  it("treats a tiny wobble as a click/tap and a real move as a drag", () => {
    expect(exceedsDragThreshold(0, 0)).toBe(false);
    expect(exceedsDragThreshold(3, 3)).toBe(false);
    expect(exceedsDragThreshold(5, 0)).toBe(false);
    expect(exceedsDragThreshold(6, 0)).toBe(true);
    expect(exceedsDragThreshold(-4, 4)).toBe(true);
  });
  it("moving the pointer right/down shrinks the right/bottom offsets", () => {
    expect(dragOffset({ right: 100, bottom: 100 }, { dx: 30, dy: 20 }, DESKTOP)).toEqual({ right: 70, bottom: 80 });
    expect(dragOffset({ right: 100, bottom: 100 }, { dx: -30, dy: -20 }, DESKTOP)).toEqual({ right: 130, bottom: 120 });
  });
  it("cannot be dragged outside the viewport", () => {
    expect(dragOffset({ right: 20, bottom: 20 }, { dx: 500, dy: 500 }, DESKTOP)).toEqual({ right: WIDGET_EDGE_MARGIN, bottom: WIDGET_EDGE_MARGIN });
    const far = dragOffset({ right: 20, bottom: 20 }, { dx: -5000, dy: -5000 }, PHONE);
    expect(far).toEqual({ right: PHONE.width - WIDGET_BUTTON_SIZE - WIDGET_EDGE_MARGIN, bottom: PHONE.height - WIDGET_BUTTON_SIZE - WIDGET_EDGE_MARGIN });
  });
});

describe("keyboardMove", () => {
  const start = { right: 100, bottom: 100 };
  it("moves one step per arrow key in the matching direction", () => {
    expect(keyboardMove(start, "ArrowLeft", DESKTOP)).toEqual({ right: 100 + KEYBOARD_STEP_PX, bottom: 100 });
    expect(keyboardMove(start, "ArrowRight", DESKTOP)).toEqual({ right: 100 - KEYBOARD_STEP_PX, bottom: 100 });
    expect(keyboardMove(start, "ArrowUp", DESKTOP)).toEqual({ right: 100, bottom: 100 + KEYBOARD_STEP_PX });
    expect(keyboardMove(start, "ArrowDown", DESKTOP)).toEqual({ right: 100, bottom: 100 - KEYBOARD_STEP_PX });
  });
  it("ignores every other key", () => {
    expect(keyboardMove(start, "Enter", DESKTOP)).toBeNull();
    expect(keyboardMove(start, "a", DESKTOP)).toBeNull();
  });
  it("stops at the viewport edge", () => {
    const edge = { right: WIDGET_EDGE_MARGIN, bottom: 100 };
    expect(keyboardMove(edge, "ArrowRight", DESKTOP)).toEqual(edge);
  });
});

describe("panelPlacement", () => {
  it("is a bottom sheet on narrow viewports regardless of button position", () => {
    expect(panelPlacement({ right: 16, bottom: 90 }, PHONE)).toEqual({ mode: "sheet" });
    expect(panelPlacement({ right: 16, bottom: 90 }, { width: 639, height: 900 })).toEqual({ mode: "sheet" });
  });
  it("opens above the button when the button is at the bottom of a desktop viewport", () => {
    const p = panelPlacement({ right: 24, bottom: 32 }, DESKTOP);
    expect(p).toMatchObject({ mode: "popover", side: "above", width: 380 });
  });
  it("opens below the button when it has been dragged to the top", () => {
    const top = { right: 24, bottom: DESKTOP.height - WIDGET_BUTTON_SIZE - WIDGET_EDGE_MARGIN };
    expect(panelPlacement(top, DESKTOP)).toMatchObject({ mode: "popover", side: "below" });
  });
  it("never extends beyond the viewport: width, horizontal position and available height all fit", () => {
    for (const offset of [{ right: 8, bottom: 8 }, { right: 600, bottom: 300 }, { right: 1200, bottom: 740 }]) {
      const p = panelPlacement(offset, DESKTOP);
      if (p.mode !== "popover") throw new Error("expected popover");
      expect(p.right).toBeGreaterThanOrEqual(WIDGET_EDGE_MARGIN);
      expect(p.right + p.width).toBeLessThanOrEqual(DESKTOP.width - WIDGET_EDGE_MARGIN);
      expect(p.maxHeight).toBeGreaterThanOrEqual(0);
      if (p.side === "above") expect(p.bottom + p.maxHeight).toBeLessThanOrEqual(DESKTOP.height);
      else expect(p.top + p.maxHeight).toBeLessThanOrEqual(DESKTOP.height);
    }
  });
  it("recomputes sensibly across a resize: popover on desktop, sheet after shrinking", () => {
    const offset = clampOffset({ right: 24, bottom: 32 }, DESKTOP);
    expect(panelPlacement(offset, DESKTOP).mode).toBe("popover");
    expect(panelPlacement(clampOffset(offset, PHONE), PHONE).mode).toBe("sheet");
  });
});
