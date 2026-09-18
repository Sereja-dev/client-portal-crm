import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/enums";
import { getEffectivePermission } from "@/lib/permissions/resolver";
import { changeRoleAction } from "@/app/(dashboard)/team/actions";
import { acceptInvitationAction } from "@/app/invite/[token]/actions";
import { testEmail, testSlug } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";
import { actAs, setMockAuthUser, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal, resetNavigationMock } from "../../support/navigation-mock";

/**
 * Roles / Permissions V1 — role-change and invitation interaction
 * regression coverage (locked spec §17/§18/§27). Overrides are role-
 * scoped, never membership-scoped, so a Membership.role change or a
 * fresh invitation acceptance must immediately pick up whatever the
 * CURRENT role-level override set says, with no per-membership state to
 * migrate and no permission snapshot anywhere on Invitation.
 */

async function createOrgWithOwnerAndTarget(): Promise<{
  orgId: string;
  owner: { id: string; email: string; name: string };
  target: { id: string; email: string; name: string };
}> {
  const org = await prisma.organization.create({
    data: { name: "Role Change Test Org", slug: testSlug(`permissions-rolechange-${randomUUID().slice(0, 8)}`) },
  });
  const ownerId = randomUUID();
  const owner = await prisma.user.create({
    data: { id: ownerId, email: testEmail(`rc-owner-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN), name: "Owner" },
  });
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: Role.OWNER } });

  const targetId = randomUUID();
  const target = await prisma.user.create({
    data: { id: targetId, email: testEmail(`rc-target-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN), name: "Target" },
  });
  await prisma.membership.create({ data: { userId: target.id, organizationId: org.id, role: Role.MEMBER } });

  return { orgId: org.id, owner, target };
}

async function cleanupOrg(orgId: string, userIds: readonly string[]): Promise<void> {
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
}

describe("Role-change interaction", () => {
  it("a member's effective permission immediately follows a MEMBER -> ADMIN role change, and back", async () => {
    const { orgId, owner, target } = await createOrgWithOwnerAndTarget();
    try {
      // MEMBER override grants TAGS_MANAGE; ADMIN has no override, so ADMIN's own default (true) already differs.
      await prisma.rolePermissionOverride.create({
        data: { organizationId: orgId, role: Role.MEMBER, permissionKey: "TAGS_MANAGE", allowed: true },
      });
      await prisma.rolePermissionOverride.create({
        data: { organizationId: orgId, role: Role.ADMIN, permissionKey: "ANALYTICS_VIEW", allowed: false },
      });

      // As MEMBER: TAGS_MANAGE follows the MEMBER override (true); ANALYTICS_VIEW follows the MEMBER default (false).
      expect(await getEffectivePermission({ organizationId: orgId, role: "MEMBER", permissionKey: "TAGS_MANAGE" })).toBe(
        true,
      );

      actAs(owner, orgId);
      const membershipId = (
        await prisma.membership.findUniqueOrThrow({ where: { userId_organizationId: { userId: target.id, organizationId: orgId } } })
      ).id;
      const promote = await changeRoleAction(membershipId, Role.ADMIN);
      expect(promote.error).toBeNull();

      // Now ADMIN: TAGS_MANAGE follows the ADMIN default (true, no ADMIN override for this key) -- the OLD MEMBER
      // override for TAGS_MANAGE no longer applies to this person at all. ANALYTICS_VIEW follows the ADMIN
      // override (false) -- immediately, no re-login, no per-membership migration.
      const target_role = await prisma.membership.findUniqueOrThrow({
        where: { userId_organizationId: { userId: target.id, organizationId: orgId } },
      });
      expect(target_role.role).toBe(Role.ADMIN);
      expect(await getEffectivePermission({ organizationId: orgId, role: target_role.role, permissionKey: "ANALYTICS_VIEW" })).toBe(
        false,
      );

      // The old MEMBER override itself is untouched -- it still applies to any OTHER member holding MEMBER.
      expect(await getEffectivePermission({ organizationId: orgId, role: "MEMBER", permissionKey: "TAGS_MANAGE" })).toBe(
        true,
      );

      // Demote back to MEMBER -- immediately picks the MEMBER override set back up.
      const demote = await changeRoleAction(membershipId, Role.MEMBER);
      expect(demote.error).toBeNull();
      expect(await getEffectivePermission({ organizationId: orgId, role: "MEMBER", permissionKey: "TAGS_MANAGE" })).toBe(
        true,
      );
    } finally {
      await cleanupOrg(orgId, [owner.id, target.id]);
    }
  });
});

