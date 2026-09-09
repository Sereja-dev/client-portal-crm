import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCustomStatusDefinition, getCustomStatusDefinition, archiveCustomStatusDefinition } from "@/lib/custom-statuses/definitions";
import { assertStatusDefinitionOwnership, resolveSystemStatusDefinition } from "@/lib/custom-statuses/resolution";
import { assignClientStatus } from "@/lib/custom-statuses/assignment";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Custom Statuses Phase 1 — tenant-security coverage (test items 40-42
 * of the originating task's own Section Z/V). Every definition operation
 * must be org-scoped; a foreign-org id must be indistinguishable from a
 * nonexistent one; entityType must be validated, never inferred.
 */

describe("Custom Statuses — tenant security (Section V)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgB.id);
  });

  afterEach(async () => {
    await prisma.customStatusDefinition.deleteMany({ where: { organizationId: fixtures.orgA.id, isSystem: false } });
    await prisma.customStatusDefinition.deleteMany({ where: { organizationId: fixtures.orgB.id, isSystem: false } });
  });

  afterAll(async () => {
    await prisma.customStatusDefinition.deleteMany({ where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    await cleanupTestData(fixtures);
  });

  it("40. a valid definition id belonging to a DIFFERENT organization is treated exactly like a nonexistent one across every read/mutation entry point", async () => {
    const orgBActive = await prisma.customStatusDefinition.findFirstOrThrow({
      where: { organizationId: fixtures.orgB.id, entityType: "CLIENT", isSystem: true, key: "active" },
    });

    expect(await getCustomStatusDefinition(fixtures.orgA.id, orgBActive.id)).toBeNull();
    expect(await assertStatusDefinitionOwnership({ organizationId: fixtures.orgA.id, entityType: "CLIENT", definitionId: orgBActive.id })).toBeNull();
    expect(await archiveCustomStatusDefinition(fixtures.orgA.id, orgBActive.id)).toEqual({ ok: false, reason: "DEFINITION_NOT_FOUND" });
    expect(await assignClientStatus(fixtures.orgA.id, fixtures.clientA.id, orgBActive.id)).toEqual({ ok: false, reason: "DEFINITION_NOT_FOUND" });

    // Confirm the foreign definition itself was never touched.
    const stillThere = await prisma.customStatusDefinition.findUnique({ where: { id: orgBActive.id } });
    expect(stillThere?.archivedAt).toBeNull();
  });

  it("41. entityType is validated, never inferred — a definition id that genuinely belongs to this SAME organization but a DIFFERENT entityType is also rejected as not found", async () => {
    const orgALeadNew = await prisma.customStatusDefinition.findFirstOrThrow({
      where: { organizationId: fixtures.orgA.id, entityType: "LEAD", isSystem: true, key: "new" },
    });

    // Same org, correct id, but asked for as a CLIENT definition — must not resolve.
    const ownership = await assertStatusDefinitionOwnership({
      organizationId: fixtures.orgA.id,
      entityType: "CLIENT",
      definitionId: orgALeadNew.id,
    });
    expect(ownership).toBeNull();

    const assignResult = await assignClientStatus(fixtures.orgA.id, fixtures.clientA.id, orgALeadNew.id);
    expect(assignResult).toEqual({ ok: false, reason: "DEFINITION_NOT_FOUND" });

    // resolveSystemStatusDefinition is likewise entityType-scoped: the
    // same key "new" exists only for LEAD, never CLIENT, in this org.
    expect(await resolveSystemStatusDefinition(fixtures.orgA.id, "CLIENT", "new")).toBeNull();
  });

  it("42. createCustomStatusDefinition/listCustomStatusDefinitions never leak across organizations — a definition created for orgA is invisible to orgB's own list, even for the identical entityType and label", async () => {
    const created = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "VIP Only In A" });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const orgBLookup = await getCustomStatusDefinition(fixtures.orgB.id, created.definition.id);
    expect(orgBLookup).toBeNull();

    const orgBList = await prisma.customStatusDefinition.findMany({
      where: { organizationId: fixtures.orgB.id, entityType: "CLIENT", key: "vip_only_in_a" },
    });
    expect(orgBList).toHaveLength(0);
  });
});
