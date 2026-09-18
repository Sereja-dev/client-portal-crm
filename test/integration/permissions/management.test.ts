import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createActivity } from "@/lib/activity/create-activity";
import { Role } from "@/generated/prisma/enums";
import { PERMISSION_KEYS, getDefaultPermission } from "@/lib/permissions/catalog";
import { getEffectivePermissionSet } from "@/lib/permissions/resolver";
import { updateRolePermissionsAction } from "@/app/(dashboard)/team/permissions/actions";
import { testEmail, testSlug } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";
import { actAs, resetAuthMock } from "../../support/auth-mock";

// Same technique test/integration/industry-presets/apply.test.ts already
// established for forcing a real, unexpected mid-transaction failure --
// wraps the real createActivity in a spy so exactly one test can force it
// to reject, proving the override deleteMany/createMany above it rolls
// back too. Every other test in this file gets the real, unmocked
// createActivity (mockImplementationOnce below only fires once).
vi.mock("@/lib/activity/create-activity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/activity/create-activity")>();
  return { ...actual, createActivity: vi.fn(actual.createActivity) };
});

/**
 * Roles / Permissions V1 — updateRolePermissionsAction, the one
 * authoritative management Server Action (locked spec §13/§14/§24).
 * Exercises the REAL, unmodified action end-to-end (auth check ->
 * validation -> transaction -> Activity), the same "only Supabase Auth/
 * cookies are mocked" discipline every other integration test in this
 * suite already follows. Each test builds its own disposable
 * Organization + OWNER/ADMIN/MEMBER trio rather than sharing fixtures
 * across tests, since several of these tests mutate RolePermissionOverride
 * state that must never bleed between tests.
 */

type RoleTrioUser = { id: string; email: string; name: string };

