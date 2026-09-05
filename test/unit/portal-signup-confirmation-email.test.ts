import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPortalSignupConfirmationEmailContent,
  sendPortalSignupConfirmationEmail,
} from "@/lib/email/portal-signup-confirmation";

const CONFIRM_URL = "https://app.aqenra.com/auth/confirm?token_hash=abc123&type=portal_signup&next=%2Fportal";

describe("buildPortalSignupConfirmationEmailContent", () => {
  it("subject is Aqenra Client Portal branded, never mentions Supabase", () => {
    const content = buildPortalSignupConfirmationEmailContent({ confirmUrl: CONFIRM_URL });
    expect(content.subject).toBe("Confirm your Aqenra Client Portal account");
    expect(content.html).not.toContain("Supabase");
    expect(content.text).not.toContain("Supabase");
  });

  it("includes the confirm URL in the text body verbatim, and in the html body HTML-escaped", () => {
    const content = buildPortalSignupConfirmationEmailContent({ confirmUrl: CONFIRM_URL });
    expect(content.text).toContain(CONFIRM_URL);
    expect(content.html).toContain(CONFIRM_URL.replace(/&/g, "&amp;"));
  });

  it("escapes HTML-significant characters in the URL within the html body", () => {
    const maliciousUrl = 'https://app.aqenra.com/auth/confirm?token_hash=<script>&type="portal_signup"';
    const content = buildPortalSignupConfirmationEmailContent({ confirmUrl: maliciousUrl });
    expect(content.html).not.toContain("<script>");
    expect(content.html).toContain("&lt;script&gt;");
  });

  it("reassures a recipient who didn't try to sign up that nothing happens if ignored", () => {
    const content = buildPortalSignupConfirmationEmailContent({ confirmUrl: CONFIRM_URL });
    expect(content.html).toContain("safely ignore");
    expect(content.text).toContain("safely ignore");
  });

  it("includes the shared legal footer (Privacy Policy / Terms of Service links) in both bodies", () => {
    const content = buildPortalSignupConfirmationEmailContent({ confirmUrl: CONFIRM_URL });
    expect(content.html).toContain("/privacy");
    expect(content.html).toContain("/terms");
    expect(content.text).toContain("Privacy Policy:");
    expect(content.text).toContain("Terms of Service:");
  });

  it("has a clear call-to-action link in the html body", () => {
    const content = buildPortalSignupConfirmationEmailContent({ confirmUrl: CONFIRM_URL });
    expect(content.html).toContain("Confirm your account");
  });
});

describe("sendPortalSignupConfirmationEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("resolves not_configured, and never calls the injected sender, when INVITATION_FROM_EMAIL is unset", async () => {
    vi.stubEnv("INVITATION_FROM_EMAIL", "");
    const sendEmail = vi.fn();

    const result = await sendPortalSignupConfirmationEmail({ to: "client@example.com", confirmUrl: CONFIRM_URL }, { sendEmail });

    expect(result).toEqual({ delivered: false, reason: "not_configured" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends via the injected sendEmail with the Aqenra-branded subject/body, and reports delivered: true", async () => {
    vi.stubEnv("INVITATION_FROM_EMAIL", "Aqenra <no-reply@aqenra.com>");
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    const result = await sendPortalSignupConfirmationEmail({ to: "client@example.com", confirmUrl: CONFIRM_URL }, { sendEmail });

    expect(result).toEqual({ delivered: true });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "client@example.com",
        from: "Aqenra <no-reply@aqenra.com>",
        subject: "Confirm your Aqenra Client Portal account",
      }),
    );
  });

  it("on provider failure, logs only a coarse, non-PII warning — never the recipient email, URL, or token", async () => {
    vi.stubEnv("INVITATION_FROM_EMAIL", "Aqenra <no-reply@aqenra.com>");
    const sendEmail = vi.fn().mockResolvedValue({ ok: false, reason: "provider_error" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await sendPortalSignupConfirmationEmail({ to: "client@example.com", confirmUrl: CONFIRM_URL }, { sendEmail });

    expect(result).toEqual({ delivered: false, reason: "provider_error" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message, metadata] = warnSpy.mock.calls[0];
    expect(message).toBe("[email] portal signup confirmation send failed");
    expect(metadata).toEqual({ flow: "portal_signup_confirmation", reason: "provider_error" });
    const loggedText = JSON.stringify(warnSpy.mock.calls[0]);
    expect(loggedText).not.toContain("client@example.com");
    expect(loggedText).not.toContain(CONFIRM_URL);
    expect(loggedText).not.toContain("abc123");
  });
});
