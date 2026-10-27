import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_TEST_MODE = process.env.TEST_MODE;
const ORIGINAL_SUPPORT_EMAIL = process.env.PLATFORM_SUPPORT_EMAIL;
const ORIGINAL_API_KEY = process.env.RESEND_API_KEY;
const ORIGINAL_FROM_EMAIL = process.env.INVITATION_FROM_EMAIL;

function restoreEnv() {
  if (ORIGINAL_TEST_MODE === undefined) delete process.env.TEST_MODE;
  else process.env.TEST_MODE = ORIGINAL_TEST_MODE;
  if (ORIGINAL_SUPPORT_EMAIL === undefined) delete process.env.PLATFORM_SUPPORT_EMAIL;
  else process.env.PLATFORM_SUPPORT_EMAIL = ORIGINAL_SUPPORT_EMAIL;
  if (ORIGINAL_API_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_API_KEY;
  if (ORIGINAL_FROM_EMAIL === undefined) delete process.env.INVITATION_FROM_EMAIL;
  else process.env.INVITATION_FROM_EMAIL = ORIGINAL_FROM_EMAIL;
}

afterEach(() => {
  restoreEnv();
  vi.resetModules();
});

describe("resolveSupportRecipient", () => {
  beforeEach(() => {
    delete process.env.PLATFORM_SUPPORT_EMAIL;
    delete process.env.INVITATION_FROM_EMAIL;
    vi.resetModules();
  });

  it("returns null when PLATFORM_SUPPORT_EMAIL is unset", async () => {
    const { resolveSupportRecipient } = await import("@/lib/support-widget/config");
    expect(resolveSupportRecipient()).toBeNull();
  });

  it("returns null when PLATFORM_SUPPORT_EMAIL is whitespace-only", async () => {
    process.env.PLATFORM_SUPPORT_EMAIL = "   ";
    const { resolveSupportRecipient } = await import("@/lib/support-widget/config");
    expect(resolveSupportRecipient()).toBeNull();
  });

  it("returns the configured address when valid", async () => {
    process.env.PLATFORM_SUPPORT_EMAIL = "support@aqenra.com";
    const { resolveSupportRecipient } = await import("@/lib/support-widget/config");
    expect(resolveSupportRecipient()).toBe("support@aqenra.com");
  });

  it("returns null for a malformed configured address, never a guessed correction", async () => {
    process.env.PLATFORM_SUPPORT_EMAIL = "not-an-email";
    const { resolveSupportRecipient } = await import("@/lib/support-widget/config");
    expect(resolveSupportRecipient()).toBeNull();
  });

  it("returns null for an overlong configured address", async () => {
    process.env.PLATFORM_SUPPORT_EMAIL = `${"a".repeat(260)}@example.com`;
    const { resolveSupportRecipient } = await import("@/lib/support-widget/config");
    expect(resolveSupportRecipient()).toBeNull();
  });

  it("NEVER falls back to INVITATION_FROM_EMAIL when PLATFORM_SUPPORT_EMAIL is unset", async () => {
    process.env.INVITATION_FROM_EMAIL = "billing@example.com";
    delete process.env.PLATFORM_SUPPORT_EMAIL;
    const { resolveSupportRecipient } = await import("@/lib/support-widget/config");
    expect(resolveSupportRecipient()).toBeNull();
  });

  it("ignores INVITATION_FROM_EMAIL entirely even when both are set — never conflates the two", async () => {
    process.env.INVITATION_FROM_EMAIL = "billing@example.com";
    process.env.PLATFORM_SUPPORT_EMAIL = "support@aqenra.com";
    const { resolveSupportRecipient } = await import("@/lib/support-widget/config");
    expect(resolveSupportRecipient()).toBe("support@aqenra.com");
  });
});

describe("checkSupportSubmissionReadiness", () => {
  beforeEach(() => {
    delete process.env.TEST_MODE;
    delete process.env.PLATFORM_SUPPORT_EMAIL;
    delete process.env.RESEND_API_KEY;
    delete process.env.INVITATION_FROM_EMAIL;
    vi.resetModules();
  });

  it("is 'ready' only when the email provider AND the support recipient are both configured", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.INVITATION_FROM_EMAIL = "billing@example.com";
    process.env.PLATFORM_SUPPORT_EMAIL = "support@aqenra.com";
    const { checkSupportSubmissionReadiness } = await import("@/lib/support-widget/config");
    expect(checkSupportSubmissionReadiness()).toBe("ready");
  });

  it("is 'not_configured' when the email provider is ready but PLATFORM_SUPPORT_EMAIL is unset", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.INVITATION_FROM_EMAIL = "billing@example.com";
    delete process.env.PLATFORM_SUPPORT_EMAIL;
    const { checkSupportSubmissionReadiness } = await import("@/lib/support-widget/config");
    expect(checkSupportSubmissionReadiness()).toBe("not_configured");
  });

  it("is 'not_configured' when PLATFORM_SUPPORT_EMAIL is set but the email provider itself is not", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.PLATFORM_SUPPORT_EMAIL = "support@aqenra.com";
    const { checkSupportSubmissionReadiness } = await import("@/lib/support-widget/config");
    expect(checkSupportSubmissionReadiness()).toBe("not_configured");
  });

  it("under TEST_MODE, the email-provider side is 'ready' automatically, but PLATFORM_SUPPORT_EMAIL is still required", async () => {
    process.env.TEST_MODE = "1";
    delete process.env.PLATFORM_SUPPORT_EMAIL;
    const { checkSupportSubmissionReadiness } = await import("@/lib/support-widget/config");
    expect(checkSupportSubmissionReadiness()).toBe("not_configured");
  });

  it("under TEST_MODE with PLATFORM_SUPPORT_EMAIL explicitly set, reports 'ready'", async () => {
    process.env.TEST_MODE = "1";
    process.env.PLATFORM_SUPPORT_EMAIL = "support@aqenra.com";
    const { checkSupportSubmissionReadiness } = await import("@/lib/support-widget/config");
    expect(checkSupportSubmissionReadiness()).toBe("ready");
  });
});
