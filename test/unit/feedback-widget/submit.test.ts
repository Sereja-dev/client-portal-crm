import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SendEmailFn, SendEmailInput } from "@/lib/email/resend-client";
import { submitBugReport, submitStaffSupport, type StaffFeedbackIdentity } from "@/lib/feedback-widget/submit";
import { resetSubmissionDedupeForTests } from "@/lib/feedback-widget/dedupe";

const KEYS = ["PLATFORM_SUPPORT_EMAIL", "PLATFORM_FEEDBACK_EMAIL", "INVITATION_FROM_EMAIL"] as const;
const saved: Record<string, string | undefined> = {};

const IDENTITY: StaffFeedbackIdentity = {
  userId: "user-1",
  sender: { name: "Jane", email: "jane@acme.example", role: "ADMIN" },
  workspace: { id: "org-1", name: "Acme", slug: "acme" },
};

const SUPPORT = { subject: "Invoice question", message: "I cannot find where to change my invoice numbering." };
const BUG = { title: "Save does nothing", description: "Clicking save does nothing.", steps: "Open a client and click Save.", route: "/clients/1", viewportWidth: "800", viewportHeight: "600" };

function okSender() {
  return vi.fn<SendEmailFn>(async () => ({ ok: true }));
}
const sent = (fn: ReturnType<typeof okSender>): SendEmailInput => fn.mock.calls[0][0];

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.INVITATION_FROM_EMAIL = "Aqenra <no-reply@example.com>";
  process.env.PLATFORM_SUPPORT_EMAIL = "support@example.com";
  process.env.PLATFORM_FEEDBACK_EMAIL = "feedback@example.com";
  resetSubmissionDedupeForTests();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("independent routing", () => {
  it("sends support messages to the support recipient only", async () => {
    const sendEmail = okSender();
    const result = await submitStaffSupport(SUPPORT, IDENTITY, { sendEmail });
    expect(result).toEqual({ ok: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sent(sendEmail).to).toBe("support@example.com");
    expect(sent(sendEmail).subject).toMatch(/^\[Aqenra Support · Staff\]/);
  });

  it("sends bug reports to the dedicated bug-report recipient only", async () => {
    const sendEmail = okSender();
    const result = await submitBugReport(BUG, IDENTITY, { userAgent: "UA" }, { sendEmail });
    expect(result).toEqual({ ok: true });
    expect(sent(sendEmail).to).toBe("feedback@example.com");
    expect(sent(sendEmail).subject).toMatch(/^\[Aqenra Bug\]/);
  });

  it("never lets the recipient, sender or reply-to be influenced by the submitted fields", async () => {
    const sendEmail = okSender();
    const hostile = { ...SUPPORT, to: "attacker@evil.example", from: "ceo@acme.example", replyTo: "attacker@evil.example", email: "attacker@evil.example" } as typeof SUPPORT;
    await submitStaffSupport(hostile, IDENTITY, { sendEmail });
    const call = sent(sendEmail);
    expect(call.to).toBe("support@example.com");
    expect(call.from).toBe("Aqenra <no-reply@example.com>");
    expect(call.replyTo).toBe("jane@acme.example");
    expect(JSON.stringify(call)).not.toContain("evil.example");
  });

  it("replies go to the signed-in account's own email in both paths, and no attachments are ever sent", async () => {
    const support = okSender();
    const bug = okSender();
    await submitStaffSupport(SUPPORT, IDENTITY, { sendEmail: support });
    await submitBugReport(BUG, IDENTITY, { userAgent: "UA" }, { sendEmail: bug });
    expect(sent(support).replyTo).toBe("jane@acme.example");
    expect(sent(bug).replyTo).toBe("jane@acme.example");
    expect("attachments" in sent(support)).toBe(false);
    expect("attachments" in sent(bug)).toBe(false);
  });
});

describe("missing destination configuration fails safely", () => {
  it("bug report with no PLATFORM_FEEDBACK_EMAIL is NOT_CONFIGURED and sends nothing — even though the support recipient is configured", async () => {
    delete process.env.PLATFORM_FEEDBACK_EMAIL;
    const sendEmail = okSender();
    expect(await submitBugReport(BUG, IDENTITY, { userAgent: "UA" }, { sendEmail })).toEqual({ ok: false, reason: "NOT_CONFIGURED" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("bug report with a malformed destination is NOT_CONFIGURED", async () => {
    process.env.PLATFORM_FEEDBACK_EMAIL = "not an address";
    const sendEmail = okSender();
    expect(await submitBugReport(BUG, IDENTITY, { userAgent: "UA" }, { sendEmail })).toEqual({ ok: false, reason: "NOT_CONFIGURED" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("support message with no PLATFORM_SUPPORT_EMAIL is NOT_CONFIGURED and never falls back to the bug address or the sender address", async () => {
    delete process.env.PLATFORM_SUPPORT_EMAIL;
    const sendEmail = okSender();
    expect(await submitStaffSupport(SUPPORT, IDENTITY, { sendEmail })).toEqual({ ok: false, reason: "NOT_CONFIGURED" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("with no sender configured (INVITATION_FROM_EMAIL) neither path sends", async () => {
    delete process.env.INVITATION_FROM_EMAIL;
    const sendEmail = okSender();
    expect(await submitStaffSupport(SUPPORT, IDENTITY, { sendEmail })).toEqual({ ok: false, reason: "NOT_CONFIGURED" });
    expect(await submitBugReport(BUG, IDENTITY, { userAgent: "UA" }, { sendEmail })).toEqual({ ok: false, reason: "NOT_CONFIGURED" });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("validation, honeypot and failures", () => {
  it("returns field errors and sends nothing for invalid input", async () => {
    const sendEmail = okSender();
    const support = await submitStaffSupport({ subject: "", message: "" }, IDENTITY, { sendEmail });
    const bug = await submitBugReport({ title: "", description: "", steps: "" }, IDENTITY, { userAgent: "UA" }, { sendEmail });
    expect(support).toMatchObject({ ok: false, reason: "VALIDATION" });
    expect(bug).toMatchObject({ ok: false, reason: "VALIDATION" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("a filled honeypot looks like success but sends nothing", async () => {
    const sendEmail = okSender();
    expect(await submitStaffSupport({ ...SUPPORT, honeypot: "bot" }, IDENTITY, { sendEmail })).toEqual({ ok: true, discarded: true });
    expect(await submitBugReport({ ...BUG, honeypot: "bot" }, IDENTITY, { userAgent: "UA" }, { sendEmail })).toEqual({ ok: true, discarded: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("a provider failure is SEND_FAILED and does not block a genuine retry", async () => {
    const failing = vi.fn<SendEmailFn>(async () => ({ ok: false, reason: "provider_error" }));
    expect(await submitBugReport({ ...BUG, submissionId: "retry-form-1" }, IDENTITY, { userAgent: "UA" }, { sendEmail: failing })).toEqual({ ok: false, reason: "SEND_FAILED" });
    const working = okSender();
    expect(await submitBugReport({ ...BUG, submissionId: "retry-form-1" }, IDENTITY, { userAgent: "UA" }, { sendEmail: working })).toEqual({ ok: true });
    expect(working).toHaveBeenCalledTimes(1);
  });
});

describe("duplicate submission prevention", () => {
  it("sends the same form once even when submitted twice (double click)", async () => {
    const sendEmail = okSender();
    const input = { ...SUPPORT, submissionId: "double-click-1" };
    expect(await submitStaffSupport(input, IDENTITY, { sendEmail })).toEqual({ ok: true });
    expect(await submitStaffSupport(input, IDENTITY, { sendEmail })).toEqual({ ok: true, duplicate: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("sends identical bug content once even from a different form instance", async () => {
    const sendEmail = okSender();
    expect(await submitBugReport({ ...BUG, submissionId: "tab-aaaaaaa" }, IDENTITY, { userAgent: "UA" }, { sendEmail })).toEqual({ ok: true });
    expect(await submitBugReport({ ...BUG, submissionId: "tab-bbbbbbb" }, IDENTITY, { userAgent: "UA" }, { sendEmail })).toEqual({ ok: true, duplicate: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not suppress a different user's identical report, nor a different report from the same user", async () => {
    const sendEmail = okSender();
    await submitBugReport(BUG, IDENTITY, { userAgent: "UA" }, { sendEmail });
    await submitBugReport(BUG, { ...IDENTITY, userId: "user-2" }, { userAgent: "UA" }, { sendEmail });
    await submitBugReport({ ...BUG, title: "A different problem" }, IDENTITY, { userAgent: "UA" }, { sendEmail });
    expect(sendEmail).toHaveBeenCalledTimes(3);
  });
});

describe("diagnostics in the sent bug report", () => {
  it("uses the server clock, the sanitised path, and only the allowed context", async () => {
    const sendEmail = okSender();
    await submitBugReport(
      { ...BUG, route: "/clients/1?q=secret+search#frag" },
      IDENTITY,
      { userAgent: "Mozilla/5.0 TestAgent" },
      { sendEmail, now: () => new Date("2026-11-02T12:34:56.000Z") },
    );
    const text = sent(sendEmail).text ?? "";
    expect(text).toContain("Page: /clients/1");
    expect(text).not.toContain("secret");
    expect(text).toContain("2026-11-02T12:34:56.000Z");
    expect(text).toContain("Mozilla/5.0 TestAgent");
    expect(text).toContain("800 × 600");
  });
});
