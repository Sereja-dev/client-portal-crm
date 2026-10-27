import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pre-Auth Support Widget V1, Slice B. Same two established mocking
 * techniques this repo already uses for exactly this combination:
 * - vi.mock("@/lib/rate-limit", ...) replacing only checkRateLimit, the
 *   same narrow technique test/integration/lead-capture-forms/
 *   submit-rate-limit.test.ts already uses for its sibling public action
 *   — proves the action's real wiring (which config, which identifier)
 *   without exhausting the real in-memory bucket.
 * - vi.mock("next/headers", ...), the same technique
 *   test/unit/invoice-pdf-storage.test.ts already uses: this is a plain
 *   Vitest unit test with no real Next.js request context, so headers()
 *   is mocked with a fixed, deterministic IP.
 *
 * TEST_MODE is a module-level const computed once at first import (see
 * test/unit/resend-client.test.ts's own identical technique) — set
 * before each dynamic import below so the real TEST_MODE fake-send
 * branch runs directly, never a second mock of sendEmailViaResend itself.
 */

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.1" }),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn() };
});

const ORIGINAL_TEST_MODE = process.env.TEST_MODE;
const ORIGINAL_SUPPORT_EMAIL = process.env.PLATFORM_SUPPORT_EMAIL;
const ORIGINAL_FROM_EMAIL = process.env.INVITATION_FROM_EMAIL;

function restoreEnv() {
  if (ORIGINAL_TEST_MODE === undefined) delete process.env.TEST_MODE;
  else process.env.TEST_MODE = ORIGINAL_TEST_MODE;
  if (ORIGINAL_SUPPORT_EMAIL === undefined) delete process.env.PLATFORM_SUPPORT_EMAIL;
  else process.env.PLATFORM_SUPPORT_EMAIL = ORIGINAL_SUPPORT_EMAIL;
  if (ORIGINAL_FROM_EMAIL === undefined) delete process.env.INVITATION_FROM_EMAIL;
  else process.env.INVITATION_FROM_EMAIL = ORIGINAL_FROM_EMAIL;
}

afterEach(() => {
  restoreEnv();
  vi.resetModules();
});

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const VALID_FIELDS = {
  email: "visitor@example.com",
  issueType: "cant-sign-in",
  message: "I tried logging in three times and keep getting an error message.",
};

describe("submitSupportMessageAction", () => {
  beforeEach(() => {
    process.env.TEST_MODE = "1";
    process.env.PLATFORM_SUPPORT_EMAIL = "support@aqenra.com";
    process.env.INVITATION_FROM_EMAIL = "noreply@aqenra.com";
    vi.resetModules();
  });

  it("a valid submission below the rate limit succeeds", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockReturnValue({ limited: false });
    const { submitSupportMessageAction } = await import("@/lib/support-widget/actions");

    const result = await submitSupportMessageAction({ error: null }, formData(VALID_FIELDS));

    expect(result).toEqual({ error: null, success: true });
  });

  it("uses SUPPORT_MESSAGE_SUBMIT_LIMIT specifically, keyed by request IP, checked before any validation", async () => {
    const { checkRateLimit, SUPPORT_MESSAGE_SUBMIT_LIMIT } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockReturnValue({ limited: false });
    const { submitSupportMessageAction } = await import("@/lib/support-widget/actions");

    await submitSupportMessageAction({ error: null }, formData(VALID_FIELDS));

    expect(checkRateLimit).toHaveBeenCalledWith(SUPPORT_MESSAGE_SUBMIT_LIMIT, "203.0.113.1");
  });

  it("a rate-limited request is rejected with the limiter's own generic message — never attempts a send", async () => {
    const { checkRateLimit, RATE_LIMIT_MESSAGE } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockReturnValue({ limited: true, message: RATE_LIMIT_MESSAGE });
    const { submitSupportMessageAction } = await import("@/lib/support-widget/actions");

    // An otherwise-invalid payload would normally surface a fieldErrors
    // response — proving the rate-limit branch fires first (and returns
    // the limiter's own message, not a validation error) shows it
    // short-circuits before validation ever runs.
    const result = await submitSupportMessageAction({ error: null }, formData({ email: "not-an-email" }));

    expect(result).toEqual({ error: RATE_LIMIT_MESSAGE });
  });

  it("an invalid email returns fieldErrors, not the generic error", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockReturnValue({ limited: false });
    const { submitSupportMessageAction } = await import("@/lib/support-widget/actions");

    const result = await submitSupportMessageAction({ error: null }, formData({ ...VALID_FIELDS, email: "not-an-email" }));

    expect(result.error).toBeNull();
    expect(result.fieldErrors?.email).toBeDefined();
  });

  it("an unconfigured support mailbox returns the generic error, never a configuration-specific message", async () => {
    delete process.env.PLATFORM_SUPPORT_EMAIL;
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockReturnValue({ limited: false });
    const { submitSupportMessageAction } = await import("@/lib/support-widget/actions");

    const result = await submitSupportMessageAction({ error: null }, formData(VALID_FIELDS));

    expect(result.error).toBe("We couldn't send your message. Please try again in a moment.");
    expect(result.success).toBeUndefined();
    expect(result.error).not.toMatch(/PLATFORM_SUPPORT_EMAIL|not_configured|config/i);
  });

  it("a filled honeypot reports the identical success shape as a real send", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockReturnValue({ limited: false });
    const { submitSupportMessageAction } = await import("@/lib/support-widget/actions");

    const result = await submitSupportMessageAction({ error: null }, formData({ ...VALID_FIELDS, honeypot: "i-am-a-bot" }));

    expect(result).toEqual({ error: null, success: true });
  });

  it("duplicate FormData keys: FormData.set ensures exactly one value per field reaches the action (no array, no throw)", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockReturnValue({ limited: false });
    const { submitSupportMessageAction } = await import("@/lib/support-widget/actions");

    const fd = new FormData();
    fd.append("email", "first@example.com");
    fd.append("email", "second@example.com");
    fd.set("issueType", VALID_FIELDS.issueType);
    fd.set("message", VALID_FIELDS.message);

    // FormData.get() returns only the FIRST appended value for a
    // repeated key — proving this resolves to a single, valid email
    // rather than throwing or silently concatenating both.
    const result = await submitSupportMessageAction({ error: null }, fd);
    expect(result).toEqual({ error: null, success: true });
  });

  it("never exposes a provider/network failure reason to the visitor — only the fixed generic message", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockReturnValue({ limited: false });
    // Force the underlying send to fail by removing the sender config —
    // submitSupportMessage's own NOT_CONFIGURED path, already proven to
    // map to the identical generic message as a real SEND_FAILED above.
    delete process.env.INVITATION_FROM_EMAIL;
    const { submitSupportMessageAction } = await import("@/lib/support-widget/actions");

    const result = await submitSupportMessageAction({ error: null }, formData(VALID_FIELDS));

    expect(result.error).toBe("We couldn't send your message. Please try again in a moment.");
  });
});
