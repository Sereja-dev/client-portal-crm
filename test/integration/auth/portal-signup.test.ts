import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { portalSignup } from "@/app/portal/signup/actions";
import { testEmail } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";
import { setMockVerifyOtpConfig, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

// Portal signup-confirmation defect fix. portalSignup() no longer calls
// supabase.auth.signUp() at all — its two network-bound dependencies
// (generateToken, sendConfirmationEmail) are injected directly via its
// own `deps` parameter, the same DI seam src/app/(auth)/signup/actions.ts's
// own signup() already uses. supabase.auth.verifyOtp() (only reached on
// the "already confirmed" immediate-session path) still goes through the
// shared, globally-mocked @/lib/supabase/server client
// (test/integration/setup-mocks.ts), configured per test via
// setMockVerifyOtpConfig(). portalSignup() never touches Prisma directly
// itself (no User/Organization/Membership/PortalUser row is ever created
// here) — every assertion below proves exactly that.

function portalSignupForm(fields: { email: string; password: string; confirmPassword?: string }): FormData {
  const formData = new FormData();
  formData.set("email", fields.email);
  formData.set("password", fields.password);
  formData.set("confirmPassword", fields.confirmPassword ?? fields.password);
  return formData;
}

describe("portalSignup — standalone Client Portal signup (signup-confirmation defect fix)", () => {
  afterEach(() => {
    resetAuthMock();
  });

  it("validates required fields before ever calling generateToken", async () => {
    const formData = new FormData();
    formData.set("email", testEmail("portal-signup-missing", TEST_EMAIL_DOMAIN));
    // password/confirmPassword intentionally omitted.

    const generateToken = vi.fn();
    const result = await portalSignup({ error: null }, formData, { generateToken });
    expect(result.error).toBe("All fields are required.");
    expect(generateToken).not.toHaveBeenCalled();
  });

  it("immediate session (confirm email disabled): establishes the session and redirects to /portal, creating no PortalUser/User/Organization/Membership row", async () => {
    const email = testEmail("portal-signup-immediate", TEST_EMAIL_DOMAIN);
    const userId = randomUUID();
    setMockVerifyOtpConfig({ kind: "success", user: { id: userId, email } });
    const generateToken = vi.fn().mockResolvedValue({ ok: true, tokenHash: "h", alreadyConfirmed: true });

    let caught: unknown;
    try {
      await portalSignup({ error: null }, portalSignupForm({ email, password: "correct-horse-battery-1" }), { generateToken });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RedirectSignal);
    expect((caught as RedirectSignal).url).toMatch(/^\/portal\?/);

    expect(generateToken).toHaveBeenCalledWith({ email, password: "correct-horse-battery-1" });
    // Never carries an organizationName-shaped param at all — Portal
    // signup has no organization concept.
    expect(generateToken.mock.calls[0][0]).not.toHaveProperty("organizationName");

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user).toBeNull();
    const portalUser = await prisma.portalUser.findUnique({ where: { id: userId } });
    expect(portalUser).toBeNull();
  });

  it("duplicate email handling: surfaces the token-generation error verbatim, creates no rows", async () => {
    const email = testEmail("portal-signup-duplicate", TEST_EMAIL_DOMAIN);
    const result = await portalSignup({ error: null }, portalSignupForm({ email, password: "correct-horse-battery-1" }), {
      generateToken: vi.fn().mockResolvedValue({ ok: false, error: "User already registered" }),
    });
    expect(result.error).toBe("User already registered");

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });

  it("email confirmation required: sends the Aqenra Portal confirmation email (never native Supabase) and returns the check-your-email message, creating no rows", async () => {
    const email = testEmail("portal-signup-pending", TEST_EMAIL_DOMAIN);
    const sendConfirmationEmail = vi.fn().mockResolvedValue({ delivered: true });

    const result = await portalSignup({ error: null }, portalSignupForm({ email, password: "correct-horse-battery-1" }), {
      generateToken: vi.fn().mockResolvedValue({ ok: true, tokenHash: "pending-hash", alreadyConfirmed: false }),
      sendConfirmationEmail,
    });

    expect(result.error).toBeNull();
    expect(result.message).toMatch(/check your email/i);
    expect(sendConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: email, confirmUrl: expect.stringContaining("token_hash=pending-hash") }),
    );
    expect(sendConfirmationEmail.mock.calls[0][0].confirmUrl).toContain("type=portal_signup");

    const user = await prisma.user.findFirst({ where: { email } });
    expect(user).toBeNull();
  });

  it("email delivery failure after token generation: returns a specific error, never a false success, and creates no rows", async () => {
    const email = testEmail("portal-signup-email-fails", TEST_EMAIL_DOMAIN);

    const result = await portalSignup({ error: null }, portalSignupForm({ email, password: "correct-horse-battery-1" }), {
      generateToken: vi.fn().mockResolvedValue({ ok: true, tokenHash: "undelivered-hash", alreadyConfirmed: false }),
      sendConfirmationEmail: vi.fn().mockResolvedValue({ delivered: false, reason: "provider_error" }),
    });

    expect(result.error).toBe(
      "Account could not be created because the confirmation email could not be sent. Please try again.",
    );
    expect(result.message).toBeUndefined();

    const user = await prisma.user.findFirst({ where: { email } });
    expect(user).toBeNull();
  });
});
