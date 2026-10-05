import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RowActionMenu, RowActionMenuItem } from "@/components/ui/row-action-menu";

/**
 * Tables Improvement Slice A — real-render coverage for the new shared
 * overflow row-action menu, mirroring record-list.test.tsx's own
 * established "no DOM/component-interaction harness in this repo, use
 * `renderToStaticMarkup` (react-dom/server, already a dependency) to
 * actually execute the real component" precedent.
 *
 * `renderToStaticMarkup` only ever exercises the CLOSED-state render
 * (the component's own `open` state starts `false`, and the portal
 * branch is gated behind `open && position && ...`, so no `document`/
 * `window` reference is ever reached during a server-side static
 * render) — open/close/keyboard/focus/portal-position behavior is
 * covered instead by test/e2e/invoices-table-workflow.spec.ts's own
 * real-browser coverage, exactly matching this task's own "focus/
 * keyboard behavior if existing component-test infrastructure supports
 * it" allowance.
 */
describe("RowActionMenu — real render (closed state)", () => {
  it("renders a real <button> trigger with the caller-supplied accessible name", () => {
    const html = renderToStaticMarkup(
      <RowActionMenu label="More actions for invoice INV-0001">
        <RowActionMenuItem>Delete</RowActionMenuItem>
      </RowActionMenu>,
    );
    expect(html).toMatch(/<button[^>]*aria-label="More actions for invoice INV-0001"[^>]*>/);
  });

  it("defaults to the generic 'More actions' accessible name when no label is supplied", () => {
    const html = renderToStaticMarkup(
      <RowActionMenu>
        <RowActionMenuItem>Delete</RowActionMenuItem>
      </RowActionMenu>,
    );
    expect(html).toMatch(/aria-label="More actions"/);
  });

  it("the trigger exposes aria-haspopup=\"menu\" and starts collapsed (aria-expanded=\"false\")", () => {
    const html = renderToStaticMarkup(
      <RowActionMenu>
        <RowActionMenuItem>Delete</RowActionMenuItem>
      </RowActionMenu>,
    );
    expect(html).toMatch(/aria-haspopup="menu"/);
    expect(html).toMatch(/aria-expanded="false"/);
  });

  it("renders nothing at all (not even the trigger) when children is null/undefined/false — never a useless '...' with no actions", () => {
    expect(renderToStaticMarkup(<RowActionMenu>{null}</RowActionMenu>)).toBe("");
    expect(renderToStaticMarkup(<RowActionMenu>{undefined}</RowActionMenu>)).toBe("");
    expect(renderToStaticMarkup(<RowActionMenu>{false}</RowActionMenu>)).toBe("");
  });

  it("the portal panel is never present in the closed-state markup at all (no aria-controls id leaked while collapsed)", () => {
    const html = renderToStaticMarkup(
      <RowActionMenu>
        <RowActionMenuItem>Delete</RowActionMenuItem>
      </RowActionMenu>,
    );
    expect(html).not.toMatch(/role="menu"/);
    // aria-controls is `undefined` while closed (only set once `open`),
    // so React omits the attribute from the markup entirely.
    expect(html).not.toContain('aria-controls="');
  });
});

describe("RowActionMenuItem — real render", () => {
  it("renders its child content inside a role=\"none\" wrapper (the real menuitem semantics belong to the interactive child, never a second competing role)", () => {
    const html = renderToStaticMarkup(
      <RowActionMenuItem>
        <button type="button">Delete</button>
      </RowActionMenuItem>,
    );
    expect(html).toMatch(/role="none"/);
    expect(html).toContain("Delete");
  });
});
