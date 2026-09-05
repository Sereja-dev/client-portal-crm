import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/enums";
import { signup } from "@/app/(auth)/signup/actions";
import { acceptInvitationAction } from "@/app/invite/[token]/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { testEmail } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";
import { setMockAuthUser, setMockVerifyOtpConfig, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal, resetNavigationMock } from "../../support/navigation-mock";

// Invited-signup defect fix (PR #188) + signup-confirmation defect fix
// (Invited Signup Confirmation Redirect Investigation). The real
// Production defects this suite proves fixed:
//   1. an invited Member signing up through /signup must never end up
//      owning a spurious personal Organization in addition to the
//      Membership they actually accept (PR #188).
//   2. when Supabase's project requires email confirmation, the invited
//      user must receive Aqenra's own branded confirmation email (never
//      Supabase's native one) whose link, once clicked, actually returns
//      them to /invite/<token> — never the generic /signup page.
// Each test creates its own Invitation row (never reusing
// fixtures.invitation, which other test files may also read) so no test
// here can affect another's assumed invitation status. signup()'s two
// network-bound dependencies (generateToken, sendConfirmationEmail) are
// injected directly, never module-mocked.

async function createInvitation(
  fixtures: TestFixtures,
  overrides: Partial<{ status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED"; organizationId: string; email: string }> = {},
) {
  const email = overrides.email ?? testEmail(`invited-signup-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN, fixtures.runId);
  return prisma.invitation.create({
    data: {
      organizationId: overrides.organizationId ?? fixtures.orgA.id,
      email,
      role: Role.MEMBER,
      token: randomUUID(),
      status: overrides.status ?? "PENDING",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      invitedById: fixtures.owner.id,
    },
  });
}

function signupForm(fields: { email: string; password: string; invitationToken?: string; organizationName?: string }): FormData {
  const formData = new FormData();
  formData.set("email", fields.email);
  formData.set("password", fields.password);
  formData.set("confirmPassword", fields.password);
  if (fields.invitationToken) formData.set("invitationToken", fields.invitationToken);
  if (fields.organizationName) formData.set("organizationName", fields.organizationName);
  return formData;
}

describe("invited signup — invited-signup + signup-confirmation defect fixes", () => {
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

  it("does not require organizationName when a valid invitationToken is present", async () => {
    const invitation = await createInvitation(fixtures);
    const userId = randomUUID();
    setMockVerifyOtpConfig({ kind: "success", user: { id: userId, email: invitation.email } });

    const formData = signupForm({ email: invitation.email, password: "correct-horse-battery-1", invitationToken: invitation.token });
    // organizationName intentionally omitted — must not be required.

    await expect(
      signup({ error: null }, formData, {
        generateToken: vi.fn().mockResolvedValue({ ok: true, tokenHash: "h", alreadyConfirmed: true }),
      }),
    ).rejects.toBeInstanceOf(RedirectSignal);

    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("immediate session (confirm email disabled): creates the User row but no Organization and no OWNER Membership, and redirects to /invite/<token>", async () => {
    const invitation = await createInvitation(fixtures);
    const userId = randomUUID();
    setMockVerifyOtpConfig({ kind: "success", user: { id: userId, email: invitation.email } });

    const formData = signupForm({ email: invitation.email, password: "correct-horse-battery-1", invitationToken: invitation.token });
    const generateToken = vi.fn().mockResolvedValue({ ok: true, tokenHash: "h", alreadyConfirmed: true });

    let caught: unknown;
    try {
      await signup({ error: null }, formData, { generateToken });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RedirectSignal);
    expect((caught as RedirectSignal).url).toMatch(new RegExp(`^/invite/${invitation.token}\\?`));

    // Never carries an organizationName through for an invited signup —
    // there is no organization for it to name.
    expect(generateToken).toHaveBeenCalledWith(
      expect.objectContaining({ email: invitation.email, organizationName: undefined }),
    );

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.email).toBe(invitation.email);

    const memberships = await prisma.membership.findMany({ where: { userId } });
    expect(memberships).toHaveLength(0);

    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("email confirmation required: sends Aqenra's own branded confirmation email (never Supabase's native one) with next=/invite/<token>, and creates no User/Organization/Membership yet", async () => {
    const invitation = await createInvitation(fixtures);
    const formData = signupForm({ email: invitation.email, password: "correct-horse-battery-1", invitationToken: invitation.token });

    const sendConfirmationEmail = vi.fn().mockResolvedValue({ delivered: true });
    const result = await signup({ error: null }, formData, {
      generateToken: vi.fn().mockResolvedValue({ ok: true, tokenHash: "invited-pending-hash", alreadyConfirmed: false }),
      sendConfirmationEmail,
    });

    expect(result.error).toBeNull();
    expect(result.message).toMatch(/check your email/i);

    expect(sendConfirmationEmail).toHaveBeenCalledTimes(1);
    const call = sendConfirmationEmail.mock.calls[0][0];
    expect(call.to).toBe(invitation.email);
    expect(call.isInvited).toBe(true);
    expect(call.confirmUrl).toContain("token_hash=invited-pending-hash");
    expect(call.confirmUrl).toContain("type=signup");
    expect(call.confirmUrl).toContain(`next=%2Finvite%2F${invitation.token}`);

    const user = await prisma.user.findFirst({ where: { email: invitation.email } });
    expect(user).toBeNull();
    const memberships = user ? await prisma.membership.findMany({ where: { userId: user.id } }) : [];
    expect(memberships).toHaveLength(0);
  });

  it("does not eagerly create a User when email confirmation is required (pending-confirmation)", async () => {
    const invitation = await createInvitation(fixtures);
    const formData = signupForm({ email: invitation.email, password: "correct-horse-battery-1", invitationToken: invitation.token });

    const result = await signup({ error: null }, formData, {
      generateToken: vi.fn().mockResolvedValue({ ok: true, tokenHash: "h", alreadyConfirmed: false }),
      sendConfirmationEmail: vi.fn().mockResolvedValue({ delivered: true }),
    });

    expect(result.error).toBeNull();
    expect(result.message).toMatch(/check your email/i);

    const user = await prisma.user.findFirst({ where: { email: invitation.email } });
    expect(user).toBeNull();
  });

  it("an invitation no longer valid by submission time returns a specific error, never the generic 'all fields required' message", async () => {
    const invitation = await createInvitation(fixtures, { status: "REVOKED" });
    const formData = signupForm({ email: invitation.email, password: "correct-horse-battery-1", invitationToken: invitation.token });

    const result = await signup({ error: null }, formData, { generateToken: vi.fn() });
    expect(result.error).toBe("This invitation is no longer available. Please refresh and try again.");
  });

  it("a forged/nonexistent invitationToken never falls through to a real invited signup — it returns the same specific 'no longer available' error as a genuinely-expired one, never a fabricated organization", async () => {
    const email = testEmail("signup-forged-token", TEST_EMAIL_DOMAIN);
    const formData = new FormData();
    formData.set("email", email);
    formData.set("password", "correct-horse-battery-1");
    formData.set("confirmPassword", "correct-horse-battery-1");
    formData.set("invitationToken", "not-a-real-token");
    // organizationName intentionally omitted — a forged token must never
    // silently degrade into treating this as a plain standalone signup.

    const result = await signup({ error: null }, formData, { generateToken: vi.fn() });
    expect(result.error).toBe("This invitation is no longer available. Please refresh and try again.");

    const user = await prisma.user.findFirst({ where: { email } });
    expect(user).toBeNull();
  });

  it("with no invitationToken field at all (the genuine standalone-signup case), organizationName is still required", async () => {
    const formData = new FormData();
    formData.set("email", testEmail("signup-no-token-no-org", TEST_EMAIL_DOMAIN));
    formData.set("password", "correct-horse-battery-1");
    formData.set("confirmPassword", "correct-horse-battery-1");
    // No invitationToken, no organizationName.

    const result = await signup({ error: null }, formData, { generateToken: vi.fn() });
    expect(result.error).toBe("All fields are required.");
  });

  it("full flow: invited signup (immediate session) followed by acceptInvitationAction results in exactly one Membership (the invited role, in the invited organization) and no organization ownership anywhere", async () => {
    const invitation = await createInvitation(fixtures);
    const userId = randomUUID();
    setMockVerifyOtpConfig({ kind: "success", user: { id: userId, email: invitation.email } });

    const formData = signupForm({ email: invitation.email, password: "correct-horse-battery-1", invitationToken: invitation.token });
    await expect(
      signup({ error: null }, formData, {
        generateToken: vi.fn().mockResolvedValue({ ok: true, tokenHash: "h", alreadyConfirmed: true }),
      }),
    ).rejects.toBeInstanceOf(RedirectSignal);

    // verifyOtp's own mock sets the mock auth user as a side effect
    // (mirroring a real persisted session cookie) — acceptInvitationAction's
    // own getOrCreateUser() call resolves this same identity.
    await expect(acceptInvitationAction(invitation.token)).rejects.toBeInstanceOf(RedirectSignal);

    const memberships = await prisma.membership.findMany({ where: { userId } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].organizationId).toBe(invitation.organizationId);
    expect(memberships[0].role).toBe(Role.MEMBER);

    const ownedAnywhere = await prisma.membership.findMany({ where: { userId, role: "OWNER" } });
    expect(ownedAnywhere).toHaveLength(0);

    await prisma.user.deleteMany({ where: { id: userId } });
  });
});

describe("existing-user invite flow — regression (unaffected by either fix)", () => {
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

  it("an existing account (already logged in) accepting a valid invitation to a second organization receives exactly the invited membership, leaving their existing OWNER membership untouched", async () => {
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: fixtures.orgB.id,
        email: fixtures.owner.email,
        role: Role.MEMBER,
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        invitedById: fixtures.owner.id,
      },
    });

    setMockAuthUser({ id: fixtures.owner.id, email: fixtures.owner.email });

    await expect(acceptInvitationAction(invitation.token)).rejects.toBeInstanceOf(RedirectSignal);

    const newMembership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: fixtures.owner.id, organizationId: fixtures.orgB.id } },
    });
    expect(newMembership?.role).toBe(Role.MEMBER);

    const existingOrgAMembership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: fixtures.owner.id, organizationId: fixtures.orgA.id } },
    });
    expect(existingOrgAMembership?.role).toBe(Role.OWNER);
  });
});
