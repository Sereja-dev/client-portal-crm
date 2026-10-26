import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/enums";
import {
  resendInvitationAction,
  cancelInvitationAction,
} from "@/app/(dashboard)/team/actions";
import { acceptInvitationAction } from "@/app/invite/[token]/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, setMockAuthUser, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal, resetNavigationMock } from "../../support/navigation-mock";
import { testEmail } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";

async function createInvitation(
  fixtures: TestFixtures,
  overrides: Partial<{ status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED"; expiresAt: Date; role: Role }>,
) {
  return prisma.invitation.create({
    data: {
      organizationId: fixtures.orgA.id,
      email: testEmail(`lifecycle-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN, fixtures.runId),
      role: overrides.role ?? Role.MEMBER,
      token: randomUUID(),
      status: overrides.status ?? "PENDING",
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      invitedById: fixtures.owner.id,
    },
  });
}

describe("staff invitation state machine", () => {
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

  it("resend on a PENDING invitation rotates the token and stays PENDING", async () => {
    const invitation = await createInvitation(fixtures, { status: "PENDING" });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await resendInvitationAction(invitation.id);

    expect(result.error).toBeNull();
    const updated = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(updated.status).toBe("PENDING");
    expect(updated.token).not.toBe(invitation.token);

    await prisma.invitation.delete({ where: { id: invitation.id } });
  });

  it("resend on an ACCEPTED invitation is rejected and does not touch the row", async () => {
    const invitation = await createInvitation(fixtures, { status: "ACCEPTED" });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await resendInvitationAction(invitation.id);

    expect(result.error).toBe("This invitation has already been accepted.");
    const unchanged = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(unchanged.token).toBe(invitation.token);

    await prisma.invitation.delete({ where: { id: invitation.id } });
  });

  it("resend on a REVOKED invitation succeeds and revives it to PENDING", async () => {
    const invitation = await createInvitation(fixtures, { status: "REVOKED" });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await resendInvitationAction(invitation.id);

    expect(result.error).toBeNull();
    const revived = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(revived.status).toBe("PENDING");

    await prisma.invitation.delete({ where: { id: invitation.id } });
  });

  it("resend on an EXPIRED (status) invitation succeeds and revives it to PENDING with a fresh expiry", async () => {
    const invitation = await createInvitation(fixtures, {
      status: "PENDING",
      expiresAt: new Date(Date.now() - 1000), // already past, still PENDING status
    });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await resendInvitationAction(invitation.id);

    expect(result.error).toBeNull();
    const revived = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(revived.expiresAt.getTime()).toBeGreaterThan(Date.now());

    await prisma.invitation.delete({ where: { id: invitation.id } });
  });

  it("cancel is idempotent: a second cancel on an already-REVOKED invitation is a silent no-op", async () => {
    const invitation = await createInvitation(fixtures, { status: "PENDING" });
    actAs(fixtures.owner, fixtures.orgA.id);

    await cancelInvitationAction(invitation.id);
    const afterFirst = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(afterFirst.status).toBe("REVOKED");

    const activityCountBefore = await prisma.activity.count({ where: { entityId: invitation.id } });
    await cancelInvitationAction(invitation.id); // repeat cancel
    const activityCountAfter = await prisma.activity.count({ where: { entityId: invitation.id } });

    expect(activityCountAfter).toBe(activityCountBefore); // no second CANCELED activity logged

    await prisma.invitation.delete({ where: { id: invitation.id } });
  });

  it("accepting an expired invitation is rejected with a specific message, and the row is untouched", async () => {
    const invitation = await createInvitation(fixtures, {
      status: "PENDING",
      expiresAt: new Date(Date.now() - 1000),
    });
    setMockAuthUser({ id: randomUUID(), email: invitation.email });
    // No matching Prisma User yet — getOrCreateUser() will create one.

    const result = await acceptInvitationAction(invitation.token);

    expect(result.error).toBe("This invitation has expired.");
    const unchanged = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(unchanged.status).toBe("PENDING");

    await prisma.user.deleteMany({ where: { email: invitation.email } });
    await prisma.invitation.delete({ where: { id: invitation.id } });
  });

  it("accepting a REVOKED invitation is rejected with the generic unavailable message", async () => {
    const invitation = await createInvitation(fixtures, { status: "REVOKED" });
    setMockAuthUser({ id: randomUUID(), email: invitation.email });

    const result = await acceptInvitationAction(invitation.token);

    expect(result.error).toBe("This invitation is no longer available.");

    await prisma.user.deleteMany({ where: { email: invitation.email } });
    await prisma.invitation.delete({ where: { id: invitation.id } });
  });

  it("accepting a PENDING invitation succeeds: creates exactly one Membership and one INVITATION_ACCEPTED Activity", async () => {
    const invitation = await createInvitation(fixtures, { status: "PENDING" });
    const authUserId = randomUUID();
    setMockAuthUser({ id: authUserId, email: invitation.email });

    await expect(acceptInvitationAction(invitation.token)).rejects.toThrow(RedirectSignal);

    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: authUserId, organizationId: fixtures.orgA.id } },
    });
    expect(membership).not.toBeNull();
    expect(membership?.role).toBe(Role.MEMBER);

    const updatedInvitation = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(updatedInvitation.status).toBe("ACCEPTED");

    const activity = await prisma.activity.findFirst({
      where: { entityId: invitation.id, action: "INVITATION_ACCEPTED" },
    });
    expect(activity).not.toBeNull();

    await prisma.membership.deleteMany({ where: { userId: authUserId } });
    await prisma.invitation.delete({ where: { id: invitation.id } });
    await prisma.user.deleteMany({ where: { id: authUserId } });
  });

  it("accepting an already-ACCEPTED invitation a second time is idempotent (no duplicate Membership/Activity)", async () => {
    const invitation = await createInvitation(fixtures, { status: "PENDING" });
    const authUserId = randomUUID();
    setMockAuthUser({ id: authUserId, email: invitation.email });

    await expect(acceptInvitationAction(invitation.token)).rejects.toThrow(RedirectSignal);
    // Second accept of the same token, same identity, already ACCEPTED.
    const secondAttempt = await acceptInvitationAction(invitation.token).catch((e) => {
      if (e instanceof RedirectSignal) return { error: null, redirected: true };
      throw e;
    });
    expect(secondAttempt).toBeTruthy();

    const membershipCount = await prisma.membership.count({
      where: { userId: authUserId, organizationId: fixtures.orgA.id },
    });
    expect(membershipCount).toBe(1);
    const activityCount = await prisma.activity.count({
      where: { entityId: invitation.id, action: "INVITATION_ACCEPTED" },
    });
    expect(activityCount).toBe(1);

    await prisma.membership.deleteMany({ where: { userId: authUserId } });
    await prisma.invitation.delete({ where: { id: invitation.id } });
    await prisma.user.deleteMany({ where: { id: authUserId } });
  });

  it("accepting with a mismatched email is rejected without creating any Membership", async () => {
    const invitation = await createInvitation(fixtures, { status: "PENDING" });
    const mismatchedEmail = `someone-else-${randomUUID().slice(0, 8)}@${TEST_EMAIL_DOMAIN}`;
    setMockAuthUser({ id: randomUUID(), email: mismatchedEmail });

    const result = await acceptInvitationAction(invitation.token);

    expect(result.error).toBe("This invitation was sent to a different email address.");
    const stillPending = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(stillPending.status).toBe("PENDING");

    // getOrCreateUser() runs before the email-match check, so it already
    // created a User row for this mock identity — clean it up too.
    await prisma.user.deleteMany({ where: { email: mismatchedEmail } });
    await prisma.invitation.delete({ where: { id: invitation.id } });
  });

  it("an invitation tampered to role OWNER is rejected outright", async () => {
    const invitation = await createInvitation(fixtures, { status: "PENDING", role: Role.OWNER });
    setMockAuthUser({ id: randomUUID(), email: invitation.email });

    const result = await acceptInvitationAction(invitation.token);

    expect(result.error).toBe("This invitation cannot be accepted.");

    // getOrCreateUser() runs before the role check, so it already created
    // a User row for this mock identity — clean it up too.
    await prisma.user.deleteMany({ where: { email: invitation.email } });
    await prisma.invitation.delete({ where: { id: invitation.id } });
  });
});

/**
 * Free Public Beta, Slice 2 (Expired Invitations / Member Capacity).
 * resendInvitationAction's own, previously-nonexistent capacity guard —
 * the Phase A audit's confirmed critical finding: once expired
 * invitations stop reserving seats, resend is exactly the operation that
 * would otherwise silently create a new, unverified reservation.
 *
 * Every test here uses its own freshly created, isolated organization
 * (never fixtures.orgA, which the describe block above already shares
 * across many unrelated tests and which has no Subscription row of its
 * own — mixing a precisely-controlled capacity scenario into that shared
 * fixture would risk bleeding into those other tests). FREE_BETA_MODE is
 * explicitly set only within this block and restored in afterEach, so no
 * other test file or earlier test in this same file is affected.
 */
describe("resendInvitationAction — Free Public Beta, Slice 2 (resend capacity guard)", () => {
  const ORIGINAL_FREE_BETA_MODE = process.env.FREE_BETA_MODE;

  afterEach(() => {
    resetAuthMock();
    if (ORIGINAL_FREE_BETA_MODE === undefined) delete process.env.FREE_BETA_MODE;
    else process.env.FREE_BETA_MODE = ORIGINAL_FREE_BETA_MODE;
  });

  async function createCapacityOrg(realMemberCount: number) {
    const suffix = randomUUID().slice(0, 8);
    const owner = await prisma.user.create({
      data: { id: randomUUID(), email: testEmail(`lifecycle-capacity-owner-${suffix}`, TEST_EMAIL_DOMAIN), name: "Capacity Owner" },
    });
    const org = await prisma.organization.create({
      data: { name: `Capacity Org ${suffix}`, slug: `test-lifecycle-capacity-${suffix}` },
    });
    await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: Role.OWNER } });

    const extraMembers = await Promise.all(
      Array.from({ length: Math.max(realMemberCount - 1, 0) }, async (_, i) => {
        const member = await prisma.user.create({
          data: { id: randomUUID(), email: testEmail(`lifecycle-capacity-member-${suffix}-${i}`, TEST_EMAIL_DOMAIN), name: `Capacity Member ${i}` },
        });
        await prisma.membership.create({ data: { userId: member.id, organizationId: org.id, role: Role.MEMBER } });
        return member;
      }),
    );

    return { owner, org, extraMembers };
  }

  async function cleanupCapacityOrg(org: { id: string }, owner: { id: string }, extraMembers: { id: string }[]) {
    await prisma.invitation.deleteMany({ where: { organizationId: org.id } });
    await prisma.membership.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, ...extraMembers.map((m) => m.id)] } } });
  }

  it("F: resend of an expired invitation succeeds when the resulting total stays within capacity (4 occupied + 1 revived = 5)", async () => {
    const { owner, org, extraMembers } = await createCapacityOrg(4); // owner + 3 real members = 4 occupied
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: org.id,
        email: testEmail(`lifecycle-capacity-expired-f-${randomUUID().slice(0, 6)}`, TEST_EMAIL_DOMAIN),
        role: Role.MEMBER,
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() - 60_000), // already expired, reserves zero seats today
        invitedById: owner.id,
      },
    });

    process.env.FREE_BETA_MODE = "true";
    actAs(owner, org.id);
    const result = await resendInvitationAction(invitation.id);

    expect(result.error).toBeNull();
    const revived = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(revived.status).toBe("PENDING");
    expect(revived.expiresAt.getTime()).toBeGreaterThan(Date.now());

    await cleanupCapacityOrg(org, owner, extraMembers);
  });

  it("G: resend of an expired invitation is rejected when the organization is already at exactly 5 occupied seats — and does not create a new active reservation", async () => {
    const { owner, org, extraMembers } = await createCapacityOrg(5); // owner + 4 real members = 5, exactly at the Free Beta ceiling
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: org.id,
        email: testEmail(`lifecycle-capacity-expired-g-${randomUUID().slice(0, 6)}`, TEST_EMAIL_DOMAIN),
        role: Role.MEMBER,
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() - 60_000),
        invitedById: owner.id,
      },
    });
    const beforeToken = invitation.token;
    const beforeExpiresAt = invitation.expiresAt;

    process.env.FREE_BETA_MODE = "true";
    actAs(owner, org.id);
    const result = await resendInvitationAction(invitation.id);

    expect(result.error).toBe("Your plan's member limit has been reached.");
    const unchanged = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(unchanged.token).toBe(beforeToken); // never rotated
    expect(unchanged.expiresAt.getTime()).toBe(beforeExpiresAt.getTime()); // never refreshed
    expect(unchanged.status).toBe("PENDING"); // still its pre-resend (expired) state — no new active reservation

    await cleanupCapacityOrg(org, owner, extraMembers);
  });

  it("H: resend of an expired invitation is rejected when the organization already has more than 5 real members", async () => {
    const { owner, org, extraMembers } = await createCapacityOrg(8); // owner + 7 real members, well over the beta ceiling
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: org.id,
        email: testEmail(`lifecycle-capacity-expired-h-${randomUUID().slice(0, 6)}`, TEST_EMAIL_DOMAIN),
        role: Role.MEMBER,
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() - 60_000),
        invitedById: owner.id,
      },
    });

    process.env.FREE_BETA_MODE = "true";
    actAs(owner, org.id);
    const result = await resendInvitationAction(invitation.id);

    expect(result.error).toBe("Your plan's member limit has been reached.");
    // Every existing real membership is completely untouched.
    const membershipCount = await prisma.membership.count({ where: { organizationId: org.id } });
    expect(membershipCount).toBe(8);

    await cleanupCapacityOrg(org, owner, extraMembers);
  });

  it("I: resend of an ALREADY-VALID (unexpired) PENDING invitation remains allowed even when the organization is exactly at capacity — refreshing it never creates an additional reservation", async () => {
    const { owner, org, extraMembers } = await createCapacityOrg(4); // owner + 3 real members = 4
    // A 5th seat occupied by a still-valid pending invitation — the org
    // is now at exactly 5/5, with this invitation itself as the 5th seat.
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: org.id,
        email: testEmail(`lifecycle-capacity-valid-i-${randomUUID().slice(0, 6)}`, TEST_EMAIL_DOMAIN),
        role: Role.MEMBER,
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() + 60_000), // still valid, not expired
        invitedById: owner.id,
      },
    });

    process.env.FREE_BETA_MODE = "true";
    actAs(owner, org.id);
    const result = await resendInvitationAction(invitation.id);

    // Allowed — this resend does not change how many seats are occupied
    // (still exactly this one invitation's own seat, now with a fresh
    // token/expiry), so the conditional capacity check correctly never
    // runs for it at all.
    expect(result.error).toBeNull();
    const refreshed = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(refreshed.status).toBe("PENDING");
    expect(refreshed.token).not.toBe(invitation.token);

    await cleanupCapacityOrg(org, owner, extraMembers);
  });

  it("J: resend of a REVOKED invitation is subject to the same fresh capacity check as an expired one", async () => {
    const { owner, org, extraMembers } = await createCapacityOrg(5); // exactly at capacity already
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: org.id,
        email: testEmail(`lifecycle-capacity-revoked-j-${randomUUID().slice(0, 6)}`, TEST_EMAIL_DOMAIN),
        role: Role.MEMBER,
        token: randomUUID(),
        status: "REVOKED",
        expiresAt: new Date(Date.now() + 60_000), // irrelevant while REVOKED — reserves zero seats today
        invitedById: owner.id,
      },
    });

    process.env.FREE_BETA_MODE = "true";
    actAs(owner, org.id);
    const result = await resendInvitationAction(invitation.id);

    expect(result.error).toBe("Your plan's member limit has been reached.");
    const unchanged = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(unchanged.status).toBe("REVOKED"); // never reactivated

    await cleanupCapacityOrg(org, owner, extraMembers);
  });

  it("K: a successful resend of a previously-expired invitation occupies exactly one seat — a second, repeated resend of that same now-valid invitation does not consume a second seat", async () => {
    const { owner, org, extraMembers } = await createCapacityOrg(4); // owner + 3 real members = 4, headroom for exactly one more
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: org.id,
        email: testEmail(`lifecycle-capacity-repeat-k-${randomUUID().slice(0, 6)}`, TEST_EMAIL_DOMAIN),
        role: Role.MEMBER,
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() - 60_000), // starts expired
        invitedById: owner.id,
      },
    });

    process.env.FREE_BETA_MODE = "true";
    actAs(owner, org.id);

    const first = await resendInvitationAction(invitation.id);
    expect(first.error).toBeNull(); // 4 -> 5, exactly fills the last seat

    // A second, immediate resend of the SAME invitation — now already a
    // valid, unexpired PENDING row — must stay allowed (case I's own
    // reasoning) even though the organization is now at exactly 5/5,
    // because it still doesn't create a second reservation for the same
    // row.
    const second = await resendInvitationAction(invitation.id);
    expect(second.error).toBeNull();

    const finalCount = await prisma.invitation.count({
      where: { organizationId: org.id, status: "PENDING", expiresAt: { gt: new Date() } },
    });
    expect(finalCount).toBe(1); // still exactly one reserved seat, not two

    await cleanupCapacityOrg(org, owner, extraMembers);
  });
});
