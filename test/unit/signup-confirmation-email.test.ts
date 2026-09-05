import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSignupConfirmationEmailContent, sendSignupConfirmationEmail } from "@/lib/email/signup-confirmation";

const CONFIRM_URL = "https://app.aqenra.com/auth/confirm?token_hash=abc123&type=signup&next=%2Fdashboard";

describe("buildSignupConfirmationEmailContent", () => {
  it("subject is Aqenra-branded, never mentions Supabase", () => {
    const content = buildSignupConfirmationEmailContent({ confirmUrl: CONFIRM_URL, isInvited: false });
    expect(content.subject).toBe("Confirm your Aqenra account");
    expect(content.html).not.toContain("Supabase");
    expect(content.text).not.toContain("Supabase");
  });

  it("standalone signup: does not mention returning to an invitation", () => {
    const content = buildSignupConfirmationEmailContent({ confirmUrl: CONFIRM_URL, isInvited: false });
    expect(content.html).not.toContain("your invitation");
    expect(content.text).not.toContain("your invitation");
  });

  it("invited signup: mentions returning to the invitation after confirming", () => {
    const content = buildSignupConfirmationEmailContent({ confirmUrl: CONFIRM_URL, isInvited: true });
    expect(content.html).toContain("return to your invitation");
    expect(content.text).toContain("return to your invitation");
  });

  it("includes the confirm URL in the text body verbatim, and in the html body HTML-escaped", () => {
    const content = buildSignupConfirmationEmailContent({ confirmUrl: CONFIRM_URL, isInvited: false });
    expect(content.text).toContain(CONFIRM_URL);
    expect(content.html).toContain(CONFIRM_URL.replace(/&/g, "&amp;"));
  });

  it("escapes HTML-significant characters in the URL within the html body", () => {
    const maliciousUrl = 'https://app.aqenra.com/auth/confirm?token_hash=<script>&type="signup"';
    const content = buildSignupConfirmationEmailContent({ confirmUrl: maliciousUrl, isInvited: false });
    expect(content.html).not.toContain("<script>");
    expect(content.html).toContain("&lt;script&gt;");
  });

  it("reassures a recipient who didn't try to sign up that nothing happens if ignored", () => {
    const content = buildSignupConfirmationEmailContent({ confirmUrl: CONFIRM_URL, isInvited: false });
    expect(content.html).toContain("safely ignore");
    expect(content.text).toContain("safely ignore");
  });

  it("includes the shared legal footer (Privacy Policy / Terms of Service links) in both bodies", () => {
    const content = buildSignupConfirmationEmailContent({ confirmUrl: CONFIRM_URL, isInvited: false });
    expect(content.html).toContain("/privacy");
    expect(content.html).toContain("/terms");
    expect(content.text).toContain("Privacy Policy:");
    expect(content.text).toContain("Terms of Service:");
  });

  it("has a clear call-to-action link in the html body", () => {
    const content = buildSignupConfirmationEmailContent({ confirmUrl: CONFIRM_URL, isInvited: false });
    expect(content.html).toContain("Confirm your account");
  });
});

describe("sendSignupConfirmationEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("resolves not_configured, and never calls the injected sender, when INVITATION_FROM_EMAIL is unset", async () => {
    vi.stubEnv("INVITATION_FROM_EMAIL", "");
    const sendEmail = vi.fn();

    const result = await sendSignupConfirmationEmail(
      { to: "member@example.com", confirmUrl: CONFIRM_URL, isInvited: false },
      { sendEmail },
    );

    expect(result).toEqual({ delivered: false, reason: "not_configured" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends via the injected sendEmail with the Aqenra-branded subject/body, and reports delivered: true", async () => {
    vi.stubEnv("INVITATION_FROM_EMAIL", "Aqenra <no-reply@aqenra.com>");
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    const result = await sendSignupConfirmationEmail(
      { to: "member@example.com", confirmUrl: CONFIRM_URL, isInvited: true },
      { sendEmail },
    );

    expect(result).toEqual({ delivered: true });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "member@example.com",
        from: "Aqenra <no-reply@aqenra.com>",
        subject: "Confirm your Aqenra account",
      }),
    );
  });

  it("on provider failure, logs only a coarse, non-PII warning — never the recipient email, URL, or token", async () => {
    vi.stubEnv("INVITATION_FROM_EMAIL", "Aqenra <no-reply@aqenra.com>");
    const sendEmail = vi.fn().mockResolvedValue({ ok: false, reason: "provider_error" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await sendSignupConfirmationEmail(
      { to: "member@example.com", confirmUrl: CONFIRM_URL, isInvited: false },
      { sendEmail },
    );

    expect(result).toEqual({ delivered: false, reason: "provider_error" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message, metadata] = warnSpy.mock.calls[0];
    expect(message).toBe("[email] signup confirmation send failed");
    expect(metadata).toEqual({ flow: "signup_confirmation", reason: "provider_error" });
    const loggedText = JSON.stringify(warnSpy.mock.calls[0]);
    expect(loggedText).not.toContain("member@example.com");
    expect(loggedText).not.toContain(CONFIRM_URL);
    expect(loggedText).not.toContain("abc123");
  });
});
