import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Legal Pages Back Navigation Fix. Privacy/Terms previously rendered a
 * hardcoded `<Link href="/">` for "← Back" — always app.aqenra.com's own
 * root, regardless of whether the visitor arrived from the separate
 * aqenra.com marketing site or from somewhere else inside app.aqenra.com.
 * Fixed by LegalBackButton, a tiny client-only "island" that uses genuine
 * `window.history.back()` navigation, with a fixed marketing-site fallback
 * only when there's no history to go back to.
 *
 * No DOM/component-rendering harness exists in this repo (see
 * button-variant-contract.test.ts's own header comment) — this is
 * therefore a source-contract proxy over the real files, same as every
 * other component test here.
 */

const buttonSource = readFileSync("src/components/legal/legal-back-button.tsx", "utf8");
const privacySource = readFileSync("src/app/privacy/page.tsx", "utf8");
const termsSource = readFileSync("src/app/terms/page.tsx", "utf8");

// Strips /* ... */ block comments so the "no open-redirect surface" checks
// below assert against the component's actual code, not its own prose
// explaining why those mechanisms are deliberately absent (which
// legitimately names them).
const buttonCode = buttonSource.replace(/\/\*[\s\S]*?\*\//g, "");

describe("LegalBackButton (contract)", () => {
  it("is a client component — the only way window.history is reachable at all", () => {
    expect(buttonSource).toMatch(/^"use client";/);
  });

  it("invokes genuine browser-history navigation, never a fixed href", () => {
    expect(buttonCode).toMatch(/window\.history\.back\(\)/);
    // The component renders a <button>, not a <Link>/<a> with a fixed
    // destination — "Back" must be an action, not a navigation to a URL.
    // Checked against comment-stripped code: the doc comment above
    // legitimately mentions the old <Link href="/"> pattern this replaces.
    expect(buttonCode).toMatch(/<button\b/);
    expect(buttonCode).not.toMatch(/<Link\b/);
    expect(buttonCode).not.toMatch(/<a\b/);
  });

  it("falls back to a fixed, hardcoded marketing-site URL only when there is no usable history", () => {
    expect(buttonSource).toMatch(/window\.history\.length\s*>\s*1/);
    expect(buttonSource).toMatch(/MARKETING_FALLBACK_URL\s*=\s*"https:\/\/aqenra\.com"/);
    expect(buttonSource).toMatch(/window\.location\.href\s*=\s*MARKETING_FALLBACK_URL/);
  });

  it("never reads a visitor-controlled redirect target — no open-redirect surface", () => {
    // No query string, URLSearchParams, or referrer value is ever used in
    // the actual code to decide where "Back" goes — the only two
    // destinations are real browser history and the one fixed constant
    // above. Checked against the code with comments stripped, since the
    // component's own doc comment legitimately names these mechanisms
    // while explaining why they're deliberately unused.
    expect(buttonCode).not.toMatch(/searchParams/i);
    expect(buttonCode).not.toMatch(/URLSearchParams/);
    expect(buttonCode).not.toMatch(/location\.search/);
    expect(buttonCode).not.toMatch(/document\.referrer/);
    expect(buttonCode).not.toMatch(/\bredirect\b/i);
  });

  it("preserves the exact pre-existing visual/focus-visible classes", () => {
    expect(buttonSource).toContain("text-text-muted");
    expect(buttonSource).toContain("hover:text-text-primary");
    expect(buttonSource).toContain("hover:underline");
    expect(buttonSource).toContain("focus-visible:ring-2");
    expect(buttonSource).toContain("focus-visible:ring-focus-ring");
    expect(buttonSource).toContain("focus-visible:ring-offset-2");
    expect(buttonSource).not.toMatch(/focus-visible:ring-black\b/);
  });

  it("preserves the exact existing copy", () => {
    expect(buttonSource).toContain("← Back");
  });
});

describe("Privacy/Terms pages no longer hardcode a fixed Back destination (contract)", () => {
  for (const [label, source] of [
    ["privacy", privacySource],
    ["terms", termsSource],
  ] as const) {
    it(`${label} page renders LegalBackButton, not a hardcoded href="/" Back link`, () => {
      expect(source).toMatch(/<LegalBackButton\s*\/>/);
      expect(source).toMatch(/from "@\/components\/legal\/legal-back-button"/);
      // The old pattern this fix removes: a Link/anchor whose destination
      // is the fixed root path, immediately followed by the "← Back" copy.
      expect(source).not.toMatch(/href="\/"[\s\S]{0,200}← Back/);
    });
  }

  it("terms page's unrelated in-body Link to /privacy is untouched (only the Back control changed)", () => {
    expect(termsSource).toMatch(/<Link href="\/privacy"/);
  });
});
