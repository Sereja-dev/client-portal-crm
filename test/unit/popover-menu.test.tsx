import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PopoverMenu } from "@/components/ui/popover-menu";

/**
 * Sidebar Account Menu V1 — real-render coverage for the new sibling
 * popover primitive, mirroring row-action-menu.test.tsx's own
 * established "no DOM/component-interaction harness in this repo, use
 * `renderToStaticMarkup`" precedent exactly.
 *
 * `renderToStaticMarkup` only ever exercises the CLOSED-state render
 * (`open` starts `false`, and the portal branch is gated behind
 * `open && position && typeof document !== "undefined" && ...`, so no
 * `document`/`window` reference is ever reached during a server-side
 * static render) — open/close/keyboard/focus/portal-position behavior
 * is covered instead by test/e2e/sidebar-account-menu.spec.ts's own
 * real-browser coverage.
 */
function renderClosed() {
  return renderToStaticMarkup(
    <PopoverMenu
      label="Account menu"
      trigger={(props) => (
        <button type="button" {...props}>
          Trigger
        </button>
      )}
    >
      <div role="none">Item</div>
    </PopoverMenu>,
  );
}

describe("PopoverMenu — closed-state render", () => {
  it("renders the caller-supplied trigger with correct WAI-ARIA menu-button attributes", () => {
    const html = renderClosed();
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Account menu"');
    // aria-controls is only set once open (the panel id only exists then) —
    // closed-state markup must never reference a nonexistent id.
    expect(html).not.toContain("aria-controls");
  });

  it("never renders the portal panel/menu content while closed", () => {
    const html = renderClosed();
    expect(html).not.toContain("Item");
    expect(html).not.toContain('role="menu"');
  });
});
