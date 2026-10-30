import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendEmailViaResend = vi.hoisted(() => vi.fn());
const getCurrentMembership = vi.hoisted(() => vi.fn());
const findUniqueOrThrow = vi.hoisted(() => vi.fn());
const checkRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/email/resend-client", () => ({ sendEmailViaResend }));
vi.mock("@/lib/current-user", () => ({ getCurrentMembership }));
vi.mock("@/lib/prisma", () => ({ prisma: { organization: { findUniqueOrThrow } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "Test/9.9" }) }));
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkRateLimit };
});

import { submitBugReportAction, submitStaffSupportAction } from "@/lib/feedback-widget/actions";
import { resetSubmissionDedupeForTests } from "@/lib/feedback-widget/dedupe";

const KEYS = ["PLATFORM_SUPPORT_EMAIL", "PLATFORM_FEEDBACK_EMAIL", "INVITATION_FROM_EMAIL"] as const;
const saved: Record<string, string | undefined> = {};
const EMPTY = { error: null };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

const SUPPORT = { subject: "Invoice question", message: "I cannot find where to change my invoice numbering." };
const BUG = { title: "Save does nothing", description: "Clicking save does nothing.", steps: "Open a client and click Save.", route: "/clients/1", viewportWidth: "800", viewportHeight: "600" };

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
  }
  process.env.INVITATION_FROM_EMAIL = "Aqenra <no-reply@example.com>";
  process.env.PLATFORM_SUPPORT_EMAIL = "support@example.com";
  process.env.PLATFORM_FEEDBACK_EMAIL = "feedback@example.com";
  sendEmailViaResend.mockReset().mockResolvedValue({ ok: true });
  getCurrentMembership.mockReset().mockResolvedValue({
    user: { id: "user-1", name: "Jane", email: "jane@acme.example" },
    organizationId: "org-1",
    membership: { role: "ADMIN" },
  });
  findUniqueOrThrow.mockReset().mockResolvedValue({ id: "org-1", name: "Acme", slug: "acme" });
  checkRateLimit.mockReset().mockReturnValue({ limited: false });
  resetSubmissionDedupeForTests();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("identity comes from the session, never the form", () => {
  it("ignores spoofed organization, user, email and recipient fields", async () => {
    const result = await submitStaffSupportAction(
      EMPTY,
      form({ ...SUPPORT, organizationId: "org-B", userId: "user-B", email: "attacker@evil.example", to: "attacker@evil.example", replyTo: "attacker@evil.example" }),
    );
    expect(result).toEqual({ error: null, success: true, duplicate: false });
    expect(findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "org-1" } }));
    const sent = sendEmailViaResend.mock.calls[0][0];
    expect(sent.to).toBe("support@example.com");
    expect(sent.replyTo).toBe("jane@acme.example");
    expect(JSON.stringify(sent)).not.toMatch(/evil\.example|org-B|user-B/);
    expect(sent.text).toContain("Acme");
  });

  it("propagates the auth redirect for unauthenticated or portal users without sending anything", async () => {
    getCurrentMembership.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(submitStaffSupportAction(EMPTY, form(SUPPORT))).rejects.toThrow("NEXT_REDIRECT");
    await expect(submitBugReportAction(EMPTY, form(BUG))).rejects.toThrow("NEXT_REDIRECT");
    expect(sendEmailViaResend).not.toHaveBeenCalled();
  });
});

describe("rate limiting", () => {
  it("checks the per-user limit and then the per-organization limit, keyed by server-resolved ids", async () => {
    await submitBugReportAction(EMPTY, form(BUG));
    expect(checkRateLimit).toHaveBeenCalledTimes(2);
    expect(checkRateLimit.mock.calls[0][0].scope).toBe("staff-bug-report-submit");
    expect(checkRateLimit.mock.calls[0][1]).toBe("user-1");
    expect(checkRateLimit.mock.calls[1][0].scope).toBe("staff-feedback-organization");
    expect(checkRateLimit.mock.calls[1][1]).toBe("org-1");
  });

  it("returns the limiter's message and sends nothing when the user is limited", async () => {
    checkRateLimit.mockReturnValueOnce({ limited: true, message: "Too many. Try later." });
    expect(await submitStaffSupportAction(EMPTY, form(SUPPORT))).toEqual({ error: "Too many. Try later." });
    expect(sendEmailViaResend).not.toHaveBeenCalled();
  });

  it("returns the limiter's message when the whole workspace is limited", async () => {
    checkRateLimit.mockReturnValueOnce({ limited: false }).mockReturnValueOnce({ limited: true, message: "Workspace limit." });
    expect(await submitBugReportAction(EMPTY, form(BUG))).toEqual({ error: "Workspace limit." });
    expect(sendEmailViaResend).not.toHaveBeenCalled();
  });
});

describe("results and messages", () => {
  it("bug report: success routes to the bug address and carries the request's user agent", async () => {
    const result = await submitBugReportAction(EMPTY, form(BUG));
    expect(result).toEqual({ error: null, success: true, duplicate: false });
    const sent = sendEmailViaResend.mock.calls[0][0];
    expect(sent.to).toBe("feedback@example.com");
    expect(sent.text).toContain("Test/9.9");
  });

  it("bug report: unconfigured destination gives an honest message and does not fall back to support", async () => {
    delete process.env.PLATFORM_FEEDBACK_EMAIL;
    const result = await submitBugReportAction(EMPTY, form(BUG));
    expect(result.error).toMatch(/isn't available yet.*Support tab/);
    expect(sendEmailViaResend).not.toHaveBeenCalled();
  });

  it("returns field errors without sending for invalid input", async () => {
    const support = await submitStaffSupportAction(EMPTY, form({ subject: "", message: "" }));
    const bug = await submitBugReportAction(EMPTY, form({ title: "" }));
    expect(support.fieldErrors).toBeDefined();
    expect(bug.fieldErrors).toBeDefined();
    expect(sendEmailViaResend).not.toHaveBeenCalled();
  });

  it("provider failure surfaces a retryable error", async () => {
    sendEmailViaResend.mockResolvedValue({ ok: false, reason: "provider_error" });
    expect((await submitStaffSupportAction(EMPTY, form(SUPPORT))).error).toMatch(/couldn't send your message/);
    expect((await submitBugReportAction(EMPTY, form(BUG))).error).toMatch(/couldn't send your bug report/);
  });

  it("double submit of the same form id sends once and reports duplicate", async () => {
    const data = { ...SUPPORT, submissionId: "form-abcdefgh" };
    await submitStaffSupportAction(EMPTY, form(data));
    const second = await submitStaffSupportAction(EMPTY, form(data));
    expect(second).toEqual({ error: null, success: true, duplicate: true });
    expect(sendEmailViaResend).toHaveBeenCalledTimes(1);
  });
});
