import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformCopyrightLine, getPlatformLegalConfig } from "@/lib/legal/platform-config";

const LEGAL_ENV_KEYS = [
  "PLATFORM_LEGAL_NAME",
  "PLATFORM_LEGAL_ADDRESS",
  "PLATFORM_SUPPORT_EMAIL",
  "PLATFORM_JURISDICTION",
  "PRIVACY_POLICY_EFFECTIVE_DATE",
  "TOS_EFFECTIVE_DATE",
  "COOKIE_POLICY_EFFECTIVE_DATE",
  "INVITATION_FROM_EMAIL",
  "PLATFORM_NAME",
] as const;

const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of LEGAL_ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of LEGAL_ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
});

describe("getPlatformLegalConfig", () => {
  it("defaults to the confirmed individual operator and safe, honest values when nothing is configured — never a fabricated address, mailbox or jurisdiction", () => {
    const config = getPlatformLegalConfig();

    expect(config.legalName).toBe("Umerenko Sergei");
    expect(config.operatorDescription).toBe("Umerenko Sergei, an individual, under the Aqenra brand");
    expect(config.brandDisclaimer).toBe("Aqenra is a product name, not a registered company.");
    expect(config.legalAddress).toBeNull();
    expect(config.supportEmail).toBeNull();
    expect(config.jurisdiction).toBe("the jurisdiction in which the Service operator is located");
    // Revised Privacy/Terms are dated by their publication, never backdated to the original August 9, 2026.
    expect(config.privacyEffectiveDate).toBe("October 30, 2026");
    expect(config.tosEffectiveDate).toBe("October 30, 2026");
    expect(config.cookiePolicyEffectiveDate).toBe("October 27, 2026");
  });

  it("prefers every explicitly configured env var over its fallback", () => {
    process.env.PLATFORM_LEGAL_NAME = "Acme Legal Co";
    process.env.PLATFORM_LEGAL_ADDRESS = "123 Main St, Springfield";
    process.env.PLATFORM_SUPPORT_EMAIL = "privacy@acme.example";
    process.env.PLATFORM_JURISDICTION = "the State of Delaware, USA";
    process.env.PRIVACY_POLICY_EFFECTIVE_DATE = "January 1, 2027";
    process.env.TOS_EFFECTIVE_DATE = "January 2, 2027";
    process.env.COOKIE_POLICY_EFFECTIVE_DATE = "January 3, 2027";

    const config = getPlatformLegalConfig();

    expect(config).toEqual({
      legalName: "Acme Legal Co",
      operatorDescription: "Acme Legal Co",
      brandDisclaimer: null,
      legalAddress: "123 Main St, Springfield",
      supportEmail: "privacy@acme.example",
      jurisdiction: "the State of Delaware, USA",
      privacyEffectiveDate: "January 1, 2027",
      tosEffectiveDate: "January 2, 2027",
      cookiePolicyEffectiveDate: "January 3, 2027",
    });
  });

  it("falls back the support email to the address portion of INVITATION_FROM_EMAIL when PLATFORM_SUPPORT_EMAIL is unset", () => {
    process.env.INVITATION_FROM_EMAIL = "Client Portal CRM <invites@example.com>";

    expect(getPlatformLegalConfig().supportEmail).toBe("invites@example.com");
  });

  it("treats a bare address INVITATION_FROM_EMAIL (no display name) the same way", () => {
    process.env.INVITATION_FROM_EMAIL = "invites@example.com";

    expect(getPlatformLegalConfig().supportEmail).toBe("invites@example.com");
  });

  it("never fabricates a support email from a malformed INVITATION_FROM_EMAIL", () => {
    process.env.INVITATION_FROM_EMAIL = "not-an-email";

    expect(getPlatformLegalConfig().supportEmail).toBeNull();
  });

  it("treats whitespace-only env values as unset", () => {
    process.env.PLATFORM_LEGAL_NAME = "   ";
    process.env.PLATFORM_LEGAL_ADDRESS = "  ";

    const config = getPlatformLegalConfig();

    expect(config.legalName).toBe("Umerenko Sergei");
    expect(config.legalAddress).toBeNull();
  });

  it("the operator is a code default, independent of PLATFORM_NAME (the brand): renaming the brand never renames the operator", () => {
    process.env.PLATFORM_NAME = "Acme Platform";

    const config = getPlatformLegalConfig();

    expect(config.legalName).toBe("Umerenko Sergei");
    expect(config.operatorDescription).toBe("Umerenko Sergei, an individual, under the Acme Platform brand");
    expect(config.brandDisclaimer).toBe("Acme Platform is a product name, not a registered company.");
  });

  it("PLATFORM_LEGAL_NAME still wins over PLATFORM_NAME when both are set — legal identity can differ from the marketing name", () => {
    process.env.PLATFORM_NAME = "Acme Platform";
    process.env.PLATFORM_LEGAL_NAME = "Acme Legal Entity LLC";

    expect(getPlatformLegalConfig().legalName).toBe("Acme Legal Entity LLC");
  });

  it("a configured PLATFORM_LEGAL_NAME is never described as an individual or as 'not a registered company' — nothing is claimed about its legal form", () => {
    process.env.PLATFORM_LEGAL_NAME = "Acme Legal Entity LLC";

    const config = getPlatformLegalConfig();

    expect(config.operatorDescription).toBe("Acme Legal Entity LLC");
    expect(config.brandDisclaimer).toBeNull();
  });
});

describe("getPlatformCopyrightLine", () => {
  it("distinguishes the brand from its operator", () => {
    expect(getPlatformCopyrightLine(2026)).toBe("© 2026 Aqenra · Operated by Umerenko Sergei");
  });

  it("collapses to the brand alone when the configured legal name equals the brand name", () => {
    process.env.PLATFORM_LEGAL_NAME = "Aqenra";

    expect(getPlatformCopyrightLine(2026)).toBe("© 2026 Aqenra");
  });

  it("uses a configured legal name as the operator", () => {
    process.env.PLATFORM_LEGAL_NAME = "Acme Legal Co";

    expect(getPlatformCopyrightLine(2027)).toBe("© 2027 Aqenra · Operated by Acme Legal Co");
  });
});
