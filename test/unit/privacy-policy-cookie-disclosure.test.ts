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

  it("does not claim the application uses analytics, marketing, or advertising trackers — scoped to the application, with website analytics disclosed separately", () => {
    expect(privacySource).toMatch(/do not\s*\n?\s*currently use third-party analytics or advertising trackers inside the application itself/);
    expect(privacySource).toMatch(/Measurement of\s*\n?\s*our marketing website is described in Section 2 and applies only if and when we switch it on/);
  });

  it("links to the dedicated Cookie Policy (Slice 2 — /cookies now exists)", () => {
    expect(privacySource).toMatch(/href="\/cookies"/);
  });

  it("does not mention Paddle or billing as though it currently sets cookies — billing remains out of scope here", () => {
    expect(privacySource).not.toMatch(/paddle/i);
  });
});

describe("Privacy Policy prospective website-analytics wording stays factual", () => {
  const flat = privacySource.replace(/\s+/g, " ");
  const bullet = flat.slice(flat.indexOf("Website analytics (if enabled)."), flat.indexOf("Website analytics (if enabled).") + 2500);

  it("stays prospective: describes what happens only if and when it is switched on", () => {
    expect(bullet).toContain("We may measure traffic");
    expect(bullet).toContain("If and when we switch it on");
    expect(flat).not.toMatch(/we (currently )?use Vercel Web Analytics/i);
  });

  it("separates Vercel's guaranteed reporting window from its actual retention, and promises no deletion date", () => {
    expect(bullet).toContain("keeps this data available to us for the reporting window of our hosting plan and may keep it for longer");
    expect(bullet).toContain("cannot promise a deletion date");
    expect(flat).not.toContain("retains the underlying data for the reporting period");
    expect(flat).not.toMatch(/Vercel (deletes|removes|erases)/i);
  });

  it("attributes the no-cookies claim to Vercel and makes no categorical browser-storage claim about the script", () => {
    expect(bullet).toContain("According to Vercel, it does not use cookies");
    expect(bullet).not.toContain("It does not use cookies or other browser storage");
    expect(bullet).toContain("we add no cookies or other browser storage of our own for it");
  });

  it("describes the page address and the possible query string, and states the intent to remove it", () => {
    expect(bullet).toContain("the web address of the page viewed");
    expect(bullet).toContain("A web address can include a query string");
    expect(bullet).toContain("we intend to remove query strings before this measurement is sent");
    expect(bullet).not.toContain("the page path viewed");
  });

  it("still discloses the daily identifier, the data categories and that Aqenra stores no IPs or visit records", () => {
    expect(bullet).toContain("country, device type, browser, and operating system");
    expect(bullet).toContain("resets daily");
    expect(bullet).toContain("Aqenra does not store IP addresses or individual visit records");
  });

  it("records query-string stripping as an explicit future activation requirement next to the traffic configuration", () => {
    const env = readFileSync(".env.example", "utf8").replace(/\s+/g, " ").replace(/# /g, "");
    expect(env).toContain("ACTIVATION REQUIREMENT (not implemented yet)");
    expect(env).toContain("must strip query strings");
    expect(env).toContain("beforeSend");
  });
});
