import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEYS = ["PLATFORM_BUG_REPORT_EMAIL", "PLATFORM_SUPPORT_EMAIL", "PLATFORM_REPLY_TO_EMAIL", "INVITATION_FROM_EMAIL", "RESEND_API_KEY", "TEST_MODE"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

async function load() {
  return import("@/lib/feedback-widget/config");
}

describe("resolveBugReportRecipient", () => {
  it("is null when PLATFORM_BUG_REPORT_EMAIL is unset — and never falls back to the support, reply-to or sender address", async () => {
    process.env.PLATFORM_SUPPORT_EMAIL = "support@example.com";
    process.env.PLATFORM_REPLY_TO_EMAIL = "reply@example.com";
    process.env.INVITATION_FROM_EMAIL = "Aqenra <no-reply@example.com>";
    const { resolveBugReportRecipient } = await load();
    expect(resolveBugReportRecipient()).toBeNull();
  });

  it("returns the configured address, trimmed", async () => {
    process.env.PLATFORM_BUG_REPORT_EMAIL = "  bugs@example.com  ";
    const { resolveBugReportRecipient } = await load();
    expect(resolveBugReportRecipient()).toBe("bugs@example.com");
  });

  it.each(["not-an-email", "a@b", "two@example.com,three@example.com", "Bugs <bugs@example.com>", "bug s@example.com", "", "   "])(
    "treats %j as not configured (never guesses)",
    async (value) => {
      process.env.PLATFORM_BUG_REPORT_EMAIL = value;
      const { resolveBugReportRecipient } = await load();
      expect(resolveBugReportRecipient()).toBeNull();
    },
  );

  it("rejects an over-long address", async () => {
    process.env.PLATFORM_BUG_REPORT_EMAIL = `${"a".repeat(250)}@example.com`;
    const { resolveBugReportRecipient } = await load();
    expect(resolveBugReportRecipient()).toBeNull();
  });
});

describe("readiness is evaluated independently per tab", () => {
  function provider() {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.INVITATION_FROM_EMAIL = "Aqenra <no-reply@example.com>";
  }

  it("support is ready with only the support destination; bug reporting is then not configured", async () => {
    provider();
    process.env.PLATFORM_SUPPORT_EMAIL = "support@example.com";
    const { checkStaffSupportReadiness, checkBugReportReadiness } = await load();
    expect(checkStaffSupportReadiness()).toBe("ready");
    expect(checkBugReportReadiness()).toBe("not_configured");
  });

  it("bug reporting is ready with only the bug destination; support is then not configured", async () => {
    provider();
    process.env.PLATFORM_BUG_REPORT_EMAIL = "bugs@example.com";
    const { checkStaffSupportReadiness, checkBugReportReadiness } = await load();
    expect(checkBugReportReadiness()).toBe("ready");
    expect(checkStaffSupportReadiness()).toBe("not_configured");
  });

  it("neither is ready without the email provider, even when both destinations are set", async () => {
    process.env.PLATFORM_SUPPORT_EMAIL = "support@example.com";
    process.env.PLATFORM_BUG_REPORT_EMAIL = "bugs@example.com";
    const { checkStaffSupportReadiness, checkBugReportReadiness } = await load();
    expect(checkStaffSupportReadiness()).toBe("not_configured");
    expect(checkBugReportReadiness()).toBe("not_configured");
  });
});
