import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Source-contract coverage for the Public Beta legal-identity alignment: Aqenra is a product brand operated by
// Umerenko Sergei, an individual — not a registered company. The three legal pages must take the operator from the
// one shared config (never hardcode it), and must not assert legal facts that have not been provided.

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const PAGES = {
  privacy: read("src/app/privacy/page.tsx"),
  terms: read("src/app/terms/page.tsx"),
  cookies: read("src/app/cookies/page.tsx"),
};
const CONFIG = read("src/lib/legal/platform-config.ts");

describe("legal pages take the operator from the shared config", () => {
  for (const [name, source] of Object.entries(PAGES)) {
    it(`/${name} introduces the operator via config.operatorDescription, not hardcoded text`, () => {
      expect(source).toMatch(/config\.operatorDescription/);
      expect(source).not.toMatch(/Umerenko/);
    });
  }

  it("Privacy and Terms add the brand-is-not-a-company clarification (only when the default operator applies)", () => {
    expect(PAGES.privacy).toMatch(/config\.brandDisclaimer/);
    expect(PAGES.terms).toMatch(/config\.brandDisclaimer/);
  });

  it("the footers use the one shared copyright line", () => {
    expect(read("src/components/layout/footer.tsx")).toMatch(/getPlatformCopyrightLine\(year\)/);
    expect(read("src/components/auth/auth-shell.tsx")).toMatch(/getPlatformCopyrightLine\(year\)/);
  });
});

describe("no unprovided legal facts are asserted", () => {
  const publicText = Object.values(PAGES).join("\n");

  it("never describes the service as a company, corporation or incorporated entity", () => {
    expect(publicText).not.toMatch(/\b(Inc\.?|LLC|Ltd\.?|GmbH|Corp\.?|Corporation|incorporated|Limited Liability)\b/i);
    expect(publicText).not.toMatch(/registered (company|office|address|business)/i);
  });

  it("invents no registration, tax or VAT identifiers", () => {
    expect(publicText).not.toMatch(/\b(VAT|EIN|company (registration )?number|registration number|tax id)\b/i);
    expect(CONFIG).not.toMatch(/\b(vatId|taxId|registrationNumber|companyNumber)\b/);
  });

  it("does not choose a governing-law jurisdiction or court venue", () => {
    expect(publicText + CONFIG).not.toMatch(/\b(Thailand|Thai|Russia|Russian|Delaware|California|England|Singapore)\b/i);
    expect(publicText).not.toMatch(/\b(exclusive jurisdiction|venue|courts? of)\b/i);
    expect(CONFIG).toMatch(/"the jurisdiction in which the Service operator is located"/);
  });

  it("the only operator facts in code are the confirmed name; no address is hardcoded", () => {
    expect(CONFIG).toMatch(/const DEFAULT_OPERATOR_NAME = "Umerenko Sergei";/);
    expect(CONFIG).not.toMatch(/legalAddress:\s*"/);
  });
});

describe("Terms and Privacy stay truthful about payments during the free beta", () => {
  it("Terms describe a free public beta and no live payment processor, and do not present paid plans as active", () => {
    expect(PAGES.terms).toMatch(/free of charge as a public beta/);
    expect(PAGES.terms).toMatch(/does not charge for access\s+through any live payment processor/);
    expect(PAGES.terms).not.toMatch(/Paddle/i);
  });

  it("Privacy still states that no payment provider processes live payments", () => {
    expect(PAGES.privacy).toMatch(/does not currently process live payments through any payment provider/);
  });
});

describe("effective dates are explicit and never backdated", () => {
  it("documents the revision history next to the date constants", () => {
    expect(CONFIG).toMatch(/PRIVACY_POLICY_DEFAULT_EFFECTIVE_DATE = "October 30, 2026"/);
    expect(CONFIG).toMatch(/TOS_DEFAULT_EFFECTIVE_DATE = "October 30, 2026"/);
    expect(CONFIG).toMatch(/COOKIE_POLICY_DEFAULT_EFFECTIVE_DATE = "October 27, 2026"/);
    expect(CONFIG).toMatch(/2026-08-09 initial/);
    expect(CONFIG).toMatch(/never\s*\*?\s*backdated/);
  });
});
