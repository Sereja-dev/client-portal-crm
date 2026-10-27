import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Privacy & Cookie Policy Improvement, Slice 1. Section 3 ("How we use
 * information") of the Privacy Policy previously claimed the Service "does
 * not set any cookies beyond those strictly necessary to keep you signed
 * in and remember your active workspace" — incomplete, since it omitted
 * the existing `aqenra_theme` display-preference cookie and said nothing
 * about the browser-local storage this app also uses (saved views, table
 * column settings, recent search results, Free Beta Banner dismissal).
 *
 * No DOM/component-rendering harness exists in this repo (see
 * legal-back-button-contract.test.ts's own header comment) — this is
 * therefore a source-contract proxy over the real file, same convention.
 *
 * Slice 2 (Cookie Policy) updates the one assertion that depended on
 * /cookies not existing yet — it now asserts the opposite: the paragraph
 * links to the real Cookie Policy page.
 */

const privacySource = readFileSync("src/app/privacy/page.tsx", "utf8");

describe("Privacy Policy cookie disclosure (Section 3)", () => {
  it("no longer makes the old, incomplete 'no cookies beyond sign-in/workspace' claim", () => {
    expect(privacySource).not.toMatch(
      /does not set any\s*\n?\s*cookies beyond those strictly necessary/,
    );
  });

  it("discloses the first-party cookies actually in use: sign-in, active workspace, and theme preference", () => {
    expect(privacySource).toMatch(/first-party\s*\n?\s*cookies to support sign-in/);
    expect(privacySource).toMatch(/remember your active workspace/);
    expect(privacySource).toMatch(/retain display preferences such as\s*\n?\s*your selected theme/);
  });

  it("discloses browser-local storage usage, distinct from cookies", () => {
    expect(privacySource).toMatch(/browser-local storage for certain preferences and features/);
    expect(privacySource).toMatch(/saved views, table column settings, recently selected search results/);
    expect(privacySource).toMatch(/dismissal of the\s*\n?\s*public-beta notice/);
  });

  it("does not claim browser-local storage is never transmitted to servers under any circumstance", () => {
    expect(privacySource).not.toMatch(/never\s+(be\s+)?(sent|transmitted)/i);
    // The actual, narrower claim: not sent automatically with every request
    // (true of localStorage, unlike a cookie) — not an absolute "never".
    expect(privacySource).toMatch(/not\s*\n?\s*automatically sent with every request/);
  });

  it("does not claim the Service uses analytics, marketing, or advertising trackers", () => {
    expect(privacySource).toMatch(/do not\s*\n?\s*currently use third-party analytics or advertising trackers/);
  });

  it("links to the dedicated Cookie Policy (Slice 2 — /cookies now exists)", () => {
    expect(privacySource).toMatch(/href="\/cookies"/);
  });

  it("does not mention Paddle or billing as though it currently sets cookies — billing remains out of scope here", () => {
    expect(privacySource).not.toMatch(/paddle/i);
  });
});
