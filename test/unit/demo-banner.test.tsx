import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DemoBanner } from "@/components/layout/demo-banner";

/**
 * Demo Vs Real Workspace Separation. This repo has no DOM/component-
 * interaction harness (no `@testing-library/react`/jsdom — see
 * test/unit/page-loading.test.tsx's own established precedent);
 * `renderToStaticMarkup` is used instead for this presentation-only
 * server component.
 */

describe("DemoBanner", () => {
  it("renders the exact required copy and role=status when isDemo is true", () => {
    const html = renderToStaticMarkup(<DemoBanner isDemo={true} />);
    expect(html).toMatch(/role="status"/);
    expect(html).toContain("Demo workspace");
    expect(html).toContain("These are sample data. Nothing here belongs to a real customer.");
  });

  it("renders nothing at all when isDemo is false — absent, not hidden via CSS", () => {
    const html = renderToStaticMarkup(<DemoBanner isDemo={false} />);
    expect(html).toBe("");
  });
});
