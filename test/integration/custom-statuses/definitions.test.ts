import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listCustomStatusDefinitions,
  getCustomStatusDefinition,
  createCustomStatusDefinition,
  updateCustomStatusDefinition,
  archiveCustomStatusDefinition,
  unarchiveCustomStatusDefinition,
  setDefaultCustomStatusDefinition,
  moveCustomStatusDefinition,
} from "@/lib/custom-statuses/definitions";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Custom Statuses Phase 1 — Definition domain-layer coverage (test items
 * 12-24 of the originating task's own Section Z). Mirrors test/integration/
 * custom-fields/definitions.test.ts's own exact seedTestData/cleanup
 * pattern. Uses seedTestData()'s orgA/orgB DIRECTLY (never bootstrapped
 * automatically — those test orgs are created via a raw
 * `prisma.organization.create`, bypassing getOrCreateOrganizationId's own
 * bootstrap transaction, exactly like Custom Fields' own definitions
 * start from an empty list) except where a test explicitly needs a
 * bootstrapped org, which calls bootstrapOrganizationStatusDefinitions
 * directly first.
 */

async function cleanupDefinitions(organizationId: string) {
  await prisma.customStatusDefinition.deleteMany({ where: { organizationId } });
}

describe("Custom Statuses — Definition domain layer", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupDefinitions(fixtures.orgA.id);
    await cleanupDefinitions(fixtures.orgB.id);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("12. listCustomStatusDefinitions returns an empty array when none exist yet", async () => {
    const result = await listCustomStatusDefinitions(fixtures.orgA.id, "CLIENT");
    expect(result).toEqual([]);
  });

  it("13. createCustomStatusDefinition creates the first CUSTOM definition at position 0, isSystem false, isDefault false", async () => {
    const result = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "VIP" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.definition.position).toBe(0);
    expect(result.definition.key).toBe("vip");
    expect(result.definition.isSystem).toBe(false);
    expect(result.definition.isDefault).toBe(false);
    expect(result.definition.archivedAt).toBeNull();
  });

  it("14. createCustomStatusDefinition lands after every existing system definition's own position", async () => {
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    const result = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "VIP" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    // CLIENT's own 4 system definitions occupy positions 0-3.
    expect(result.definition.position).toBe(4);
  });

  it("15. key auto-derives from label and collision-suffixes deterministically ($base, then ${base}_2, ${base}_3, ...)", async () => {
    const first = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "VIP" });
    const second = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "VIP" });
    const third = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "VIP" });
    if (!first.ok || !second.ok || !third.ok) throw new Error("expected ok");
    expect(first.definition.key).toBe("vip");
    expect(second.definition.key).toBe("vip_2");
    expect(third.definition.key).toBe("vip_3");
    // Label rename never changes key.
    const renamed = await updateCustomStatusDefinition(fixtures.orgA.id, second.definition.id, { label: "Very Important" });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) throw new Error("expected ok");
    expect(renamed.definition.key).toBe("vip_2");
  });

  it("16. createCustomStatusDefinition rejects a blank/whitespace-only label", async () => {
    const result = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "   " });
    expect(result).toEqual({ ok: false, reason: "INVALID_LABEL" });
  });

  it("17. key uniqueness is scoped per organization+entityType — the same label in a different organization, or a different entityType, never collides", async () => {
    const orgA = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "VIP" });
    const orgB = await createCustomStatusDefinition(fixtures.orgB.id, "CLIENT", { label: "VIP" });
    const leadEntity = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD", { label: "VIP" });
    if (!orgA.ok || !orgB.ok || !leadEntity.ok) throw new Error("expected ok");
    expect(orgA.definition.key).toBe("vip");
    expect(orgB.definition.key).toBe("vip");
    expect(leadEntity.definition.key).toBe("vip");
  });

  it("18. updateCustomStatusDefinition updates label/color on a CUSTOM definition, never touches key", async () => {
    const created = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "VIP", color: "WARNING" });
    if (!created.ok) throw new Error("expected ok");
    const updated = await updateCustomStatusDefinition(fixtures.orgA.id, created.definition.id, { label: "Priority", color: "SUCCESS" });
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error("expected ok");
    expect(updated.definition.label).toBe("Priority");
    expect(updated.definition.key).toBe("vip");
  });

  it("19. updateCustomStatusDefinition rejects editing a SYSTEM definition", async () => {
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    const systemDef = await prisma.customStatusDefinition.findFirstOrThrow({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", isSystem: true, key: "active" },
    });
    const result = await updateCustomStatusDefinition(fixtures.orgA.id, systemDef.id, { label: "Changed" });
    expect(result).toEqual({ ok: false, reason: "SYSTEM_DEFINITION" });
  });

  it("20. archiveCustomStatusDefinition rejects archiving a SYSTEM definition, and rejects archiving the CURRENT default; is idempotent on an already-archived one", async () => {
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    const systemDef = await prisma.customStatusDefinition.findFirstOrThrow({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", isSystem: true, key: "active" },
    });
    expect(await archiveCustomStatusDefinition(fixtures.orgA.id, systemDef.id)).toEqual({ ok: false, reason: "SYSTEM_DEFINITION" });

    const custom = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "VIP" });
    if (!custom.ok) throw new Error("expected ok");
    await setDefaultCustomStatusDefinition(fixtures.orgA.id, "CLIENT", custom.definition.id);
    expect(await archiveCustomStatusDefinition(fixtures.orgA.id, custom.definition.id)).toEqual({ ok: false, reason: "IS_CURRENT_DEFAULT" });

    // Not the default anymore — archiving now succeeds, and is idempotent.
    await setDefaultCustomStatusDefinition(fixtures.orgA.id, "CLIENT", systemDef.id);
    const first = await archiveCustomStatusDefinition(fixtures.orgA.id, custom.definition.id);
    expect(first.ok).toBe(true);
    const second = await archiveCustomStatusDefinition(fixtures.orgA.id, custom.definition.id);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("expected ok");
    expect(second.definition.archivedAt).not.toBeNull();
  });

  it("21. unarchiveCustomStatusDefinition restores an archived CUSTOM definition, and is idempotent on an already-active one", async () => {
    const custom = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "VIP" });
    if (!custom.ok) throw new Error("expected ok");
    await archiveCustomStatusDefinition(fixtures.orgA.id, custom.definition.id);

    const restored = await unarchiveCustomStatusDefinition(fixtures.orgA.id, custom.definition.id);
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error("expected ok");
    expect(restored.definition.archivedAt).toBeNull();

    const again = await unarchiveCustomStatusDefinition(fixtures.orgA.id, custom.definition.id);
    expect(again.ok).toBe(true);
  });

  it("22. setDefaultCustomStatusDefinition transactionally moves the default from one definition to another (never zero or two defaults), rejects an archived target, and works for both system and custom targets", async () => {
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    const custom = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "VIP" });
    if (!custom.ok) throw new Error("expected ok");

    const setToCustom = await setDefaultCustomStatusDefinition(fixtures.orgA.id, "CLIENT", custom.definition.id);
    expect(setToCustom.ok).toBe(true);
    const defaultsAfterFirst = await prisma.customStatusDefinition.findMany({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", isDefault: true },
    });
    expect(defaultsAfterFirst).toHaveLength(1);
    expect(defaultsAfterFirst[0].id).toBe(custom.definition.id);

    const systemDef = await prisma.customStatusDefinition.findFirstOrThrow({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", isSystem: true, key: "lead" },
    });
    const setBackToSystem = await setDefaultCustomStatusDefinition(fixtures.orgA.id, "CLIENT", systemDef.id);
    expect(setBackToSystem.ok).toBe(true);
    const defaultsAfterSecond = await prisma.customStatusDefinition.findMany({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", isDefault: true },
    });
    expect(defaultsAfterSecond).toHaveLength(1);
    expect(defaultsAfterSecond[0].id).toBe(systemDef.id);

    // Rejects an archived target.
    await archiveCustomStatusDefinition(fixtures.orgA.id, custom.definition.id);
    const rejected = await setDefaultCustomStatusDefinition(fixtures.orgA.id, "CLIENT", custom.definition.id);
    expect(rejected).toEqual({ ok: false, reason: "ARCHIVED_DEFINITION" });
  });

  it("23. moveCustomStatusDefinition swaps position with its immediate neighbor, system and custom share one ordering, and reports CANNOT_MOVE at either end", async () => {
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    const custom = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "VIP" });
    if (!custom.ok) throw new Error("expected ok");
    // Custom lands at position 4 (after the 4 system CLIENT definitions).
    const beforeMove = await listCustomStatusDefinitions(fixtures.orgA.id, "CLIENT");
    const lastSystem = beforeMove[beforeMove.length - 2];
    expect(lastSystem.position).toBe(3);

    const moveResult = await moveCustomStatusDefinition(fixtures.orgA.id, "CLIENT", custom.definition.id, "up");
    expect(moveResult).toEqual({ ok: true });

    const afterMove = await listCustomStatusDefinitions(fixtures.orgA.id, "CLIENT");
    const movedCustom = afterMove.find((d) => d.id === custom.definition.id)!;
    const swappedSystem = afterMove.find((d) => d.id === lastSystem.id)!;
    expect(movedCustom.position).toBe(3);
    expect(swappedSystem.position).toBe(4);

    // Already at the very top — cannot move up further.
    const first = afterMove[0];
    expect(await moveCustomStatusDefinition(fixtures.orgA.id, "CLIENT", first.id, "up")).toEqual({
      ok: false,
      reason: "CANNOT_MOVE",
    });
    // Already at the very bottom — cannot move down further.
    const last = afterMove[afterMove.length - 1];
    expect(await moveCustomStatusDefinition(fixtures.orgA.id, "CLIENT", last.id, "down")).toEqual({
      ok: false,
      reason: "CANNOT_MOVE",
    });
  });

  it("24. getCustomStatusDefinition and every mutation function return DEFINITION_NOT_FOUND for a nonexistent id, indistinguishable from a foreign-org id (see security.test.ts for the dedicated cross-org proof)", async () => {
    const nonexistentId = "00000000-0000-0000-0000-000000000000";
    expect(await getCustomStatusDefinition(fixtures.orgA.id, nonexistentId)).toBeNull();
    expect(await updateCustomStatusDefinition(fixtures.orgA.id, nonexistentId, { label: "X" })).toEqual({
      ok: false,
      reason: "DEFINITION_NOT_FOUND",
    });
    expect(await archiveCustomStatusDefinition(fixtures.orgA.id, nonexistentId)).toEqual({
      ok: false,
      reason: "DEFINITION_NOT_FOUND",
    });
    expect(await unarchiveCustomStatusDefinition(fixtures.orgA.id, nonexistentId)).toEqual({
      ok: false,
      reason: "DEFINITION_NOT_FOUND",
    });
    expect(await setDefaultCustomStatusDefinition(fixtures.orgA.id, "CLIENT", nonexistentId)).toEqual({
      ok: false,
      reason: "DEFINITION_NOT_FOUND",
    });
    expect(await moveCustomStatusDefinition(fixtures.orgA.id, "CLIENT", nonexistentId, "up")).toEqual({
      ok: false,
      reason: "DEFINITION_NOT_FOUND",
    });
  });
});
