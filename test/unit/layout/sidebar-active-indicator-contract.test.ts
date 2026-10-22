import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Visual Design Improvement V3 — source-contract proxy for the new
 * subtle left accent bar on the actual active DESTINATION row (no DOM/
 * component-rendering harness exists for Sidebar itself — it calls
 * next/navigation's usePathname(), which throws under
 * renderToStaticMarkup — see sidebar.tsx's own doc comment on
 * buildSidebarGroups being exported precisely so the pure logic stays
 * testable; this file covers the one remaining untestable-by-render
 * piece, activeLinkClasses, the same way).
 */

const source = readFileSync("src/components/layout/sidebar.tsx", "utf8");

function extractFunctionBody(fnName: string): string {
  const match = source.match(new RegExp(`function ${fnName}\\([\\s\\S]*?\\n\\}`));
  expect(match, `expected to find function ${fnName}`).not.toBeNull();
  return match![0];
}

describe("activeLinkClasses — the actual destination row's own active treatment", () => {
  const body = extractFunctionBody("activeLinkClasses");

  it("active branch preserves the existing solid bg-accent/text-white fill, and adds a visible border-l-2 bar", () => {
    expect(body).toMatch(/active\s*\?\s*"[^"]*border-l-2[^"]*border-text-inverse[^"]*bg-accent[^"]*text-white[^"]*"/);
  });

  it("inactive branch preserves the existing text-text-secondary/hover wash, with a transparent (not absent) border-l-2 — so the 2px border never shifts row content width between active and inactive", () => {
    expect(body).toMatch(/:\s*"border-l-2 border-transparent text-text-secondary hover:bg-\[var\(--hover\)\]"/);
  });

  it("the active bar uses the semantic text-inverse token (white in both Light and Dark), never a literal white/black or the --accent token itself (which would be invisible against its own identical bg-accent fill)", () => {
    expect(body).toContain("border-text-inverse");
    expect(body).not.toMatch(/\bborder-white\b/);
    expect(body).not.toMatch(/\bborder-black\b/);
    expect(body).not.toMatch(/\bborder-accent\b/);
  });
});

describe("Group/parent summary — untouched, never receives the new destination-only indicator", () => {
  it("the group summary's own active className expression is a separate literal, never calling activeLinkClasses", () => {
    const summaryMatch = source.match(
      /groupActive\s*\?\s*"bg-\[var\(--selected\)\] text-accent"\s*:\s*"text-text-secondary hover:bg-\[var\(--hover\)\]"/,
    );
    expect(summaryMatch).not.toBeNull();
  });

  it("the summary's own className template never contains border-l-2 or border-text-inverse", () => {
    const summaryBlock = source.match(/<summary\b[\s\S]*?<\/summary>/);
    expect(summaryBlock).not.toBeNull();
    expect(summaryBlock![0]).not.toMatch(/border-l-2/);
    expect(summaryBlock![0]).not.toMatch(/border-text-inverse/);
  });
});

describe("Both real destination row types use the shared activeLinkClasses — single-destination top-level Link and a multi-item group's child Link", () => {
  it("the single-destination top-level Link applies activeLinkClasses(groupActive)", () => {
    expect(source).toMatch(/className=\{`\$\{TOP_LEVEL_ROW_BASE\} whitespace-nowrap \$\{activeLinkClasses\(groupActive\)\}`\}/);
  });

  it("a multi-item group's own child Link applies activeLinkClasses(childActive)", () => {
    expect(source).toMatch(/className=\{`\$\{CHILD_ROW_BASE\} whitespace-nowrap \$\{activeLinkClasses\(childActive\)\}`\}/);
  });

  it("aria-current=\"page\" is still present on both Link types, unchanged", () => {
    const matches = [...source.matchAll(/aria-current=\{(groupActive|childActive) \? "page" : undefined\}/g)];
    expect(matches.length).toBe(2);
  });
});

describe("Mobile navigation is unaffected — a genuinely separate implementation, not a shared import", () => {
  const mobileNavSource = readFileSync("src/components/layout/mobile-navigation.tsx", "utf8");

  it("mobile-navigation.tsx never imports activeLinkClasses from sidebar.tsx (it isn't even exported) — only the pure, unrelated helpers it already legitimately reused before this slice", () => {
    expect(mobileNavSource).not.toMatch(/activeLinkClasses/);
    expect(source).not.toMatch(/export\s+function\s+activeLinkClasses/);
    const importMatch = mobileNavSource.match(/import\s*\{([^}]*)\}\s*from\s*"\.\/sidebar"/);
    expect(importMatch).not.toBeNull();
    expect(importMatch![1]).not.toMatch(/activeLinkClasses/);
  });

  it("mobile-navigation.tsx's own active-item styling has no border-l-2/border-text-inverse — the new indicator never leaked into it", () => {
    expect(mobileNavSource).not.toMatch(/border-l-2/);
    expect(mobileNavSource).not.toMatch(/border-text-inverse/);
  });
});
