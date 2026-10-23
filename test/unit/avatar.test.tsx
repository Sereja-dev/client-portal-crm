import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Avatar, getInitials } from "@/components/ui/avatar";

/**
 * Sidebar Account Menu V1 — real-render coverage, matching row-action-
 * menu.test.tsx's own established "no DOM/component-interaction harness
 * in this repo, use `renderToStaticMarkup`" precedent. Avatar has zero
 * hooks and no next/link dependency, so (unlike Sidebar/
 * SidebarAccountMenu) a real closed-form render is safe here.
 */
describe("getInitials — safe derivation from User.name", () => {
  it("two-word name yields both initials, uppercased", () => {
    expect(getInitials("Jordan Reyes")).toBe("JR");
  });

  it("single-word name yields one initial, never crashes on a missing second word", () => {
    expect(getInitials("Alex")).toBe("A");
  });

  it("extra internal whitespace is tolerated", () => {
    expect(getInitials("  Jordan   Reyes  ")).toBe("JR");
  });

  it("empty/whitespace-only name falls back to a safe placeholder, never an empty circle", () => {
    expect(getInitials("")).toBe("?");
    expect(getInitials("   ")).toBe("?");
  });
});

describe("Avatar — a real <span>, decorative only", () => {
  it("renders the derived initials and is aria-hidden (the real accessible name lives on whatever row wraps it)", () => {
    const html = renderToStaticMarkup(<Avatar name="Jordan Reyes" />);
    expect(html).toContain("JR");
    expect(html).toContain('aria-hidden="true"');
  });

  it("uses the existing bg-accent/text-white filled-accent convention, never a new ad hoc color", () => {
    const html = renderToStaticMarkup(<Avatar name="Jordan Reyes" />);
    expect(html).toContain("bg-accent");
    expect(html).toContain("text-white");
  });

  it("no external image, no <img> tag of any kind", () => {
    const html = renderToStaticMarkup(<Avatar name="Jordan Reyes" />);
    expect(html).not.toContain("<img");
  });
});
