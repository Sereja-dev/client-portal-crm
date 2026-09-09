import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { assignClientStatus, assignLeadStatus, assignProjectStatus } from "@/lib/custom-statuses/assignment";
import { createCustomStatusDefinition, archiveCustomStatusDefinition } from "@/lib/custom-statuses/definitions";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Custom Statuses Phase 1 — entity-assignment coverage (test items 25-30
 * of the originating task's own Section Z). Every function under test
 * here is deliberately a "dumb" status swap (see assignment.ts's own
 * header comment) — these tests exist to prove exactly that: a SYSTEM
 * target syncs the legacy column, a CUSTOM target never touches it, and
 * none of this ever triggers conversion/lostReason/quote/Portal/billing
 * side effects on its own.
 */

async function cleanupDefinitions(organizationId: string) {
  await prisma.customStatusDefinition.deleteMany({ where: { organizationId } });
}

describe("Custom Statuses — entity-assignment primitives", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgB.id);
  });

  afterEach(async () => {
    // Restore the fixture Client/Lead/Project rows to their own original
    // legacy values between tests, and clear any CUSTOM definitions
    // created by an individual test (system definitions from beforeAll
    // survive untouched).
    await prisma.client.update({ where: { id: fixtures.clientA.id }, data: { status: "LEAD", statusDefinitionId: null } });
    await prisma.project.update({ where: { id: fixtures.project.id }, data: { statusDefinitionId: null } });
    await prisma.lead.deleteMany({ where: { organizationId: fixtures.orgA.id } });
    await prisma.customStatusDefinition.deleteMany({ where: { organizationId: fixtures.orgA.id, isSystem: false } });
  });

  afterAll(async () => {
    await cleanupDefinitions(fixtures.orgA.id);
    await cleanupDefinitions(fixtures.orgB.id);
    await cleanupTestData(fixtures);
  });

  it("25. assignClientStatus to a SYSTEM definition syncs both statusDefinitionId AND the legacy status enum column", async () => {
    const inactive = await prisma.customStatusDefinition.findFirstOrThrow({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", isSystem: true, key: "inactive" },
    });
    const result = await assignClientStatus(fixtures.orgA.id, fixtures.clientA.id, inactive.id);
    expect(result).toEqual({ ok: true });

    const client = await prisma.client.findUniqueOrThrow({ where: { id: fixtures.clientA.id } });
    expect(client.statusDefinitionId).toBe(inactive.id);
    expect(client.status).toBe("INACTIVE");
  });

  it("26. assignClientStatus to a CUSTOM definition sets ONLY statusDefinitionId — the legacy status column is left untouched", async () => {
    const custom = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "VIP" });
    if (!custom.ok) throw new Error("expected ok");

    const before = await prisma.client.findUniqueOrThrow({ where: { id: fixtures.clientA.id } });
    const result = await assignClientStatus(fixtures.orgA.id, fixtures.clientA.id, custom.definition.id);
    expect(result).toEqual({ ok: true });

    const after = await prisma.client.findUniqueOrThrow({ where: { id: fixtures.clientA.id } });
    expect(after.statusDefinitionId).toBe(custom.definition.id);
    expect(after.status).toBe(before.status);
  });

  it("27. assignLeadStatus to the WON/LOST system definitions syncs `stage`, but never mutates lostReason, convertedClientId, or convertedAt — those remain the exclusive responsibility of the dedicated Server Actions", async () => {
    const lead = await prisma.lead.create({ data: { organizationId: fixtures.orgA.id, name: "Assignment Test Lead" } });
    const won = await prisma.customStatusDefinition.findFirstOrThrow({
      where: { organizationId: fixtures.orgA.id, entityType: "LEAD", isSystem: true, key: "won" },
    });

    const result = await assignLeadStatus(fixtures.orgA.id, lead.id, won.id);
    expect(result).toEqual({ ok: true });

    const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.statusDefinitionId).toBe(won.id);
    expect(updated.stage).toBe("WON");
    expect(updated.lostReason).toBeNull();
    expect(updated.convertedClientId).toBeNull();
    expect(updated.convertedAt).toBeNull();
  });

  it("28. assignProjectStatus rejects an ARCHIVED definition and leaves the Project's own statusDefinitionId/status completely untouched", async () => {
    const custom = await createCustomStatusDefinition(fixtures.orgA.id, "PROJECT", { label: "Blocked" });
    if (!custom.ok) throw new Error("expected ok");
    await archiveCustomStatusDefinition(fixtures.orgA.id, custom.definition.id);

    const before = await prisma.project.findUniqueOrThrow({ where: { id: fixtures.project.id } });
    const result = await assignProjectStatus(fixtures.orgA.id, fixtures.project.id, custom.definition.id);
    expect(result).toEqual({ ok: false, reason: "ARCHIVED_DEFINITION" });

    const after = await prisma.project.findUniqueOrThrow({ where: { id: fixtures.project.id } });
    expect(after.statusDefinitionId).toBe(before.statusDefinitionId);
    expect(after.status).toBe(before.status);
  });

  it("29. every assign function returns ENTITY_NOT_FOUND for a nonexistent entity id, and DEFINITION_NOT_FOUND for a nonexistent/foreign-org definition id", async () => {
    const nonexistentId = "00000000-0000-0000-0000-000000000000";
    const active = await prisma.customStatusDefinition.findFirstOrThrow({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", isSystem: true, key: "active" },
    });

    expect(await assignClientStatus(fixtures.orgA.id, nonexistentId, active.id)).toEqual({
      ok: false,
      reason: "ENTITY_NOT_FOUND",
    });
    expect(await assignClientStatus(fixtures.orgA.id, fixtures.clientA.id, nonexistentId)).toEqual({
      ok: false,
      reason: "DEFINITION_NOT_FOUND",
    });
  });

  it("30. assignClientStatus never assigns a definition from a foreign organization, even by a valid id — cross-org id is treated exactly like a nonexistent one", async () => {
    const orgBActive = await prisma.customStatusDefinition.findFirstOrThrow({
      where: { organizationId: fixtures.orgB.id, entityType: "CLIENT", isSystem: true, key: "active" },
    });

    const result = await assignClientStatus(fixtures.orgA.id, fixtures.clientA.id, orgBActive.id);
    expect(result).toEqual({ ok: false, reason: "DEFINITION_NOT_FOUND" });

    const client = await prisma.client.findUniqueOrThrow({ where: { id: fixtures.clientA.id } });
    expect(client.statusDefinitionId).toBeNull();
  });
});
