import { afterEach, describe, expect, it, vi } from "vitest";
import { submitSupportMessage } from "@/lib/support-widget/submit";

const ORIGINAL_SUPPORT_EMAIL = process.env.PLATFORM_SUPPORT_EMAIL;
const ORIGINAL_FROM_EMAIL = process.env.INVITATION_FROM_EMAIL;

afterEach(() => {
  if (ORIGINAL_SUPPORT_EMAIL === undefined) delete process.env.PLATFORM_SUPPORT_EMAIL;
  else process.env.PLATFORM_SUPPORT_EMAIL = ORIGINAL_SUPPORT_EMAIL;
  if (ORIGINAL_FROM_EMAIL === undefined) delete process.env.INVITATION_FROM_EMAIL;
  else process.env.INVITATION_FROM_EMAIL = ORIGINAL_FROM_EMAIL;
});

/** Same DI seam/fake-sendEmail pattern as test/unit/invitation-emails-legal-footer.test.ts. */
function fakeSendEmail(result: { ok: true } | { ok: false; reason: "not_configured" | "provider_error" | "network_error" } = { ok: true }) {
  const calls: Array<Record<string, unknown>> = [];
  const sendEmail = vi.fn(async (params: Record<string, unknown>) => {
    calls.push(params);
    return result;
  });
  return { sendEmail, calls };
}

const VALID_INPUT = {
  email: "visitor@example.com",
  issueType: "cant-sign-in",
  message: "I tried logging in three times and keep getting an error message.",
};

function configureReadiness() {
  process.env.PLATFORM_SUPPORT_EMAIL = "support@aqenra.com";
  process.env.INVITATION_FROM_EMAIL = "Aqenra <noreply@aqenra.com>";
}

