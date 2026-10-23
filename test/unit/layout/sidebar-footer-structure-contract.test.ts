import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Sidebar Account Menu V1 — source-contract proof of the new scrollable-
 * nav + pinned-footer structure, and that it is additive: the existing
 * group-rendering logic, width, and active-route styling are untouched
 * (covered already by sidebar.test.ts / sidebar-active-indicator-
 * contract.test.ts, both of which exercise buildSidebarGroups/
 * activeLinkClasses directly and are unaffected by this structural
 * wrapper change).
 */
const source = readFileSync("src/components/layout/sidebar.tsx", "utf8");

describe("Sidebar — new scrollable-nav + pinned-footer structure", () => {
  it("the <nav> itself is viewport-pinned at md and up (sticky, explicit height) — required for an independently-scrollable child region to mean anything", () => {
    expect(source).toMatch(/md:sticky/);
    expect(source).toMatch(/md:top-0/);
    expect(source).toMatch(/md:h-screen/);
  });

  it("existing desktop width/flex/active-route classes are preserved unchanged", () => {
    expect(source).toMatch(/md:w-56/);
    expect(source).toMatch(/md:flex-col/);
    expect(source).toMatch(/md:gap-0\.5/);
  });

  it("the group list is wrapped in its own min-h-0/overflow-y-auto scroll region", () => {
    expect(source).toMatch(/className="min-h-0 flex-1 overflow-y-auto"/);
  });

  it("SidebarAccountMenu is rendered once, as the nav's own last child (after the scrollable group-list region closes)", () => {
    const navBodyMatch = source.match(/<nav\b[\s\S]*<\/nav>/);
    expect(navBodyMatch).not.toBeNull();
    const navBody = navBodyMatch![0];
    const accountMenuIndex = navBody.indexOf("<SidebarAccountMenu");
    const scrollWrapperCloseIndex = navBody.lastIndexOf("</div>", accountMenuIndex);
    expect(accountMenuIndex).toBeGreaterThan(-1);
    expect(scrollWrapperCloseIndex).toBeGreaterThan(-1);
    expect(scrollWrapperCloseIndex).toBeLessThan(accountMenuIndex);
  });

  it("Sidebar passes name/email straight through to SidebarAccountMenu — no new data fetch of its own", () => {
    expect(source).toMatch(/<SidebarAccountMenu name=\{name\} email=\{email\}\s*\/>/);
    // Strip block/line comments first — the props' own JSDoc legitimately
    // *names* getVerifiedAuthUser()/getCurrentMembership() in prose to
    // explain where name/email already came from; the check below is for
    // actual code (a real call expression), not that explanatory text.
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(withoutComments).not.toMatch(/getCurrentMembership\(|getVerifiedAuthUser\(|prisma\./);
  });
});
