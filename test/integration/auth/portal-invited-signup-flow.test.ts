import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { portalSignup } from "@/app/portal/signup/actions";
import { acceptClientInvitationAction } from "@/app/portal/invite/[token]/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { testEmail } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";
import { setMockAuthUser, setMockVerifyOtpConfig, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal, resetNavigationMock } from "../../support/navigation-mock";

// Portal signup-confirmation defect fix. The real Production defect this
// suite proves fixed: an invited Client Portal signup must never depend
// on Supabase's own native confirmation email (which a real Production
// smoke test found does not deliver a server-visible token under this
// project's implicit flowType), and must never create a Staff User,
// Organization, or Membership — a PortalUser is created only by
// acceptClientInvitationAction, unchanged, once the user explicitly
// clicks Accept. Each test creates its own ClientInvitation row (never
// reusing fixtures.clientInvitation, which other test files may also
// read) so no test here can affect another's assumed invitation status.

async function createClientInvitation(
  fixtures: TestFixtures,
  overrides: Partial<{ status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED"; clientId: string; email: string }> = {},
) {
  const email = overrides.email ?? testEmail(`portal-invited-signup-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN, fixtures.runId);
  return prisma.clientInvitation.create({
    data: {
      clientId: overrides.clientId ?? fixtures.clientA.id,
      email,
      token: randomUUID(),
      status: overrides.status ?? "PENDING",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      invitedById: fixtures.owner.id,
    },
  });
}

function portalSignupForm(fields: { email: string; password: string; invitationToken?: string }): FormData {
  const formData = new FormData();
  formData.set("email", fields.email);
  formData.set("password", fields.password);
  formData.set("confirmPassword", fields.password);
  if (fields.invitationToken) formData.set("invitationToken", fields.invitationToken);
  return formData;
}

describe("invited Portal signup — signup-confirmation defect fix", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
    resetNavigationMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("immediate session (confirm email disabled): redirects to /portal/invite/<token>, creating no PortalUser and no Staff User/Organization/Membership", async () => {
    const invitation = await createClientInvitation(fixtures);
    const userId = randomUUID();
    setMockVerifyOtpConfig({ kind: "success", user: { id: userId, email: invitation.email } });

    const formData = portalSignupForm({ email: invitation.email, password: "correct-horse-battery-1", invitationToken: invitation.token });
    const generateToken = vi.fn().mockResolvedValue({ ok: true, tokenHash: "h", alreadyConfirmed: true });

    let caught: unknown;
    try {
      await portalSignup({ error: null }, formData, { generateToken });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RedirectSignal);
    expect((caught as RedirectSignal).url).toMatch(new RegExp(`^/portal/invite/${invitation.token}\\?`));

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user).toBeNull();
    const portalUser = await prisma.portalUser.findUnique({ where: { id: userId } });
    expect(portalUser).toBeNull();
  });

  it("email confirmation required: sends the Aqenra Portal confirmation email with next=/portal/invite/<token>, creating no rows yet", async () => {
    const invitation = await createClientInvitation(fixtures);
    const formData = portalSignupForm({ email: invitation.email, password: "correct-horse-battery-1", invitationToken: invitation.token });

    const sendConfirmationEmail = vi.fn().mockResolvedValue({ delivered: true });
    const result = await portalSignup({ error: null }, formData, {
      generateToken: vi.fn().mockResolvedValue({ ok: true, tokenHash: "invited-portal-hash", alreadyConfirmed: false }),
      sendConfirmationEmail,
    });

    expect(result.error).toBeNull();
    expect(result.message).toMatch(/check your email/i);

    expect(sendConfirmationEmail).toHaveBeenCalledTimes(1);
    const call = sendConfirmationEmail.mock.calls[0][0];
    expect(call.to).toBe(invitation.email);
    expect(call.confirmUrl).toContain("token_hash=invited-portal-hash");
    expect(call.confirmUrl).toContain("type=portal_signup");
    expect(call.confirmUrl).toContain(`next=%2Fportal%2Finvite%2F${invitation.token}`);

    const user = await prisma.user.findFirst({ where: { email: invitation.email } });
    expect(user).toBeNull();
    const portalUser = await prisma.portalUser.findFirst({ where: { email: invitation.email } });
    expect(portalUser).toBeNull();
  });

  it("an invitation no longer valid by submission time returns a specific error, never the generic 'all fields required' message", async () => {
    const invitation = await createClientInvitation(fixtures, { status: "REVOKED" });
    const formData = portalSignupForm({ email: invitation.email, password: "correct-horse-battery-1", invitationToken: invitation.token });

    const result = await portalSignup({ error: null }, formData, { generateToken: vi.fn() });
    expect(result.error).toBe("This invitation is no longer available. Please refresh and try again.");
  });

  it("an expired invitation cannot be used in invited mode", async () => {
    const invitation = await prisma.clientInvitation.create({
      data: {
        clientId: fixtures.clientA.id,
        email: testEmail(`portal-invited-expired-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN, fixtures.runId),
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() - 1000),
        invitedById: fixtures.owner.id,
      },
    });
    const formData = portalSignupForm({ email: invitation.email, password: "correct-horse-battery-1", invitationToken: invitation.token });

    const result = await portalSignup({ error: null }, formData, { generateToken: vi.fn() });
    expect(result.error).toBe("This invitation is no longer available. Please refresh and try again.");
  });

  it("a forged/nonexistent invitationToken never falls through to a real invited signup", async () => {
    const email = testEmail("portal-signup-forged-token", TEST_EMAIL_DOMAIN);
    const formData = portalSignupForm({ email, password: "correct-horse-battery-1", invitationToken: "not-a-real-token" });

    const result = await portalSignup({ error: null }, formData, { generateToken: vi.fn() });
    expect(result.error).toBe("This invitation is no longer available. Please refresh and try again.");

    const user = await prisma.user.findFirst({ where: { email } });
    expect(user).toBeNull();
  });

  it("full flow: invited Portal signup (immediate session) followed by acceptClientInvitationAction creates exactly one PortalUser, and still no Staff User/Organization/Membership anywhere", async () => {
    const invitation = await createClientInvitation(fixtures);
    const userId = randomUUID();
    setMockVerifyOtpConfig({ kind: "success", user: { id: userId, email: invitation.email } });

    const formData = portalSignupForm({ email: invitation.email, password: "correct-horse-battery-1", invitationToken: invitation.token });
    await expect(
      portalSignup({ error: null }, formData, {
        generateToken: vi.fn().mockResolvedValue({ ok: true, tokenHash: "h", alreadyConfirmed: true }),
      }),
    ).rejects.toBeInstanceOf(RedirectSignal);

    // Explicit acceptance is still required — nothing above created a
    // PortalUser yet.
    const beforeAccept = await prisma.portalUser.findUnique({ where: { id: userId } });
    expect(beforeAccept).toBeNull();

    await expect(acceptClientInvitationAction(invitation.token)).rejects.toBeInstanceOf(RedirectSignal);

    const portalUser = await prisma.portalUser.findUnique({ where: { id: userId } });
    expect(portalUser?.clientId).toBe(invitation.clientId);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user).toBeNull();
    const memberships = await prisma.membership.findMany({ where: { userId } });
    expect(memberships).toHaveLength(0);

    const acceptedInvitation = await prisma.clientInvitation.findUnique({ where: { id: invitation.id } });
    expect(acceptedInvitation?.status).toBe("ACCEPTED");

    await prisma.portalUser.deleteMany({ where: { id: userId } });
  });
});

describe("existing-user Portal invite flow — regression (unaffected by this fix)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
    resetNavigationMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("mismatched email is still rejected server-side at acceptance, regardless of anything the signup form did or didn't lock", async () => {
    const invitation = await prisma.clientInvitation.create({
      data: {
        clientId: fixtures.clientA.id,
        email: testEmail(`portal-mismatch-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN, fixtures.runId),
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        invitedById: fixtures.owner.id,
      },
    });

    // Authenticated as a genuinely different identity/email than the invitation.
    setMockAuthUser({ id: randomUUID(), email: testEmail("portal-mismatch-actor", TEST_EMAIL_DOMAIN, fixtures.runId) });

    const result = await acceptClientInvitationAction(invitation.token);
    expect(result.error).toBe("This invitation was sent to a different email address.");

    const stillPending = await prisma.clientInvitation.findUnique({ where: { id: invitation.id } });
    expect(stillPending?.status).toBe("PENDING");
  });
});
