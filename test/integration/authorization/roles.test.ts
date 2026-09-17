import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/enums";
import {
  inviteMemberAction,
  changeRoleAction,
  removeMemberAction,
  leaveOrganizationAction,
} from "@/app/(dashboard)/team/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal, resetNavigationMock } from "../../support/navigation-mock";
import { testEmail, testSlug } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";

// Team Ownership Invariant Hardening (post-audit correction) — the
// describe blocks below add the negative/security coverage the audit
// found missing for changeRoleAction/removeMemberAction/
// leaveOrganizationAction. Each test builds its OWN disposable
// Organization + Users via createRoleFixtureOrg() rather than mutating
// the shared `fixtures` (owner/admin/member) above — several of these
// tests change roles or delete memberships outright, which would corrupt
// `fixtures` for every other test/file sharing it via beforeAll (not
// beforeEach).

type RoleFixtureUser = { id: string; email: string; name: string };

/** One disposable Organization with exactly one Membership per entry in `roles`, in order. */
async function createRoleFixtureOrg(
  runId: string,
  roles: readonly Role[],
): Promise<{ orgId: string; users: RoleFixtureUser[] }> {
  const org = await prisma.organization.create({
    data: { name: "Role Fixture Org", slug: testSlug(`role-fixture-${randomUUID().slice(0, 8)}`, runId) },
  });

  const users: RoleFixtureUser[] = [];
  for (let i = 0; i < roles.length; i++) {
    const id = randomUUID();
    const email = testEmail(`role-fixture-${i}-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN, runId);
    const user = await prisma.user.create({ data: { id, email, name: `Role Fixture ${i}` } });
    users.push({ id: user.id, email: user.email, name: user.name });
  }

  await prisma.membership.createMany({
    data: users.map((u, i) => ({ userId: u.id, organizationId: org.id, role: roles[i] })),
  });

  return { orgId: org.id, users };
}

/** Mirrors fixtures/seed.ts's own cleanupTestData: Organization cascades Membership/Invitation/Activity. */
async function cleanupRoleFixtureOrg(orgId: string, userIds: readonly string[]): Promise<void> {
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
}

async function membershipRole(userId: string, organizationId: string): Promise<Role | null> {
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
  return membership?.role ?? null;
}

async function membershipId(userId: string, organizationId: string): Promise<string> {
  const membership = await prisma.membership.findUniqueOrThrow({
    where: { userId_organizationId: { userId, organizationId } },
  });
  return membership.id;
}

async function ownerCount(organizationId: string): Promise<number> {
  return prisma.membership.count({ where: { organizationId, role: Role.OWNER } });
}

// Exercises the REAL, unmodified inviteMemberAction — only Supabase Auth
// (auth.getUser()) and next/headers' cookies() are mocked (see
// test/integration/setup-mocks.ts); the permission check, the Prisma
// upsert, and the Activity write inside it all run for real.

function inviteForm(email: string, role: "ADMIN" | "MEMBER" = "MEMBER"): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("role", role);
  return fd;
}

describe("membership role permissions — inviteMemberAction", () => {
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

  it("OWNER can invite a member", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const email = testEmail("invited-by-owner", TEST_EMAIL_DOMAIN, fixtures.runId);

    const result = await inviteMemberAction({ error: null }, inviteForm(email));

    expect(result.error).toBeNull();
    const invitation = await prisma.invitation.findFirst({ where: { email, organizationId: fixtures.orgA.id } });
    expect(invitation).not.toBeNull();
    expect(invitation?.status).toBe("PENDING");

    await prisma.invitation.deleteMany({ where: { email } });
  });

  it("ADMIN can invite a member", async () => {
    actAs(fixtures.admin, fixtures.orgA.id);
    const email = testEmail("invited-by-admin", TEST_EMAIL_DOMAIN, fixtures.runId);

    const result = await inviteMemberAction({ error: null }, inviteForm(email));

    expect(result.error).toBeNull();
    const invitation = await prisma.invitation.findFirst({ where: { email, organizationId: fixtures.orgA.id } });
    expect(invitation).not.toBeNull();

    await prisma.invitation.deleteMany({ where: { email } });
  });

  it("MEMBER is rejected with a permission error, and no Invitation row is created", async () => {
    actAs(fixtures.member, fixtures.orgA.id);
    const email = testEmail("invited-by-member", TEST_EMAIL_DOMAIN, fixtures.runId);

    const result = await inviteMemberAction({ error: null }, inviteForm(email));

    expect(result.error).toBe("You don't have permission to invite members.");
    const invitation = await prisma.invitation.findFirst({ where: { email } });
    expect(invitation).toBeNull();
  });

  it("a MEMBER's rejected invite creates no Activity row either", async () => {
    actAs(fixtures.member, fixtures.orgA.id);
    const email = testEmail("invited-by-member-2", TEST_EMAIL_DOMAIN, fixtures.runId);
    const beforeCount = await prisma.activity.count({ where: { organizationId: fixtures.orgA.id } });

    await inviteMemberAction({ error: null }, inviteForm(email));

    const afterCount = await prisma.activity.count({ where: { organizationId: fixtures.orgA.id } });
    expect(afterCount).toBe(beforeCount);
  });
});

describe("leaveOrganizationAction", () => {
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

  it("MEMBER leaves successfully: membership deleted, exactly one MEMBER_LEFT Activity, org still has exactly one OWNER", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER, Role.ADMIN, Role.MEMBER]);
    const [, , member] = users;
    const leavingMembershipId = await membershipId(member.id, orgId);
    actAs(member, orgId);

    await expect(leaveOrganizationAction()).rejects.toThrow(RedirectSignal);

    expect(await membershipRole(member.id, orgId)).toBeNull();
    const activityCount = await prisma.activity.count({
      where: { organizationId: orgId, entityId: leavingMembershipId, action: "MEMBER_LEFT" },
    });
    expect(activityCount).toBe(1);
    expect(await ownerCount(orgId)).toBe(1);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });

  it("ADMIN leaves successfully: membership deleted, exactly one MEMBER_LEFT Activity, org still has exactly one OWNER", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER, Role.ADMIN]);
    const [, admin] = users;
    const leavingMembershipId = await membershipId(admin.id, orgId);
    actAs(admin, orgId);

    await expect(leaveOrganizationAction()).rejects.toThrow(RedirectSignal);

    expect(await membershipRole(admin.id, orgId)).toBeNull();
    const activityCount = await prisma.activity.count({
      where: { organizationId: orgId, entityId: leavingMembershipId, action: "MEMBER_LEFT" },
    });
    expect(activityCount).toBe(1);
    expect(await ownerCount(orgId)).toBe(1);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });

  it("a sole OWNER attempting to leave is rejected with the exact canonical message; membership remains; exactly one OWNER remains; no MEMBER_LEFT Activity", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER]);
    const [owner] = users;
    actAs(owner, orgId);

    await expect(leaveOrganizationAction()).rejects.toThrow(
      "You're the only owner. Transfer ownership to someone else before leaving.",
    );

    expect(await membershipRole(owner.id, orgId)).toBe(Role.OWNER);
    expect(await ownerCount(orgId)).toBe(1);
    const activityCount = await prisma.activity.count({
      where: { organizationId: orgId, action: "MEMBER_LEFT" },
    });
    expect(activityCount).toBe(0);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });

  it("after ownership has already been transferred away, the former OWNER (now ADMIN) can leave normally -- the new OWNER remains, exactly one OWNER remains", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER, Role.ADMIN]);
    const [formerOwner, newOwner] = users;
    actAs(formerOwner, orgId);
    const transferResult = await changeRoleAction(await membershipId(newOwner.id, orgId), Role.OWNER);
    expect(transferResult.error).toBeNull();
    expect(await membershipRole(formerOwner.id, orgId)).toBe(Role.ADMIN);
    expect(await membershipRole(newOwner.id, orgId)).toBe(Role.OWNER);

    actAs(formerOwner, orgId);
    await expect(leaveOrganizationAction()).rejects.toThrow(RedirectSignal);

    expect(await membershipRole(formerOwner.id, orgId)).toBeNull();
    expect(await membershipRole(newOwner.id, orgId)).toBe(Role.OWNER);
    expect(await ownerCount(orgId)).toBe(1);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });

  /**
   * Team Ownership Invariant Hardening regression. The audited bug: the
   * previous leaveOrganizationAction branched on membership.role captured
   * BEFORE its own $transaction opened — a concurrent changeRoleAction
   * ownership transfer landing between that read and the delete could
   * promote the caller to OWNER without the sole-OWNER check ever
   * running, deleting the organization's only OWNER.
   *
   * The literal race requires two genuinely overlapping database
   * transactions. This repo's local/test Postgres (PGlite, see
   * src/lib/prisma.ts) runs with pg.Pool({max: 1}) — only one physical
   * connection exists, so two "concurrent" prisma.$transaction() calls in
   * THIS harness always run fully serialized (one entire transaction
   * commits or rolls back before the other's first statement executes).
   * That means the exact read-before-transfer / delete-after-transfer
   * interleaving cannot be constructed here — a limitation of this local
   * test harness, not evidence about real, networked Postgres. This is
   * the same, pre-existing limitation already documented for the
   * Industry Presets concurrency tests. This test does NOT claim to
   * reproduce genuine multi-connection interleaving.
   *
   * What IS deterministically reproducible below, without any flakiness:
   * the exact scenario the bug was about — a caller who was ADMIN a
   * moment ago and is now, via a completed ownership transfer, the
   * organization's sole OWNER — must have their leave attempt rejected.
   * The fix's correctness against the underlying race (a transfer's
   * commit landing between an outer role read and a later delete, inside
   * ONE leaveOrganizationAction call) rests on the Postgres MVCC/
   * EvalPlanQual argument documented in leaveOrganizationAction's own
   * header comment, not on this test alone — this test locks in the
   * resulting, externally-observable guarantee instead: leave is decided
   * by live database state at delete time, never by a role value read
   * earlier in the request.
   */
  it("a caller freshly promoted to sole OWNER by a just-completed ownership transfer cannot leave -- immune to any stale ADMIN-era role reading", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER, Role.ADMIN]);
    const [originalOwner, promoted] = users;

    // Mirrors exactly what getCurrentMembership() would have returned for
    // `promoted` before the transfer below — id/organizationId, the only
    // two fields the fixed delete's WHERE clause depends on, are stable
    // across a role change, so capturing this id here (before promotion)
    // and using it again after is a faithful stand-in for "whatever a
    // pre-transaction snapshot would have held."
    const preTransferMembershipId = await membershipId(promoted.id, orgId);

    actAs(originalOwner, orgId);
    const transferResult = await changeRoleAction(preTransferMembershipId, Role.OWNER);
    expect(transferResult.error).toBeNull();
    expect(await membershipRole(promoted.id, orgId)).toBe(Role.OWNER);
    expect(await ownerCount(orgId)).toBe(1);

    actAs(promoted, orgId);
    await expect(leaveOrganizationAction()).rejects.toThrow(
      "You're the only owner. Transfer ownership to someone else before leaving.",
    );

    expect(await membershipRole(promoted.id, orgId)).toBe(Role.OWNER);
    expect(await membershipRole(originalOwner.id, orgId)).toBe(Role.ADMIN);
    expect(await ownerCount(orgId)).toBe(1);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });
});

describe("changeRoleAction — negative/security matrix", () => {
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

  it("MEMBER cannot change any role; DB unchanged; no Activity", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER, Role.ADMIN, Role.MEMBER]);
    const [, admin, member] = users;
    const targetId = await membershipId(admin.id, orgId);
    const activityBefore = await prisma.activity.count({ where: { organizationId: orgId } });
    actAs(member, orgId);

    const result = await changeRoleAction(targetId, Role.MEMBER);

    expect(result.error).toBe("You don't have permission to change roles.");
    expect(await membershipRole(admin.id, orgId)).toBe(Role.ADMIN);
    expect(await prisma.activity.count({ where: { organizationId: orgId } })).toBe(activityBefore);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });

  it("ADMIN cannot change any role; DB unchanged; no Activity", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER, Role.ADMIN, Role.MEMBER]);
    const [, admin, member] = users;
    const targetId = await membershipId(member.id, orgId);
    const activityBefore = await prisma.activity.count({ where: { organizationId: orgId } });
    actAs(admin, orgId);

    const result = await changeRoleAction(targetId, Role.ADMIN);

    expect(result.error).toBe("You don't have permission to change roles.");
    expect(await membershipRole(member.id, orgId)).toBe(Role.MEMBER);
    expect(await prisma.activity.count({ where: { organizationId: orgId } })).toBe(activityBefore);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });

  it("OWNER cannot change their own role directly; DB unchanged; no Activity", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER]);
    const [owner] = users;
    const ownMembershipId = await membershipId(owner.id, orgId);
    const activityBefore = await prisma.activity.count({ where: { organizationId: orgId } });
    actAs(owner, orgId);

    const result = await changeRoleAction(ownMembershipId, Role.ADMIN);

    expect(result.error).toBe("You can't change your own role.");
    expect(await membershipRole(owner.id, orgId)).toBe(Role.OWNER);
    expect(await prisma.activity.count({ where: { organizationId: orgId } })).toBe(activityBefore);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });

  it("OWNER promotes MEMBER -> ADMIN: succeeds, exactly one ROLE_CHANGED Activity", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER, Role.MEMBER]);
    const [owner, member] = users;
    const targetId = await membershipId(member.id, orgId);
    actAs(owner, orgId);

    const result = await changeRoleAction(targetId, Role.ADMIN);

    expect(result.error).toBeNull();
    expect(await membershipRole(member.id, orgId)).toBe(Role.ADMIN);
    const activityCount = await prisma.activity.count({
      where: { organizationId: orgId, entityId: targetId, action: "ROLE_CHANGED" },
    });
    expect(activityCount).toBe(1);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });

  it("OWNER demotes ADMIN -> MEMBER: succeeds, exactly one ROLE_CHANGED Activity", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER, Role.ADMIN]);
    const [owner, admin] = users;
    const targetId = await membershipId(admin.id, orgId);
    actAs(owner, orgId);

    const result = await changeRoleAction(targetId, Role.MEMBER);

    expect(result.error).toBeNull();
    expect(await membershipRole(admin.id, orgId)).toBe(Role.MEMBER);
    const activityCount = await prisma.activity.count({
      where: { organizationId: orgId, entityId: targetId, action: "ROLE_CHANGED" },
    });
    expect(activityCount).toBe(1);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });

  it("ownership transfer: previous OWNER becomes exactly ADMIN, target becomes exactly OWNER, exactly one OWNER remains, exactly one OWNERSHIP_TRANSFERRED Activity", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER, Role.ADMIN]);
    const [owner, admin] = users;
    const targetId = await membershipId(admin.id, orgId);
    actAs(owner, orgId);

    const result = await changeRoleAction(targetId, Role.OWNER);

    expect(result.error).toBeNull();
    expect(await membershipRole(owner.id, orgId)).toBe(Role.ADMIN);
    expect(await membershipRole(admin.id, orgId)).toBe(Role.OWNER);
    expect(await ownerCount(orgId)).toBe(1);
    const transferCount = await prisma.activity.count({
      where: { organizationId: orgId, action: "OWNERSHIP_TRANSFERRED" },
    });
    expect(transferCount).toBe(1);
    // One combined event for the whole transfer -- never two separate
    // ROLE_CHANGED rows for the demoted/promoted memberships.
    const roleChangedCount = await prisma.activity.count({
      where: { organizationId: orgId, action: "ROLE_CHANGED" },
    });
    expect(roleChangedCount).toBe(0);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });

  it("a foreign organization's membership id is treated as not found; DB unchanged", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER]);
    const { orgId: otherOrgId, users: otherUsers } = await createRoleFixtureOrg(fixtures.runId, [Role.MEMBER]);
    const [owner] = users;
    const foreignMembershipId = await membershipId(otherUsers[0].id, otherOrgId);
    actAs(owner, orgId);

    const result = await changeRoleAction(foreignMembershipId, Role.ADMIN);

    expect(result.error).toBe("Member not found.");
    expect(await membershipRole(otherUsers[0].id, otherOrgId)).toBe(Role.MEMBER);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
    await cleanupRoleFixtureOrg(
      otherOrgId,
      otherUsers.map((u) => u.id),
    );
  });

  it("a nonexistent membership id is treated as not found", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER]);
    const [owner] = users;
    actAs(owner, orgId);

    const result = await changeRoleAction(randomUUID(), Role.ADMIN);

    expect(result.error).toBe("Member not found.");

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });
});

describe("removeMemberAction — negative/security matrix", () => {
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

  it("MEMBER cannot remove anyone", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER, Role.ADMIN, Role.MEMBER]);
    const [, admin, member] = users;
    const targetId = await membershipId(admin.id, orgId);
    actAs(member, orgId);

    await expect(removeMemberAction(targetId)).rejects.toThrow("You don't have permission to remove members.");
    expect(await membershipRole(admin.id, orgId)).toBe(Role.ADMIN);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });

  it("ADMIN cannot remove anyone", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER, Role.ADMIN, Role.MEMBER]);
    const [, admin, member] = users;
    const targetId = await membershipId(member.id, orgId);
    actAs(admin, orgId);

    await expect(removeMemberAction(targetId)).rejects.toThrow("You don't have permission to remove members.");
    expect(await membershipRole(member.id, orgId)).toBe(Role.MEMBER);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });

  it("OWNER cannot remove themselves", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER]);
    const [owner] = users;
    const ownMembershipId = await membershipId(owner.id, orgId);
    actAs(owner, orgId);

    await expect(removeMemberAction(ownMembershipId)).rejects.toThrow(
      'Use "Leave organization" to remove yourself.',
    );
    expect(await membershipRole(owner.id, orgId)).toBe(Role.OWNER);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });

  it("a foreign organization's membership id is treated as not found", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER]);
    const { orgId: otherOrgId, users: otherUsers } = await createRoleFixtureOrg(fixtures.runId, [Role.MEMBER]);
    const [owner] = users;
    const foreignMembershipId = await membershipId(otherUsers[0].id, otherOrgId);
    actAs(owner, orgId);

    await expect(removeMemberAction(foreignMembershipId)).rejects.toThrow("Member not found.");
    expect(await membershipRole(otherUsers[0].id, otherOrgId)).toBe(Role.MEMBER);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
    await cleanupRoleFixtureOrg(
      otherOrgId,
      otherUsers.map((u) => u.id),
    );
  });

  it("a nonexistent membership id is treated as not found", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER]);
    const [owner] = users;
    actAs(owner, orgId);

    await expect(removeMemberAction(randomUUID())).rejects.toThrow("Member not found.");

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });

  it("OWNER can remove a MEMBER: membership deleted, exactly one MEMBER_REMOVED Activity, owner invariant intact", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER, Role.MEMBER]);
    const [owner, member] = users;
    const targetId = await membershipId(member.id, orgId);
    actAs(owner, orgId);

    await removeMemberAction(targetId);

    expect(await membershipRole(member.id, orgId)).toBeNull();
    const activityCount = await prisma.activity.count({
      where: { organizationId: orgId, entityId: targetId, action: "MEMBER_REMOVED" },
    });
    expect(activityCount).toBe(1);
    expect(await ownerCount(orgId)).toBe(1);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });

  it("OWNER can remove an ADMIN: membership deleted, exactly one MEMBER_REMOVED Activity, owner invariant intact", async () => {
    const { orgId, users } = await createRoleFixtureOrg(fixtures.runId, [Role.OWNER, Role.ADMIN]);
    const [owner, admin] = users;
    const targetId = await membershipId(admin.id, orgId);
    actAs(owner, orgId);

    await removeMemberAction(targetId);

    expect(await membershipRole(admin.id, orgId)).toBeNull();
    const activityCount = await prisma.activity.count({
      where: { organizationId: orgId, entityId: targetId, action: "MEMBER_REMOVED" },
    });
    expect(activityCount).toBe(1);
    expect(await ownerCount(orgId)).toBe(1);

    await cleanupRoleFixtureOrg(
      orgId,
      users.map((u) => u.id),
    );
  });
});
