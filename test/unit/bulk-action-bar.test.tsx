import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BulkActionBar } from "@/components/list/bulk-action-bar";

/**
 * Tables Improvement Slice C — real-render coverage for the shared
 * bulk-action toolbar shell, mirroring quick-filter-chips.test.tsx's
 * own "this primitive is fully stateless, so renderToStaticMarkup
 * covers its entire behavior" precedent (unlike RowActionMenu/
 * useBoundedSelection, which carry real interactive state and are
 * covered by this repo's own E2E suites instead — see
 * test/e2e/contracts-bulk-workflow.spec.ts and
 * test/e2e/requests-bulk-workflow.spec.ts for select/clear/cap/Apply
 * behavior).
 */
describe("BulkActionBar — real render", () => {
  it("renders nothing at all when selectedCount is 0 -- never an empty toolbar occupying layout space", () => {
    const html = renderToStaticMarkup(
      <BulkActionBar selectedCount={0} maxSelectable={50} onClear={() => {}}>
        <button type="button">Apply</button>
      </BulkActionBar>,
    );
    expect(html).toBe("");
  });

  it("renders the selected count and the caller-supplied children once at least one row is selected", () => {
    const html = renderToStaticMarkup(
      <BulkActionBar selectedCount={3} maxSelectable={50} onClear={() => {}}>
        <button type="button">Apply</button>
      </BulkActionBar>,
    );
    expect(html).toContain("3 selected");
    expect(html).toContain("Apply");
    expect(html).not.toContain("(max 50)");
  });

  it("shows the explicit '(max N)' ceiling once the selection has reached the cap", () => {
    const html = renderToStaticMarkup(
      <BulkActionBar selectedCount={50} maxSelectable={50} onClear={() => {}}>
        <button type="button">Apply</button>
      </BulkActionBar>,
    );
    expect(html).toContain("50 selected");
    expect(html).toContain("(max 50)");
  });

  it("renders a real 'Clear selection' control, disableable via clearDisabled", () => {
    const html = renderToStaticMarkup(
      <BulkActionBar selectedCount={2} maxSelectable={50} onClear={() => {}} clearDisabled>
        <button type="button">Apply</button>
      </BulkActionBar>,
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Clear selection<\/button>/);
  });

  it("exposes an accessible region with a real name -- never an unlabeled toolbar", () => {
    const html = renderToStaticMarkup(
      <BulkActionBar selectedCount={1} maxSelectable={50} onClear={() => {}}>
        <button type="button">Apply</button>
      </BulkActionBar>,
    );
    expect(html).toMatch(/role="region"/);
    expect(html).toMatch(/aria-label="Bulk actions"/);
  });
});
