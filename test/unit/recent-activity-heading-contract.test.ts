import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Dashboard heading hierarchy fix — source-contract proxy for
 * RecentActivity's heading-level correction (no DOM/component-rendering
 * harness exists in this repo — see button-variant-contract.test.ts's
 * own header comment for the same reasoning). Proves the heading is now
 * h2 (matching its direct siblings NeedsAttention/TodaySection, both
 * already h2 — all three are direct children of the same Dashboard
 * page.tsx wrapper, no intervening parent heading) while the visual
 * class string, copy, and surrounding layout are all byte-identical to
 * before — a semantic-only fix, never a restyle.
 */

const source = readFileSync("src/components/dashboard/recent-activity.tsx", "utf8");

describe("RecentActivity — heading corrected to <h2>, visually unchanged", () => {
  it("renders <h2>Recent activity</h2>, never <h3>", () => {
    expect(source).toMatch(/<h2 className="text-text-primary text-sm font-semibold">Recent activity<\/h2>/);
    expect(source).not.toMatch(/<h3[^>]*>Recent activity<\/h3>/);
  });

  it("the className is byte-identical to the original <h3>'s own classes — a pure tag change, no restyle", () => {
    const match = source.match(/<h2 className="([^"]*)">Recent activity<\/h2>/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("text-text-primary text-sm font-semibold");
  });

  it("never adopts Visual Design V4's SectionTitle here — that would be a real visual change (13px vs this heading's own 14px text-sm), deliberately out of scope for this semantic-only fix", () => {
    expect(source).not.toMatch(/SectionTitle/);
  });

  it("the surrounding card surface, 'View all activity' link, and activity-list rendering are all untouched", () => {
    expect(source).toMatch(/className=\{`p-6 \$\{CARD_SURFACE_CLASSES\}`\}/);
    expect(source).toContain('href="/activity"');
    expect(source).toContain("View all activity");
    expect(source).toContain("No activity yet.");
  });
});