async function createRoleTrio(): Promise<{ orgId: string; owner: RoleTrioUser; admin: RoleTrioUser; member: RoleTrioUser }> {
  const org = await prisma.organization.create({
    data: { name: "Permissions Management Test Org", slug: testSlug(`permissions-mgmt-${randomUUID().slice(0, 8)}`) },
  });

  async function makeUser(label: string, role: Role): Promise<RoleTrioUser> {
    const id = randomUUID();
    const email = testEmail(`permissions-${label}-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN);
    const user = await prisma.user.create({ data: { id, email, name: `Permissions ${label}` } });
    await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role } });
    return { id: user.id, email: user.email, name: user.name };
  }

  const [owner, admin, member] = await Promise.all([
    makeUser("owner", Role.OWNER),
    makeUser("admin", Role.ADMIN),
    makeUser("member", Role.MEMBER),
  ]);

  return { orgId: org.id, owner, admin, member };
}

async function cleanupRoleTrio(orgId: string, userIds: readonly string[]): Promise<void> {
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
}

/** Builds a full 9-key submission, starting from `baselineRole`'s own catalog defaults (so "untouched" keys in a test's `overrides` genuinely mean "left at the target role's real default", not an unrelated role's). */
function fullPermissionState(
  baselineRole: "ADMIN" | "MEMBER",
  overrides: Partial<Record<(typeof PERMISSION_KEYS)[number], boolean>> = {},
) {
  const state = {} as Record<(typeof PERMISSION_KEYS)[number], boolean>;
  for (const key of PERMISSION_KEYS) {
    state[key] = getDefaultPermission(baselineRole, key);
  }
  return { ...state, ...overrides };
}

describe("updateRolePermissionsAction", () => {
  afterEach(() => {
    resetAuthMock();
    vi.mocked(createActivity).mockClear();
  });

  it("OWNER can modify ADMIN permissions", async () => {
    const { orgId, owner, admin, member } = await createRoleTrio();
    try {
      actAs(owner, orgId);
      const result = await updateRolePermissionsAction(
        Role.ADMIN,
        fullPermissionState(Role.ADMIN, { ANALYTICS_VIEW: false, TAGS_MANAGE: false }),
      );
      expect(result.error).toBeNull();

      const set = await getEffectivePermissionSet({ organizationId: orgId, role: "ADMIN" });
      expect(set.ANALYTICS_VIEW).toBe(false);
      expect(set.TAGS_MANAGE).toBe(false);
      expect(set.REPORTS_VIEW).toBe(true); // untouched key stays at its default
    } finally {
      await cleanupRoleTrio(orgId, [owner.id, admin.id, member.id]);
    }
  });

  it("OWNER can modify MEMBER permissions", async () => {
    const { orgId, owner, admin, member } = await createRoleTrio();
    try {
      actAs(owner, orgId);
      const result = await updateRolePermissionsAction(
        Role.MEMBER,
        fullPermissionState(Role.MEMBER, { INDUSTRY_PRESETS_APPLY: true }),
      );
      expect(result.error).toBeNull();

      const set = await getEffectivePermissionSet({ organizationId: orgId, role: "MEMBER" });
      expect(set.INDUSTRY_PRESETS_APPLY).toBe(true);
      expect(set.TAGS_MANAGE).toBe(false); // untouched key stays at its default
    } finally {
      await cleanupRoleTrio(orgId, [owner.id, admin.id, member.id]);
    }
  });

  it("ADMIN cannot manage permissions", async () => {
    const { orgId, owner, admin, member } = await createRoleTrio();
    try {
      actAs(admin, orgId);
      const result = await updateRolePermissionsAction(Role.MEMBER, fullPermissionState(Role.MEMBER, { TAGS_MANAGE: true }));
      expect(result.error).toBe("Roles & permissions can only be managed by the organization owner.");

      const count = await prisma.rolePermissionOverride.count({ where: { organizationId: orgId } });
      expect(count).toBe(0);
    } finally {
      await cleanupRoleTrio(orgId, [owner.id, admin.id, member.id]);
    }
  });

  it("MEMBER cannot manage permissions", async () => {
    const { orgId, owner, admin, member } = await createRoleTrio();
    try {
      actAs(member, orgId);
      const result = await updateRolePermissionsAction(Role.ADMIN, fullPermissionState(Role.ADMIN, { TAGS_MANAGE: false }));
      expect(result.error).toBe("Roles & permissions can only be managed by the organization owner.");

      const count = await prisma.rolePermissionOverride.count({ where: { organizationId: orgId } });
      expect(count).toBe(0);
    } finally {
      await cleanupRoleTrio(orgId, [owner.id, admin.id, member.id]);
    }
  });

  it("OWNER submitted as the target role is rejected", async () => {
    const { orgId, owner, admin, member } = await createRoleTrio();
    try {
      actAs(owner, orgId);
      const result = await updateRolePermissionsAction(Role.OWNER, fullPermissionState(Role.ADMIN));
      expect(result.error).toBe("Permissions can only be configured for Admin or Member.");

      const count = await prisma.rolePermissionOverride.count({ where: { organizationId: orgId } });
      expect(count).toBe(0);
    } finally {
      await cleanupRoleTrio(orgId, [owner.id, admin.id, member.id]);
    }
  });

  it("an unknown permission key in the submitted state is rejected, no partial write", async () => {
    const { orgId, owner, admin, member } = await createRoleTrio();
    try {
      actAs(owner, orgId);
      const malformed = { ...fullPermissionState(Role.ADMIN), NOT_A_REAL_KEY: true } as unknown;
      const result = await updateRolePermissionsAction(Role.ADMIN, malformed);
      expect(result.error).toBe("Could not save permissions. Please reload and try again.");

      const count = await prisma.rolePermissionOverride.count({ where: { organizationId: orgId } });
      expect(count).toBe(0);
    } finally {
      await cleanupRoleTrio(orgId, [owner.id, admin.id, member.id]);
    }
  });

  it("a missing permission key in the submitted state is rejected", async () => {
    const { orgId, owner, admin, member } = await createRoleTrio();
    try {
      actAs(owner, orgId);
      const full = fullPermissionState(Role.ADMIN);
      const missingOneKey: Partial<typeof full> = { ...full };
      delete missingOneKey.ANALYTICS_VIEW;
      const result = await updateRolePermissionsAction(Role.ADMIN, missingOneKey);
      expect(result.error).toBe("Could not save permissions. Please reload and try again.");

      const count = await prisma.rolePermissionOverride.count({ where: { organizationId: orgId } });
      expect(count).toBe(0);
    } finally {
      await cleanupRoleTrio(orgId, [owner.id, admin.id, member.id]);
    }
  });

  it("a malformed (non-boolean) value is rejected", async () => {
    const { orgId, owner, admin, member } = await createRoleTrio();
    try {
      actAs(owner, orgId);
      const malformed = { ...fullPermissionState(Role.ADMIN), TAGS_MANAGE: "yes" } as unknown;
      const result = await updateRolePermissionsAction(Role.ADMIN, malformed);
      expect(result.error).toBe("Could not save permissions. Please reload and try again.");
    } finally {
      await cleanupRoleTrio(orgId, [owner.id, admin.id, member.id]);
    }
  });

  it("reverting a key to its catalog default removes the override row (sparse invariant)", async () => {
    const { orgId, owner, admin, member } = await createRoleTrio();
    try {
      actAs(owner, orgId);
      await updateRolePermissionsAction(Role.ADMIN, fullPermissionState(Role.ADMIN, { ANALYTICS_VIEW: false }));
      let rows = await prisma.rolePermissionOverride.findMany({ where: { organizationId: orgId, role: Role.ADMIN } });
      expect(rows).toHaveLength(1);
      expect(rows[0].permissionKey).toBe("ANALYTICS_VIEW");

      // Restore ANALYTICS_VIEW back to its ADMIN default (true) -- the row must be deleted, not stored as allowed:true.
      await updateRolePermissionsAction(Role.ADMIN, fullPermissionState(Role.ADMIN, { ANALYTICS_VIEW: true }));
      rows = await prisma.rolePermissionOverride.findMany({ where: { organizationId: orgId, role: Role.ADMIN } });
      expect(rows).toHaveLength(0);
    } finally {
      await cleanupRoleTrio(orgId, [owner.id, admin.id, member.id]);
    }
  });

  it("a no-op save (submitted state already matches current effective state) writes no Activity row", async () => {
    const { orgId, owner, admin, member } = await createRoleTrio();
    try {
      actAs(owner, orgId);
      const before = await prisma.activity.count({ where: { organizationId: orgId, entityType: "ROLE_PERMISSION" } });
      const result = await updateRolePermissionsAction(Role.ADMIN, fullPermissionState(Role.ADMIN));
      expect(result.error).toBeNull();
      const after = await prisma.activity.count({ where: { organizationId: orgId, entityType: "ROLE_PERMISSION" } });
      expect(after).toBe(before);
    } finally {
      await cleanupRoleTrio(orgId, [owner.id, admin.id, member.id]);
    }
  });

  it("a successful save emits exactly one ROLE_PERMISSION / UPDATED Activity with accurate previous/new values", async () => {
    const { orgId, owner, admin, member } = await createRoleTrio();
    try {
      actAs(owner, orgId);
      await updateRolePermissionsAction(Role.MEMBER, fullPermissionState(Role.MEMBER, { TAGS_MANAGE: true, DATA_EXPORT: true }));

      const activities = await prisma.activity.findMany({
        where: { organizationId: orgId, entityType: "ROLE_PERMISSION", action: "UPDATED" },
      });
      expect(activities).toHaveLength(1);
      const metadata = activities[0].metadata as {
        targetRole: string;
        changes: { permissionKey: string; previousEffectiveValue: boolean; newEffectiveValue: boolean }[];
      };
      expect(metadata.targetRole).toBe("MEMBER");
      const changeKeys = metadata.changes.map((c) => c.permissionKey).sort();
      expect(changeKeys).toEqual(["DATA_EXPORT", "TAGS_MANAGE"]);
      for (const change of metadata.changes) {
        expect(change.previousEffectiveValue).toBe(false);
        expect(change.newEffectiveValue).toBe(true);
      }
    } finally {
      await cleanupRoleTrio(orgId, [owner.id, admin.id, member.id]);
    }
  });

  it("a forced Activity-write failure rolls back the override rows too -- the save is atomic", async () => {
    const { orgId, owner, admin, member } = await createRoleTrio();
    try {
      actAs(owner, orgId);
      vi.mocked(createActivity).mockImplementationOnce(() => {
        throw new Error("simulated failure");
      });

      await expect(
        updateRolePermissionsAction(Role.ADMIN, fullPermissionState(Role.ADMIN, { ANALYTICS_VIEW: false })),
      ).rejects.toThrow("simulated failure");

      // Neither the override row nor any Activity row was left behind --
      // the whole transaction (deleteMany + createMany + createActivity)
      // rolled back together.
      const overrideCount = await prisma.rolePermissionOverride.count({ where: { organizationId: orgId } });
      expect(overrideCount).toBe(0);
      const activityCount = await prisma.activity.count({ where: { organizationId: orgId, entityType: "ROLE_PERMISSION" } });
      expect(activityCount).toBe(0);
      const set = await getEffectivePermissionSet({ organizationId: orgId, role: "ADMIN" });
      expect(set.ANALYTICS_VIEW).toBe(true); // untouched -- still the catalog default
    } finally {
      await cleanupRoleTrio(orgId, [owner.id, admin.id, member.id]);
    }
  });

  /**
   * Team Ownership Invariant Hardening established the precedent this
   * test follows: PGlite (this repo's local/test Postgres, see
   * src/lib/prisma.ts) runs pg.Pool({max: 1}) -- only one physical
   * connection exists, so two "concurrent" prisma.$transaction() calls in
   * THIS harness always run fully serialized, never genuinely
   * overlapping. This test does NOT claim to reproduce real
   * multi-connection interleaving or prove the pg_advisory_xact_lock in
   * updateRolePermissions is what closes the race -- that correctness
   * argument rests on the documented Postgres locking behavior in
   * src/lib/permissions/management.ts's own header comment, verified by
   * reasoning about the actual statements involved, not by this test.
   *
   * What IS deterministically reproducible below: firing two overlapping
   * callers at the SAME role, each with a DIFFERENT deviating key, must
   * never produce a merged override set neither caller's own submitted
   * form state represented -- the final state matches exactly one
   * caller's full submission (clean last-writer-wins), never the union
   * of both (the write-skew anomaly the advisory lock exists to
   * prevent).
   */
  it("two overlapping saves to the same role never merge -- the final state matches exactly one submission, not the union of both", async () => {
    const { orgId, owner, admin, member } = await createRoleTrio();
    try {
      actAs(owner, orgId);
      const submissionA = fullPermissionState(Role.MEMBER, { ANALYTICS_VIEW: true });
      const submissionB = fullPermissionState(Role.MEMBER, { DATA_EXPORT: true });

      const [resultA, resultB] = await Promise.allSettled([
        updateRolePermissionsAction(Role.MEMBER, submissionA),
        updateRolePermissionsAction(Role.MEMBER, submissionB),
      ]);
      expect(resultA.status).toBe("fulfilled");
      expect(resultB.status).toBe("fulfilled");

      const set = await getEffectivePermissionSet({ organizationId: orgId, role: "MEMBER" });
      const matchesA = set.ANALYTICS_VIEW === true && set.DATA_EXPORT === false;
      const matchesB = set.ANALYTICS_VIEW === false && set.DATA_EXPORT === true;
      // Exactly one of the two full submissions won outright -- never
      // both true at once (which would mean the two writes merged
      // instead of one cleanly replacing the other).
      expect(matchesA || matchesB).toBe(true);
      expect(matchesA && matchesB).toBe(false);
    } finally {
      await cleanupRoleTrio(orgId, [owner.id, admin.id, member.id]);
    }
  });

  it("org A's save never affects org B", async () => {
    const trioA = await createRoleTrio();
    const trioB = await createRoleTrio();
    try {
      actAs(trioA.owner, trioA.orgId);
      await updateRolePermissionsAction(Role.MEMBER, fullPermissionState(Role.MEMBER, { DATA_EXPORT: true }));

      const setA = await getEffectivePermissionSet({ organizationId: trioA.orgId, role: "MEMBER" });
      const setB = await getEffectivePermissionSet({ organizationId: trioB.orgId, role: "MEMBER" });
      expect(setA.DATA_EXPORT).toBe(true);
      expect(setB.DATA_EXPORT).toBe(false);
    } finally {
      await cleanupRoleTrio(trioA.orgId, [trioA.owner.id, trioA.admin.id, trioA.member.id]);
      await cleanupRoleTrio(trioB.orgId, [trioB.owner.id, trioB.admin.id, trioB.member.id]);
    }
  });
});
