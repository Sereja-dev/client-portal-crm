import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Privacy & Cookie Policy Improvement, Slice 2. The new dedicated Cookie
 * Policy at /cookies. No DOM/component-rendering harness exists in this
 * repo (see legal-back-button-contract.test.ts's own header comment) —
 * this is therefore a source-contract proxy over the real file, same
 * convention every other legal-page test in this repo already uses.
 */

const cookiesSource = readFileSync("src/app/cookies/page.tsx", "utf8");
const footerSource = readFileSync("src/components/layout/footer.tsx", "utf8");
const privacySource = readFileSync("src/app/privacy/page.tsx", "utf8");
const legalConfigSource = readFileSync("src/lib/legal/platform-config.ts", "utf8");

// Strips the top-of-file doc comment, which legitimately explains (in
// prose aimed at future maintainers, not at a visitor) why TEST_MODE and
// Paddle are deliberately excluded from the rendered content — mirrors
// legal-back-button-contract.test.ts's own identical "strip comments
// before asserting on the real code/content" technique.
const cookiesRendered = cookiesSource.replace(/\/\*[\s\S]*?\*\//g, "");

describe("Cookie Policy page", () => {
  it("uses the shared legal-page layout conventions (back button, legal config, metadata)", () => {
    expect(cookiesSource).toMatch(/<LegalBackButton\s*\/>/);
    expect(cookiesSource).toMatch(/from "@\/components\/legal\/legal-back-button"/);
    expect(cookiesSource).toMatch(/getPlatformLegalConfig/);
    expect(cookiesSource).toMatch(/title: `Cookie Policy — \$\{siteConfig\.name\}`/);
    // Same outer layout classes as the Privacy Policy page, for visual
    // consistency — plus `w-full`, added by the mobile horizontal-overflow
    // fix (see page.tsx's own doc comment): without a definite width,
    // this flex-item <main> grew to fit the table below instead of being
    // clamped to the viewport, which is what caused the Production defect.
    expect(cookiesSource).toContain('className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6"');
  });

  it("is a definite-width flex item (w-full), not auto-width — the fix for the mobile horizontal-overflow defect", () => {
    expect(cookiesSource).toMatch(/\bw-full\b/);
  });

  it("has its own dedicated effective date, not a reuse of the Privacy Policy's", () => {
    expect(cookiesSource).toMatch(/config\.cookiePolicyEffectiveDate/);
    expect(cookiesSource).not.toMatch(/config\.privacyEffectiveDate/);
  });

  it("discloses every verified Production cookie/storage item, by name", () => {
    expect(cookiesSource).toMatch(/active_organization_id/);
    expect(cookiesSource).toMatch(/aqenra_theme/);
    expect(cookiesSource).toMatch(/Saved views/);
    expect(cookiesSource).toMatch(/Table column preferences/);
    expect(cookiesSource).toMatch(/Recent searches/);
    expect(cookiesSource).toMatch(/Public-beta notice dismissal/);
    expect(cookiesSource).toMatch(/Feedback button position/);
    expect(cookiesSource).toMatch(/Authentication session/);
  });

  it("never invents a precise Supabase/authentication cookie expiry", () => {
    const authRow = cookiesSource.match(/Authentication session[\s\S]{0,600}/)?.[0] ?? "";
    expect(authRow).not.toMatch(/\d+\s*(day|month|year|hour)s?/i);
    expect(authRow).toMatch(/authentication provider's own session configuration/);
  });

  it("states the exact, independently-verified retention for the two 1-year cookies — not invented", () => {
    expect(cookiesSource).toMatch(/active_organization_id[\s\S]{0,400}1 year/);
    expect(cookiesSource).toMatch(/aqenra_theme[\s\S]{0,400}1 year/);
  });

  it("states the exact, verified cap for recent searches (6), not an invented number", () => {
    expect(cookiesSource).toMatch(/up to 6 of your most recently selected search results/);
  });

  it("never names a TEST_MODE-only cookie as a Production technology", () => {
    expect(cookiesRendered).not.toMatch(/x_e2e_test_user/);
    expect(cookiesRendered).not.toMatch(/TEST_MODE/);
  });

  it("never describes the dormant Paddle integration as active Production tracking", () => {
    expect(cookiesRendered).not.toMatch(/paddle/i);
  });

  it("does not claim the Service uses analytics, marketing, or advertising cookies", () => {
    expect(cookiesSource).toMatch(/we do not use any analytics, advertising, or marketing/i);
  });

  it("does not assert worldwide/universal legal compliance", () => {
    expect(cookiesSource).not.toMatch(/GDPR|CCPA|LGPD|ePrivacy|PECR/);
    expect(cookiesSource).not.toMatch(/compliant with/i);
  });

  it("does not claim every cookie is strictly necessary or conclusively exempt from consent", () => {
    expect(cookiesSource).toMatch(/have not independently assessed[\s\S]{0,40}do not claim/i);
    expect(cookiesSource).toMatch(/legally exempt from consent requirements/i);
  });

  it("does not claim browser-local storage can never be transmitted by application code", () => {
    expect(cookiesSource).not.toMatch(/never\s+(be\s+)?(sent|transmitted)\b/i);
    expect(cookiesSource).toMatch(/not automatically attached to every request/);
  });

  it("does not describe browser-local storage as automatically sent with HTTP requests", () => {
    expect(cookiesSource).toMatch(/is not automatically attached to every request your browser\s*\n?\s*sends/);
  });

  it("does not promise an in-app cookie-preference center or opt-out controls that don't exist", () => {
    expect(cookiesSource).toMatch(/do not currently offer a separate in-app cookie-preference center/);
  });

  it("does not introduce a cookie banner, consent modal, or 'Cookie Settings' control — the word 'consent' may still appear in plain descriptive prose", () => {
    // A static Server Component: no client-side interactivity at all, so
    // there is no banner/modal/preference toggle for it to render.
    expect(cookiesSource).not.toMatch(/^"use client";/);
    expect(cookiesSource).not.toMatch(/useState|useEffect/);
    expect(cookiesSource).not.toMatch(/Cookie Settings/);
    expect(cookiesSource).not.toMatch(/\bbanner\b/i);
    expect(cookiesSource).not.toMatch(/Accept all|Reject optional|Customize/i);
  });

  it("wraps its table in a horizontally-scrollable container, safe for narrow/mobile viewports", () => {
    expect(cookiesSource).toMatch(/overflow-x-auto/);
  });

  it("explains cookies vs. browser-local storage in plain English", () => {
    expect(cookiesSource).toMatch(/Cookies are small pieces of text/);
    expect(cookiesSource).toMatch(/localStorage/);
  });

  it("explains that clearing site data signs the user out and resets preferences", () => {
    expect(cookiesSource).toMatch(/clear cookies and site data[\s\S]{0,40}/i);
    expect(cookiesSource).toMatch(/sign you out and reset/);
  });
});

describe("Cookie Policy discoverability", () => {
  it("the Privacy Policy links to /cookies", () => {
    expect(privacySource).toMatch(/href="\/cookies"/);
  });

  it("the app footer links to the Cookie Policy, alongside Privacy Policy and Terms of Service", () => {
    expect(footerSource).toMatch(/href="\/cookies"/);
    expect(footerSource).toMatch(/Cookie Policy/);
    // The two pre-existing links are untouched.
    expect(footerSource).toMatch(/href="\/privacy"/);
    expect(footerSource).toMatch(/href="\/terms"/);
  });
});

describe("Platform legal config — Cookie Policy effective date", () => {
  it("defines cookiePolicyEffectiveDate as its own field, driven by its own env var", () => {
    expect(legalConfigSource).toMatch(/cookiePolicyEffectiveDate: string/);
    expect(legalConfigSource).toMatch(/trimmedEnv\("COOKIE_POLICY_EFFECTIVE_DATE"\)/);
  });

  it("never silently reuses the Privacy Policy's effective date as a fallback", () => {
    // The fallback is its own named constant (never the Privacy Policy's), holding a real, non-empty date.
    expect(legalConfigSource).toMatch(
      /cookiePolicyEffectiveDate:\s*trimmedEnv\("COOKIE_POLICY_EFFECTIVE_DATE"\)\s*\?\?\s*COOKIE_POLICY_DEFAULT_EFFECTIVE_DATE/,
    );
    const match = legalConfigSource.match(/const COOKIE_POLICY_DEFAULT_EFFECTIVE_DATE = "([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toBe("");
  });
});