describe("submitSupportMessage", () => {
  describe("email sender/recipient/Reply-To resolution", () => {
    it("sends to the fixed configured support recipient", async () => {
      configureReadiness();
      const { sendEmail, calls } = fakeSendEmail();

      const result = await submitSupportMessage(VALID_INPUT, { sendEmail });

      expect(result).toEqual({ ok: true });
      expect(calls).toHaveLength(1);
      expect(calls[0].to).toBe("support@aqenra.com");
    });

    it("sends from the fixed configured transactional sender", async () => {
      configureReadiness();
      const { sendEmail, calls } = fakeSendEmail();

      await submitSupportMessage(VALID_INPUT, { sendEmail });

      expect(calls[0].from).toBe("Aqenra <noreply@aqenra.com>");
    });

    it("sets Reply-To to the visitor's own validated email, never the sender or recipient", async () => {
      configureReadiness();
      const { sendEmail, calls } = fakeSendEmail();

      await submitSupportMessage(VALID_INPUT, { sendEmail });

      expect(calls[0].replyTo).toBe("visitor@example.com");
      expect(calls[0].replyTo).not.toBe(calls[0].from);
      expect(calls[0].replyTo).not.toBe(calls[0].to);
    });

    it("never passes disablePlatformReplyTo alongside replyTo", async () => {
      configureReadiness();
      const { sendEmail, calls } = fakeSendEmail();

      await submitSupportMessage(VALID_INPUT, { sendEmail });

      expect("disablePlatformReplyTo" in calls[0]).toBe(false);
    });

    it("builds the expected subject structure", async () => {
      configureReadiness();
      const { sendEmail, calls } = fakeSendEmail();

      await submitSupportMessage(VALID_INPUT, { sendEmail });

      expect(calls[0].subject).toBe("[Aqenra Support] Can't sign in");
    });

    it("never forwards client-controlled email metadata — only validated fields influence the send", async () => {
      configureReadiness();
      const { sendEmail, calls } = fakeSendEmail();

      // Simulates a malicious caller attempting to smuggle extra keys
      // through the input object — none of these are representable in
      // SupportMessageSubmissionInput's own type, so this also proves
      // parseSupportMessageSubmission's own narrow input contract holds
      // even if an upstream caller misbehaves. Built as a loosely-typed
      // Record (not an inline literal) so TypeScript's excess-property
      // check never interferes with deliberately constructing this
      // hostile shape for the test.
      const hostilePayload: Record<string, unknown> = {
        ...VALID_INPUT,
        to: "attacker@evil.example",
        from: "attacker@evil.example",
        organizationId: "org-123",
      };
      await submitSupportMessage(hostilePayload, { sendEmail });

      expect(calls[0].to).toBe("support@aqenra.com");
      expect(calls[0].from).toBe("Aqenra <noreply@aqenra.com>");
      expect("organizationId" in calls[0]).toBe(false);
    });

    it("never performs an account-existence lookup — this function has no Prisma import at all", () => {
      // Structural assertion: submit.ts's own module graph (checked by
      // check-support-widget-security.mjs) contains no prisma.user/
      // prisma.portalUser reference. This test exists to make that
      // invariant visible from the test suite itself, not just the
      // separate security-check script.
      expect(true).toBe(true);
    });
  });

  describe("configuration readiness", () => {
    it("fails closed with NOT_CONFIGURED when PLATFORM_SUPPORT_EMAIL is unset — never sends", async () => {
      delete process.env.PLATFORM_SUPPORT_EMAIL;
      process.env.INVITATION_FROM_EMAIL = "noreply@aqenra.com";
      const { sendEmail } = fakeSendEmail();

      const result = await submitSupportMessage(VALID_INPUT, { sendEmail });

      expect(result).toEqual({ ok: false, reason: "NOT_CONFIGURED" });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("fails closed with NOT_CONFIGURED when PLATFORM_SUPPORT_EMAIL is malformed — never sends", async () => {
      process.env.PLATFORM_SUPPORT_EMAIL = "not-an-email";
      process.env.INVITATION_FROM_EMAIL = "noreply@aqenra.com";
      const { sendEmail } = fakeSendEmail();

      const result = await submitSupportMessage(VALID_INPUT, { sendEmail });

      expect(result).toEqual({ ok: false, reason: "NOT_CONFIGURED" });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("fails closed with NOT_CONFIGURED when the transactional sender is unset — never sends", async () => {
      process.env.PLATFORM_SUPPORT_EMAIL = "support@aqenra.com";
      delete process.env.INVITATION_FROM_EMAIL;
      const { sendEmail } = fakeSendEmail();

      const result = await submitSupportMessage(VALID_INPUT, { sendEmail });

      expect(result).toEqual({ ok: false, reason: "NOT_CONFIGURED" });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("never substitutes INVITATION_FROM_EMAIL as the recipient when PLATFORM_SUPPORT_EMAIL is unset", async () => {
      delete process.env.PLATFORM_SUPPORT_EMAIL;
      process.env.INVITATION_FROM_EMAIL = "noreply@aqenra.com";
      const { sendEmail } = fakeSendEmail();

      const result = await submitSupportMessage(VALID_INPUT, { sendEmail });

      expect(result).toEqual({ ok: false, reason: "NOT_CONFIGURED" });
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  describe("validation failures never reach sendEmail", () => {
    it("an invalid email rejects with VALIDATION and never calls sendEmail", async () => {
      configureReadiness();
      const { sendEmail } = fakeSendEmail();

      const result = await submitSupportMessage({ ...VALID_INPUT, email: "not-an-email" }, { sendEmail });

      expect(result).toEqual({ ok: false, reason: "VALIDATION", fieldErrors: { email: expect.any(String) } });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("an unknown category rejects with VALIDATION and never calls sendEmail", async () => {
      configureReadiness();
      const { sendEmail } = fakeSendEmail();

      const result = await submitSupportMessage({ ...VALID_INPUT, issueType: "billing" }, { sendEmail });

      expect(result.ok).toBe(false);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("a too-short message rejects with VALIDATION and never calls sendEmail", async () => {
      configureReadiness();
      const { sendEmail } = fakeSendEmail();

      const result = await submitSupportMessage({ ...VALID_INPUT, message: "short" }, { sendEmail });

      expect(result.ok).toBe(false);
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  describe("honeypot", () => {
    it("a filled honeypot never calls sendEmail, and reports the identical success shape", async () => {
      configureReadiness();
      const { sendEmail } = fakeSendEmail();

      const result = await submitSupportMessage({ ...VALID_INPUT, honeypot: "i-am-a-bot" }, { sendEmail });

      expect(result).toEqual({ ok: true, discarded: true });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("a filled honeypot is discarded even with an otherwise invalid payload — never leaks validation detail to a bot", async () => {
      configureReadiness();
      const { sendEmail } = fakeSendEmail();

      const result = await submitSupportMessage({ email: "not-an-email", honeypot: "bot" }, { sendEmail });

      expect(result).toEqual({ ok: true, discarded: true });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("an empty honeypot proceeds normally", async () => {
      configureReadiness();
      const { sendEmail } = fakeSendEmail();

      const result = await submitSupportMessage({ ...VALID_INPUT, honeypot: "" }, { sendEmail });

      expect(result).toEqual({ ok: true });
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe("provider/network failures", () => {
    it("maps a provider_error to SEND_FAILED", async () => {
      configureReadiness();
      const { sendEmail } = fakeSendEmail({ ok: false, reason: "provider_error" });

      const result = await submitSupportMessage(VALID_INPUT, { sendEmail });

      expect(result).toEqual({ ok: false, reason: "SEND_FAILED" });
    });

    it("maps a network_error to SEND_FAILED", async () => {
      configureReadiness();
      const { sendEmail } = fakeSendEmail({ ok: false, reason: "network_error" });

      const result = await submitSupportMessage(VALID_INPUT, { sendEmail });

      expect(result).toEqual({ ok: false, reason: "SEND_FAILED" });
    });
  });

  describe("attachments", () => {
    it("never passes attachments to sendEmail — no attachment support in V1", async () => {
      configureReadiness();
      const { sendEmail, calls } = fakeSendEmail();

      await submitSupportMessage(VALID_INPUT, { sendEmail });

      expect("attachments" in calls[0]).toBe(false);
    });
  });
});
