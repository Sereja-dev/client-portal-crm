import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useBoundedSelection, BULK_SELECTION_MAX } from "@/components/list/use-bounded-selection";

/**
 * Tables Improvement Slice C — real-render coverage for the shared
 * bounded-selection hook's own INITIAL/derived state only.
 * `renderToStaticMarkup` is a one-shot render (no event loop, no
 * re-render across a simulated interaction) — this repo has no
 * jsdom/@testing-library/react harness to drive an actual
 * toggle/toggleAll/clear sequence and observe the resulting re-render
 * (the same limitation RowActionMenu's own unit test openly documents
 * for open/close/focus behavior). The hook's real interactive behavior
 * — selecting, deselecting, hitting the cap, toggling all, clearing —
 * is instead proven in a real browser by
 * test/e2e/contracts-bulk-workflow.spec.ts and
 * test/e2e/requests-bulk-workflow.spec.ts.
 *
 * What a one-shot render CAN prove, and what matters most for the
 * locked spec's own "never a misleading select-all" requirement: the
 * derived `canSelectAll`/`isAtCap` flags are computed correctly from
 * their inputs on first render, before any interaction ever occurs.
 */
function Probe({ visibleIds, max }: { visibleIds: string[]; max?: number }) {
  const { canSelectAll, isAtCap, selected } = useBoundedSelection(visibleIds, max);
  return (
    <output data-can-select-all={canSelectAll} data-is-at-cap={isAtCap} data-selected-size={selected.size} />
  );
}

describe("useBoundedSelection — initial derived state", () => {
  it("canSelectAll is true when the visible count is within the cap", () => {
    const html = renderToStaticMarkup(<Probe visibleIds={["a", "b", "c"]} max={50} />);
    expect(html).toContain('data-can-select-all="true"');
  });

  it("canSelectAll is true at exactly the cap (boundary, not off-by-one)", () => {
    const visibleIds = Array.from({ length: BULK_SELECTION_MAX }, (_, i) => `id-${i}`);
    const html = renderToStaticMarkup(<Probe visibleIds={visibleIds} />);
    expect(html).toContain('data-can-select-all="true"');
  });

  it("canSelectAll is FALSE once the visible count exceeds the cap -- the exact 'do not silently select only the first 50 under a select-all label' guard", () => {
    const visibleIds = Array.from({ length: BULK_SELECTION_MAX + 1 }, (_, i) => `id-${i}`);
    const html = renderToStaticMarkup(<Probe visibleIds={visibleIds} />);
    expect(html).toContain('data-can-select-all="false"');
  });

  it("canSelectAll is false for an empty visible set (nothing to select)", () => {
    const html = renderToStaticMarkup(<Probe visibleIds={[]} />);
    expect(html).toContain('data-can-select-all="false"');
  });

  it("isAtCap is false and selected size is 0 before any selection has ever occurred", () => {
    const html = renderToStaticMarkup(<Probe visibleIds={["a", "b"]} />);
    expect(html).toContain('data-is-at-cap="false"');
    expect(html).toContain('data-selected-size="0"');
  });

  it("the default max matches the shared BULK_SELECTION_MAX constant (50) when not overridden", () => {
    expect(BULK_SELECTION_MAX).toBe(50);
  });
});
