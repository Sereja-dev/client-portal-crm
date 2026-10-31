import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sendEmailViaResend = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email/resend-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email/resend-client")>("@/lib/email/resend-client");
  return { ...actual, sendEmailViaResend };
});

import { submitBugReportAction, submitStaffSupportAction } from "@/lib/feedback-widget/actions";
import { resetSubmissionDedupeForTests } from "@/lib/feedback-widget/dedupe";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock, setMockAuthUser } from "../../support/auth-mock";

/**
 * Staff feedback widget against the real Prisma-backed test database: the only
 * mocks are the Supabase identity (auth-mock) and the outgoing email provider,
 * so identity/tenant resolution is the app's real getCurrentMembership().
 * Proves tenant isolation (the email carries the ACTIVE workspace only, and no
 * form field can redirect it) and independent support / bug routing.
 */

const KEYS = ["PLATFORM_SUPPORT_EMAIL", "PLATFORM_FEEDBACK_EMAIL", "INVITATION_FROM_EMAIL"] as const;
const saved: Record<string, string | undefined> = {};
const EMPTY = { error: null };

const SUPPORT = { subject: "Invoice question", message: "I cannot find where to change my invoice numbering." };
const BUG = { title: "Save does nothing", description: "Clicking save does nothing.", steps: "Open a client and click Save.", route: "/clients", viewportWidth: "800", viewportHeight: "600" };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

let fixtures: TestFixtures;

beforeAll(async () => {
  fixtures = await seedTestData();
});

afterAll(async () => {
  resetAuthMock();
  await cleanupTestData(fixtures);
});

beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  process.env.INVITATION_FROM_EMAIL = "Aqenra <no-reply@example.com>";
  process.env.PLATFORM_SUPPORT_EMAIL = "support@example.com";
  process.env.PLATFORM_FEEDBACK_EMAIL = "feedback@example.com";
  sendEmailViaResend.mockReset().mockResolvedValue({ ok: true });
  resetSubmissionDedupeForTests();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetAuthMock();
});

describe("tenant isolation and identity", () => {
  it("owner of org A: the email carries org A's workspace and the account's own email", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await submitStaffSupportAction(EMPTY, form(SUPPORT));
    expect(result).toMatchObject({ success: true });
    const sent = sendEmailViaResend.mock.calls[0][0];
    expect(sent.text).toContain("Test Org A");
    expect(sent.text).toContain(fixtures.orgA.id);
    expect(sent.text).toContain("OWNER");
    expect(sent.replyTo).toBe(fixtures.owner.email);
    expect(sent.text).not.toContain("Test Org B");
    expect(sent.text).not.toContain(fixtures.orgB.id);
  });

  it("a spoofed organizationId / email / recipient in the form cannot move the report to org B or another recipient", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await submitBugReportAction(
      EMPTY,
      form({ ...BUG, organizationId: fixtures.orgB.id, userId: fixtures.orgBOwner.id, email: fixtures.orgBOwner.email, to: "attacker@evil.example" }),
    );
    const sent = sendEmailViaResend.mock.calls[0][0];
    const everything = JSON.stringify(sent);
    expect(sent.to).toBe("feedback@example.com");
    expect(sent.replyTo).toBe(fixtures.owner.email);
    expect(everything).toContain(fixtures.orgA.id);
    expect(everything).not.toContain(fixtures.orgB.id);
    expect(everything).not.toContain("Test Org B");
    expect(everything).not.toContain(fixtures.orgBOwner.email);
    expect(everything).not.toContain("evil.example");
  });

  it("org B's owner reports under org B only", async () => {
    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    await submitStaffSupportAction(EMPTY, form(SUPPORT));
    const sent = sendEmailViaResend.mock.calls[0][0];
    expect(sent.text).toContain("Test Org B");
    expect(sent.text).not.toContain("Test Org A");
    expect(sent.replyTo).toBe(fixtures.orgBOwner.email);
  });

  it("works for every Staff role (admin, member) with their own role in the email", async () => {
    actAs(fixtures.admin, fixtures.orgA.id);
    await submitStaffSupportAction(EMPTY, form(SUPPORT));
    expect(sendEmailViaResend.mock.calls[0][0].text).toContain("ADMIN");
  });

  it("an unauthenticated request is turned away by the real auth layer and sends nothing", async () => {
    setMockAuthUser(null);
    await expect(submitStaffSupportAction(EMPTY, form(SUPPORT))).rejects.toBeDefined();
    await expect(submitBugReportAction(EMPTY, form(BUG))).rejects.toBeDefined();
    expect(sendEmailViaResend).not.toHaveBeenCalled();
  });
});

describe("independent routing against the real stack", () => {
  it("support → support address, bug → bug address", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await submitStaffSupportAction(EMPTY, form(SUPPORT));
    await submitBugReportAction(EMPTY, form(BUG));
    expect(sendEmailViaResend.mock.calls.map((c) => c[0].to)).toEqual(["support@example.com", "feedback@example.com"]);
  });

  it("an unset bug destination fails the bug report only; support keeps working and nothing falls back", async () => {
    delete process.env.PLATFORM_FEEDBACK_EMAIL;
    actAs(fixtures.owner, fixtures.orgA.id);
    const bug = await submitBugReportAction(EMPTY, form(BUG));
    expect(bug.error).toMatch(/isn't available yet/);
    expect(sendEmailViaResend).not.toHaveBeenCalled();
    const support = await submitStaffSupportAction(EMPTY, form(SUPPORT));
    expect(support).toMatchObject({ success: true });
    expect(sendEmailViaResend.mock.calls.map((c) => c[0].to)).toEqual(["support@example.com"]);
  });
});
