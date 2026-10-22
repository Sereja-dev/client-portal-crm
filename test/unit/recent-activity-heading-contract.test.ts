import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Dashboard heading hierarchy — regression guard specifically for
 * RecentActivity's own heading history (no DOM/component-rendering
 * harness exists in this repo — see button-variant-contract.test.ts's
 * own header comment for the same reasoning). This component's heading
 * has changed twice: <h3> (orphaned when its former h3-level peer
 * widgets and h2 "Breakdowns" parent were removed) → a standalone
 * <h2 className="text-sm font-semibold"> (semantically correct but a
 * third, independently-sized visual treatment, inconsistent with its
 * two true h2 siblings — found in Production manual smoke) → now the
 * shared SectionTitle (src/components/ui/page-section.tsx), giving it
 * the exact same semantic AND visual treatment as NeedsAttention/Today.
 * This file exists to make sure neither earlier regression can return
 * silently; the broader "three migrated surfaces" contract lives in
 * visual-v4-typography-spacing-contract.test.ts and is not duplicated
 * here beyond what's needed to prove that.
 */

const source = readFileSync("src/components/dashboard/recent-activity.tsx", "utf8");

describe("RecentActivity — heading regression guard", () => {
  it("imports and renders the shared SectionTitle, never owning its own literal heading tag", () => {
    expect(source).toMatch(/import\s*\{\s*SectionTitle\s*\}\s*from\s*"@\/components\/ui\/page-section"/);
    expect(source).toMatch(/<SectionTitle>Recent activity<\/SectionTitle>/);
  });

  it("never regresses to the original orphaned <h3>", () => {
    expect(source).not.toMatch(/<h3[^>]*>Recent activity<\/h3>/);
  });

  it("never regresses to the superseded standalone <h2 className=\"text-text-primary text-sm font-semibold\"> — that was semantically correct but visually inconsistent with its two true h2 siblings, the exact defect SectionTitle adoption fixes", () => {
    expect(source).not.toMatch(/<h2 className="text-text-primary text-sm font-semibold">Recent activity<\/h2>/);
  });
});
