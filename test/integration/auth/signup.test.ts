import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { signup } from "@/app/(auth)/signup/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { testEmail } from "../../support/run-id";
import { setMockVerifyOtpConfig, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

// SaaS Signup Foundation (Stage 6.1) + Signup-confirmation defect fix
// (Invited Signup Confirmation Redirect Investigation). signup() no
// longer calls supabase.auth.signUp() at all — its two network-bound
// dependencies (generateToken, sendConfirmationEmail) are injected
// directly via its own `deps` parameter, the same DI seam every email-
// sending module in this app already uses (see sendInvitationEmail's own
// `deps.sendEmail`) — never a module-level vi.mock() of the Supabase
// Admin API or Resend. supabase.auth.verifyOtp() (only reached on the
// "already confirmed" immediate-session path) still goes through the
// shared, globally-mocked @/lib/supabase/server client
// (test/integration/setup-mocks.ts) — configured per test via
// setMockVerifyOtpConfig(), exactly like signInWithPassword's own mock.
// Everything downstream (getOrCreateUser, getOrCreateOrganizationId,
// createTrialSubscription) is the real implementation, running unmocked
// against the real test Postgres.

function signupForm(fields: { email: string; password: string; confirmPassword?: string; organizationName: string }): FormData {
  const formData = new FormData();
  formData.set("email", fields.email);
  formData.set("password", fields.password);
  formData.set("confirmPassword", fields.confirmPassword ?? fields.password);
  formData.set("organizationName", fields.organizationName);
  return formData;
}

async function cleanupUserAndOrg(userId: string, organizationId?: string): Promise<void> {
  if (organizationId) {
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  }
  await prisma.user.deleteMany({ where: { id: userId } });
}

describe("signup — SaaS Signup Foundation (Stage 6.1) + signup-confirmation defect fix", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("validates required fields before ever calling generateToken — no token config needed, proving it's rejected first", async () => {
    const formData = new FormData();
    formData.set("email", testEmail("signup-missing-org", "test.local"));
    formData.set("password", "correct-horse-battery-1");
    formData.set("confirmPassword", "correct-horse-battery-1");
    // organizationName intentionally omitted.

    const generateToken = vi.fn();
    const result = await signup({ error: null }, formData, { generateToken });
    expect(result.error).toBe("All fields are required.");
    expect(generateToken).not.toHaveBeenCalled();
  });

  describe("immediate session (email confirmation disabled)", () => {
    it("creates an isolated Organization (named from the form), an OWNER Membership, and a trial Subscription — atomically, and redirects into /dashboard", async () => {
      const userId = randomUUID();
      const email = testEmail("signup-owner", "test.local");
      const organizationName = `Acme Signup Co ${userId.slice(0, 8)}`;
      const formData = signupForm({ email, password: "correct-horse-battery-1", organizationName });

      setMockVerifyOtpConfig({ kind: "success", user: { id: userId, email } });
      const generateToken = vi.fn().mockResolvedValue({ ok: true, tokenHash: "real-hash", alreadyConfirmed: true });

      let caught: unknown;
      try {
        await signup({ error: null }, formData, { generateToken });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RedirectSignal);
      expect((caught as RedirectSignal).url).toMatch(/^\/dashboard\?/);

      expect(generateToken).toHaveBeenCalledWith(
        expect.objectContaining({ email, password: "correct-horse-battery-1", organizationName }),
      );

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.email).toBe(email);

      const membership = await prisma.membership.findFirst({ where: { userId, role: "OWNER" } });
      expect(membership).not.toBeNull();

      const organization = await prisma.organization.findUnique({ where: { id: membership!.organizationId } });
      expect(organization?.name).toBe(organizationName);

      const subscription = await prisma.subscription.findUnique({ where: { organizationId: membership!.organizationId } });
      expect(subscription?.status).toBe("TRIALING");

      await cleanupUserAndOrg(userId, membership!.organizationId);
    });

    it("owner permissions: the signer-upper holds OWNER, and a second, independent signup gets its own separate OWNER membership in its own org", async () => {
      const userIdA = randomUUID();
      const emailA = testEmail("signup-owner-a", "test.local");
      setMockVerifyOtpConfig({ kind: "success", user: { id: userIdA, email: emailA } });
      await expect(
        signup(
          { error: null },
          signupForm({ email: emailA, password: "correct-horse-battery-1", organizationName: `Org A ${userIdA.slice(0, 8)}` }),
          { generateToken: vi.fn().mockResolvedValue({ ok: true, tokenHash: "h-a", alreadyConfirmed: true }) },
        ),
      ).rejects.toBeInstanceOf(RedirectSignal);

      const userIdB = randomUUID();
      const emailB = testEmail("signup-owner-b", "test.local");
      setMockVerifyOtpConfig({ kind: "success", user: { id: userIdB, email: emailB } });
      await expect(
        signup(
          { error: null },
          signupForm({ email: emailB, password: "correct-horse-battery-1", organizationName: `Org B ${userIdB.slice(0, 8)}` }),
          { generateToken: vi.fn().mockResolvedValue({ ok: true, tokenHash: "h-b", alreadyConfirmed: true }) },
        ),
      ).rejects.toBeInstanceOf(RedirectSignal);

      const membershipA = await prisma.membership.findFirstOrThrow({ where: { userId: userIdA } });
      const membershipB = await prisma.membership.findFirstOrThrow({ where: { userId: userIdB } });

      expect(membershipA.role).toBe("OWNER");
      expect(membershipB.role).toBe("OWNER");
      expect(membershipA.organizationId).not.toBe(membershipB.organizationId);

      const crossA = await prisma.membership.findUnique({
        where: { userId_organizationId: { userId: userIdA, organizationId: membershipB.organizationId } },
      });
      const crossB = await prisma.membership.findUnique({
        where: { userId_organizationId: { userId: userIdB, organizationId: membershipA.organizationId } },
      });
      expect(crossA).toBeNull();
      expect(crossB).toBeNull();

      await cleanupUserAndOrg(userIdA, membershipA.organizationId);
      await cleanupUserAndOrg(userIdB, membershipB.organizationId);
    });

    it("existing organizations cannot be reached by a new signup: the new OWNER has no Membership in any pre-existing organization", async () => {
      const userId = randomUUID();
      const email = testEmail("signup-isolated", "test.local");
      setMockVerifyOtpConfig({ kind: "success", user: { id: userId, email } });
      const formData = signupForm({ email, password: "correct-horse-battery-1", organizationName: `Isolated Co ${userId.slice(0, 8)}` });

      await expect(
        signup({ error: null }, formData, {
          generateToken: vi.fn().mockResolvedValue({ ok: true, tokenHash: "h", alreadyConfirmed: true }),
        }),
      ).rejects.toBeInstanceOf(RedirectSignal);

      const memberships = await prisma.membership.findMany({ where: { userId } });
      expect(memberships).toHaveLength(1);
      expect(memberships[0].organizationId).not.toBe(fixtures.orgA.id);
      expect(memberships[0].organizationId).not.toBe(fixtures.orgB.id);

      const orgAOwnerMembership = await prisma.membership.findUnique({
        where: { userId_organizationId: { userId: fixtures.owner.id, organizationId: fixtures.orgA.id } },
      });
      expect(orgAOwnerMembership?.role).toBe("OWNER");

      await cleanupUserAndOrg(userId, memberships[0].organizationId);
    });
  });

  describe("duplicate email handling", () => {
    it("surfaces Supabase's rejection message and creates no User, Organization, or Membership row", async () => {
      const email = testEmail("signup-duplicate", "test.local");
      const organizationName = "Duplicate Attempt Co";
      const formData = signupForm({ email, password: "correct-horse-battery-1", organizationName });

      const result = await signup({ error: null }, formData, {
        generateToken: vi.fn().mockResolvedValue({ ok: false, error: "User already registered" }),
      });
      expect(result.error).toBe("User already registered");

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).toBeNull();

      const organization = await prisma.organization.findFirst({ where: { name: organizationName } });
      expect(organization).toBeNull();
    });
  });

  describe("email confirmation required (no session yet)", () => {
    it("does not eagerly create a User or Organization, sends the confirmation email, and returns the check-your-email message", async () => {
      const email = testEmail("signup-pending", "test.local");
      const organizationName = `Pending Co ${randomUUID().slice(0, 8)}`;
      const formData = signupForm({ email, password: "correct-horse-battery-1", organizationName });

      const sendConfirmationEmail = vi.fn().mockResolvedValue({ delivered: true });
      const result = await signup({ error: null }, formData, {
        generateToken: vi.fn().mockResolvedValue({ ok: true, tokenHash: "pending-hash", alreadyConfirmed: false }),
        sendConfirmationEmail,
      });

      expect(result.error).toBeNull();
      expect(result.message).toMatch(/check your email/i);
      expect(sendConfirmationEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: email, isInvited: false, confirmUrl: expect.stringContaining("token_hash=pending-hash") }),
      );

      const user = await prisma.user.findFirst({ where: { email } });
      expect(user).toBeNull();

      const organization = await prisma.organization.findFirst({ where: { name: organizationName } });
      expect(organization).toBeNull();
    });

    it("email delivery failure after token generation: returns a specific error, never a false success, and creates no User/Organization row", async () => {
      const email = testEmail("signup-email-fails", "test.local");
      const organizationName = `Undeliverable Co ${randomUUID().slice(0, 8)}`;
      const formData = signupForm({ email, password: "correct-horse-battery-1", organizationName });

      const result = await signup({ error: null }, formData, {
        generateToken: vi.fn().mockResolvedValue({ ok: true, tokenHash: "undelivered-hash", alreadyConfirmed: false }),
        sendConfirmationEmail: vi.fn().mockResolvedValue({ delivered: false, reason: "provider_error" }),
      });

      expect(result.error).toBe(
        "Account could not be created because the confirmation email could not be sent. Please try again.",
      );
      expect(result.message).toBeUndefined();

      const user = await prisma.user.findFirst({ where: { email } });
      expect(user).toBeNull();
      const organization = await prisma.organization.findFirst({ where: { name: organizationName } });
      expect(organization).toBeNull();
    });
  });
});
