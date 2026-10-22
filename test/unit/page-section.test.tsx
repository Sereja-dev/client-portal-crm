import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SectionTitle, PAGE_SECTION_STACK_CLASSES, PAGE_SUBSECTION_STACK_CLASSES } from "@/components/ui/page-section";

/**
 * Visual Design Improvement V4 — SectionTitle has no router/hook
 * dependency (unlike Sidebar/MetricCard, which rely on usePathname()/
 * next/link), so this uses the real renderToStaticMarkup pattern
 * (matching test/unit/plans-section.test.tsx's own established
 * precedent) rather than a source-contract proxy — genuine proof of
 * what actually renders, not just what the source text contains.
 */

describe("SectionTitle — a real <h2>, using the proven repo-wide h2 treatment (not the dormant compact-label tokens)", () => {
  it("renders a real <h2>, never a styled <div>/<span> standing in for a heading", () => {
    const html = renderToStaticMarkup(<SectionTitle>Needs attention</SectionTitle>);
    expect(html).toMatch(/^<h2[^>]*>Needs attention<\/h2>$/);
  });

  it("uses text-text-primary/text-lg/font-semibold/tracking-tight — the same already-proven real h2 treatment used 50+ times elsewhere in the app (and the exact pre-V4 classes NeedsAttention/TodaySection's own headings used) — never the dormant --aqenra-fs-section-title/--aqenra-fw-section-title tokens, which measured too small (13px, identical to the --aqenra-fs-label form-field-label scale) against real nested h3 content and inverted the intended hierarchy in Production", () => {
    const html = renderToStaticMarkup(<SectionTitle>Today</SectionTitle>);
    expect(html).toContain("text-text-primary");
    expect(html).toContain("text-lg");
    expect(html).toContain("font-semibold");
    expect(html).toContain("tracking-tight");
    expect(html).not.toContain("[font-size:var(--aqenra-fs-section-title)]");
    expect(html).not.toContain("[font-weight:var(--aqenra-fw-section-title)]");
  });

  it("is never uppercase and carries no decorative border/underline/accent-bar classes — a calm label, not a styled banner", () => {
    const html = renderToStaticMarkup(<SectionTitle>Recent activity</SectionTitle>);
    expect(html).not.toMatch(/\buppercase\b/);
    expect(html).not.toMatch(/\bunderline\b/);
    expect(html).not.toMatch(/\bborder-l-/);
    expect(html).not.toMatch(/\bborder-b-/);
  });

  it("forwards an optional id (for aria-labelledby wiring), omitted entirely when not passed", () => {
    const withId = renderToStaticMarkup(<SectionTitle id="my-heading">X</SectionTitle>);
    expect(withId).toContain('id="my-heading"');
    const withoutId = renderToStaticMarkup(<SectionTitle>X</SectionTitle>);
    expect(withoutId).not.toContain("id=");
  });
});

describe("Page/sub-section spacing constants — formalizing the already-dominant rhythm, not inventing a new one", () => {
  it("PAGE_SECTION_STACK_CLASSES is the existing dominant major-section gap (space-y-8)", () => {
    expect(PAGE_SECTION_STACK_CLASSES).toBe("space-y-8");
  });

  it("PAGE_SUBSECTION_STACK_CLASSES is the existing dominant sub-group gap (space-y-4)", () => {
    expect(PAGE_SUBSECTION_STACK_CLASSES).toBe("space-y-4");
  });

  it("the two constants are distinct — a sub-group must never accidentally collapse to the same gap as a major section boundary", () => {
    expect(PAGE_SECTION_STACK_CLASSES).not.toBe(PAGE_SUBSECTION_STACK_CLASSES);
  });
});
