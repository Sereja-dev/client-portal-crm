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

describe("effective dates are the Product Owner's approved dates, explicit and never backdated", () => {
  it("Privacy, Terms and the Cookie Policy all default to October 31, 2026", () => {
    expect(CONFIG).toMatch(/PRIVACY_POLICY_DEFAULT_EFFECTIVE_DATE = "October 31, 2026"/);
    expect(CONFIG).toMatch(/TOS_DEFAULT_EFFECTIVE_DATE = "October 31, 2026"/);
    expect(CONFIG).toMatch(/COOKIE_POLICY_DEFAULT_EFFECTIVE_DATE = "October 31, 2026"/);
    // The first publication date stays in the revision history; it is never a default again.
    expect(CONFIG).toMatch(/Cookie Policy\s+2026-10-27 first published/);
  });

  it("no pending-publication marker or placeholder remains anywhere in the shipped legal code", () => {
    const shipped = Object.values(PAGES).join("\n") + CONFIG;
    expect(shipped).not.toMatch(/to be confirmed on publication/i);
    expect(shipped).not.toMatch(/EFFECTIVE_DATE_PENDING|formatEffectiveLine/);
  });

  it("the original August 9, 2026 date is only history, never a default", () => {
    expect(CONFIG).not.toMatch(/(PRIVACY_POLICY|TOS)_DEFAULT_EFFECTIVE_DATE = "August/);
    expect(CONFIG).toMatch(/2026-08-09 initial/);
    expect(CONFIG).toMatch(/never backdated/);
  });

  it("environment overrides keep their precedence over the defaults", () => {
    expect(CONFIG).toMatch(/privacyEffectiveDate: trimmedEnv\("PRIVACY_POLICY_EFFECTIVE_DATE"\) \?\? PRIVACY_POLICY_DEFAULT_EFFECTIVE_DATE/);
    expect(CONFIG).toMatch(/tosEffectiveDate: trimmedEnv\("TOS_EFFECTIVE_DATE"\) \?\? TOS_DEFAULT_EFFECTIVE_DATE/);
    expect(CONFIG).toMatch(/cookiePolicyEffectiveDate: trimmedEnv\("COOKIE_POLICY_EFFECTIVE_DATE"\) \?\? COOKIE_POLICY_DEFAULT_EFFECTIVE_DATE/);
  });

  for (const [name, field] of [["privacy", "privacyEffectiveDate"], ["terms", "tosEffectiveDate"], ["cookies", "cookiePolicyEffectiveDate"]] as const) {
    it(`/${name} renders "Effective {config.${field}}" straight from the shared config`, () => {
      expect(PAGES[name]).toContain(`Effective {config.${field}}`);
    });
  }
});

describe("operator wording cannot diverge between surfaces", () => {
  for (const [name, source] of Object.entries(PAGES)) {
    it(`/${name} never reads config.legalName directly (only the shared operatorDescription)`, () => {
      expect(source).not.toMatch(/config\.legalName/);
    });
  }

  it("the marketing-site operator constant is referenced next to the default operator, so the two are changed together", () => {
    expect(CONFIG).toMatch(/aqenra-marketing, src\/config\/site\.ts OPERATOR_NAME/);
  });
});

describe("unresolved jurisdiction clauses are inventoried — a new use must be reviewed", () => {
  it("config.jurisdiction is rendered in exactly the three known public clauses", () => {
    expect(PAGES.terms.match(/config\.jurisdiction/g)).toHaveLength(1);
    expect(PAGES.privacy.match(/config\.jurisdiction/g)).toHaveLength(1);
    expect(PAGES.cookies.match(/config\.jurisdiction/g)).toHaveLength(1);
  });

  it("the default remains the generic placeholder and the config documents the open decision", () => {
    expect(CONFIG).toMatch(/OPEN OWNER\/LEGAL DECISION/);
    expect(CONFIG).toMatch(/Terms of Service §10/);
    expect(CONFIG).toMatch(/Privacy Policy §9 and Cookie Policy §8/);
  });
});
