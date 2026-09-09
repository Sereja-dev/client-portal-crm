import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getOrCreateOrganizationId } from "@/lib/current-user";
import { SYSTEM_STATUS_DEFINITIONS } from "@/lib/custom-statuses/constants";

/**
 * Custom Statuses Phase 1 (Section N) — test items 9-11 of the
 * originating task's own Section Z: a brand-new Organization must
 * automatically get its complete set of built-in system status
 * definitions, in the SAME transaction as its own creation. Mirrors
 * test/integration/auth/organization-provisioning.test.ts's own exact
 * pattern (calling getOrCreateOrganizationId directly against a fresh
 * User row, with per-test cleanup keyed by trackUser) — this is the one
 * real application code path that provisions a new Organization at all.
 */

let createdUserIds: string[] = [];

function trackUser(id: string): string {
  createdUserIds.push(id);
  return id;
}

afterEach(async () => {
  if (createdUserIds.length === 0) return;
  const memberships = await prisma.membership.findMany({
    where: { userId: { in: createdUserIds } },
    select: { organizationId: true },
  });
  await prisma.organization.deleteMany({ where: { id: { in: memberships.map((m) => m.organizationId) } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds = [];
});

describe("Custom Statuses — new Organization bootstrap (Section N)", () => {
  it("9. a brand-new Organization gets exactly 4 CLIENT + 6 LEAD + 5 PROJECT system definitions, all isSystem, none archived", async () => {
    const user = { id: trackUser(randomUUID()), name: "Bootstrap User", email: `bootstrap-${randomUUID()}@test.local` };
    await prisma.user.create({ data: user });

    const organizationId = await getOrCreateOrganizationId(user);

    const definitions = await prisma.customStatusDefinition.findMany({ where: { organizationId } });
    expect(definitions).toHaveLength(15);
    expect(definitions.every((d) => d.isSystem)).toBe(true);
    expect(definitions.every((d) => d.archivedAt === null)).toBe(true);

    const byEntityType = {
      CLIENT: definitions.filter((d) => d.entityType === "CLIENT"),
      LEAD: definitions.filter((d) => d.entityType === "LEAD"),
      PROJECT: definitions.filter((d) => d.entityType === "PROJECT"),
    };
    expect(byEntityType.CLIENT).toHaveLength(4);
    expect(byEntityType.LEAD).toHaveLength(6);
    expect(byEntityType.PROJECT).toHaveLength(5);
  });

  it("10. the bootstrapped definitions' keys/labels/positions/colors/isDefault flags exactly match SYSTEM_STATUS_DEFINITIONS (the same constant the migration's own backfill is manually kept in sync with)", async () => {
    const user = { id: trackUser(randomUUID()), name: "Bootstrap User 2", email: `bootstrap2-${randomUUID()}@test.local` };
    await prisma.user.create({ data: user });

    const organizationId = await getOrCreateOrganizationId(user);

    const definitions = await prisma.customStatusDefinition.findMany({
      where: { organizationId },
      orderBy: [{ entityType: "asc" }, { position: "asc" }],
    });

    for (const entityType of ["CLIENT", "LEAD", "PROJECT"] as const) {
      const expected = SYSTEM_STATUS_DEFINITIONS[entityType];
      const actual = definitions.filter((d) => d.entityType === entityType);
      expect(actual.map((d) => ({ key: d.key, label: d.label, position: d.position, color: d.color, isDefault: d.isDefault }))).toEqual(
        expected.map((seed) => ({ key: seed.key, label: seed.label, position: seed.position, color: seed.color, isDefault: seed.isDefault })),
      );
    }

    // Exactly one active default per entityType.
    const defaults = definitions.filter((d) => d.isDefault);
    expect(defaults).toHaveLength(3);
  });

  it("11. two concurrent first-time calls for the SAME user provision only one Organization, with exactly one full set of definitions (no duplicate bootstrap)", async () => {
    const user = { id: trackUser(randomUUID()), name: "Concurrent Bootstrap User", email: `concurrent-bootstrap-${randomUUID()}@test.local` };
    await prisma.user.create({ data: user });

    const [orgIdA, orgIdB] = await Promise.all([
      getOrCreateOrganizationId(user),
      getOrCreateOrganizationId(user),
    ]);

    expect(orgIdA).toBe(orgIdB);
    const definitions = await prisma.customStatusDefinition.findMany({ where: { organizationId: orgIdA } });
    expect(definitions).toHaveLength(15);
  });
});