describe("Ownership transfer interaction", () => {
  it("the new OWNER gets full immutable access regardless of override rows; the former OWNER, now ADMIN, immediately follows ADMIN overrides", async () => {
    const { orgId, owner, target } = await createOrgWithOwnerAndTarget();
    try {
      await prisma.rolePermissionOverride.create({
        data: { organizationId: orgId, role: Role.ADMIN, permissionKey: "ANALYTICS_VIEW", allowed: false },
      });

      actAs(owner, orgId);
      const membershipId = (
        await prisma.membership.findUniqueOrThrow({ where: { userId_organizationId: { userId: target.id, organizationId: orgId } } })
      ).id;
      // target is currently MEMBER -- transfer ownership to them directly.
      const transfer = await changeRoleAction(membershipId, Role.OWNER);
      expect(transfer.error).toBeNull();

      // New OWNER: unconditionally true, ignoring the ADMIN override entirely (it was never targeted at OWNER).
      expect(await getEffectivePermission({ organizationId: orgId, role: "OWNER", permissionKey: "ANALYTICS_VIEW" })).toBe(
        true,
      );

      // Former OWNER is now ADMIN -- immediately follows the ADMIN override (false).
      const formerOwnerMembership = await prisma.membership.findUniqueOrThrow({
        where: { userId_organizationId: { userId: owner.id, organizationId: orgId } },
      });
      expect(formerOwnerMembership.role).toBe(Role.ADMIN);
      expect(await getEffectivePermission({ organizationId: orgId, role: "ADMIN", permissionKey: "ANALYTICS_VIEW" })).toBe(
        false,
      );
    } finally {
      await cleanupOrg(orgId, [owner.id, target.id]);
    }
  });
});

describe("Invitation interaction", () => {
  it("permission changes made to a role before an invitation is accepted are reflected immediately after acceptance -- no snapshot on Invitation", async () => {
    const org = await prisma.organization.create({
      data: { name: "Invitation Permissions Test Org", slug: testSlug(`permissions-invite-${randomUUID().slice(0, 8)}`) },
    });
    const ownerId = randomUUID();
    const owner = await prisma.user.create({
      data: { id: ownerId, email: testEmail(`inv-owner-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN), name: "Owner" },
    });
    await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: Role.OWNER } });

    const inviteeEmail = testEmail(`inv-invitee-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN);
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: org.id,
        email: inviteeEmail,
        role: Role.MEMBER,
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        invitedById: owner.id,
      },
    });

    try {
      // Grant MEMBER a permission BEFORE the invitation is ever accepted.
      await prisma.rolePermissionOverride.create({
        data: { organizationId: org.id, role: Role.MEMBER, permissionKey: "DATA_EXPORT", allowed: true },
      });

      const authUserId = randomUUID();
      setMockAuthUser({ id: authUserId, email: inviteeEmail });
      await expect(acceptInvitationAction(invitation.token)).rejects.toThrow(RedirectSignal);

      const membership = await prisma.membership.findUniqueOrThrow({
        where: { userId_organizationId: { userId: authUserId, organizationId: org.id } },
      });
      expect(membership.role).toBe(Role.MEMBER);

      // No permission snapshot anywhere on Invitation -- the accepted member's effective permissions
      // are evaluated live, and already reflect the pre-acceptance grant.
      expect(await getEffectivePermission({ organizationId: org.id, role: "MEMBER", permissionKey: "DATA_EXPORT" })).toBe(
        true,
      );

      await prisma.membership.deleteMany({ where: { userId: authUserId } });
      await prisma.user.deleteMany({ where: { id: authUserId } });
    } finally {
      resetAuthMock();
      resetNavigationMock();
      await cleanupOrg(org.id, [owner.id]);
    }
  });
});
