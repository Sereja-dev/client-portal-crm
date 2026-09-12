import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { loadWorkflowAutomationEntityOptions, loadWorkflowAutomationLabelMaps } from "@/app/(dashboard)/settings/workflow-automations/options";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Workflow Automations V1 — Staff Authoring UI, the create/edit form's
 * own option-loading helper. This is pure presentation plumbing (no
 * validation/authorization lives here — see options.ts's own header
 * comment), but the form can only ever offer what this function returns,
 * so its own "active, correct-entity-type, this-organization-only"
 * filtering is exactly what keeps the rendered selects honest.
 */

async function cleanup(organizationIds: string[]) {
  await prisma.customFieldValue.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.customFieldOption.deleteMany({ where: { definition: { organizationId: { in: organizationIds } } } });
  await prisma.customFieldDefinition.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.customStatusDefinition.deleteMany({ where: { organizationId: { in: organizationIds }, isSystem: false } });
}

describe("Workflow Automations — entity option loading (the create/edit form's own data source)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanup([fixtures.orgA.id, fixtures.orgB.id]);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("returns only active, current-organization, correct-entity-type Custom Statuses", async () => {
    const activeLead = await prisma.customStatusDefinition.create({
      data: { organizationId: fixtures.orgA.id, entityType: "LEAD", key: "active_lead", label: "Active Lead Status", position: 100 },
    });
    await prisma.customStatusDefinition.create({
      data: { organizationId: fixtures.orgA.id, entityType: "LEAD", key: "archived_lead", label: "Archived Lead Status", position: 101, archivedAt: new Date() },
    });
    await prisma.customStatusDefinition.create({
      data: { organizationId: fixtures.orgA.id, entityType: "CLIENT", key: "wrong_entity", label: "Client Status", position: 102 },
    });
    await prisma.customStatusDefinition.create({
      data: { organizationId: fixtures.orgB.id, entityType: "LEAD", key: "other_org", label: "Other Org Status", position: 103 },
    });

    const options = await loadWorkflowAutomationEntityOptions(fixtures.orgA.id, "LEAD");
    expect(options.customStatuses.map((s) => s.id)).toEqual([activeLead.id]);
  });

  it("returns only active, current-organization, correct-entity-type Custom Fields, with active SELECT options only", async () => {
    const selectField = await prisma.customFieldDefinition.create({
      data: { organizationId: fixtures.orgA.id, entityType: "LEAD", key: "tier", label: "Tier", fieldType: "SELECT", position: 0 },
    });
    const activeOption = await prisma.customFieldOption.create({
      data: { definitionId: selectField.id, value: "gold", label: "Gold", position: 0 },
    });
    await prisma.customFieldOption.create({
      data: { definitionId: selectField.id, value: "bronze", label: "Bronze", position: 1, archivedAt: new Date() },
    });
    await prisma.customFieldDefinition.create({
      data: { organizationId: fixtures.orgA.id, entityType: "LEAD", key: "archived_field", label: "Archived Field", fieldType: "TEXT", position: 1, archivedAt: new Date() },
    });
    await prisma.customFieldDefinition.create({
      data: { organizationId: fixtures.orgA.id, entityType: "CLIENT", key: "wrong_entity_field", label: "Wrong Entity Field", fieldType: "TEXT", position: 2 },
    });
    await prisma.customFieldDefinition.create({
      data: { organizationId: fixtures.orgB.id, entityType: "LEAD", key: "other_org_field", label: "Other Org Field", fieldType: "TEXT", position: 3 },
    });

    const options = await loadWorkflowAutomationEntityOptions(fixtures.orgA.id, "LEAD");
    expect(options.customFields.map((f) => f.id)).toEqual([selectField.id]);
    expect(options.customFields[0].options.map((o) => o.id)).toEqual([activeOption.id]);
  });

  it("label maps are scoped to the requested organization only, and include archived definitions (for historical summary text)", async () => {
    const orgAStatus = await prisma.customStatusDefinition.create({
      data: { organizationId: fixtures.orgA.id, entityType: "LEAD", key: `k_${randomUUID().slice(0, 8)}`, label: "Org A Status", position: 100 },
    });
    const orgAArchivedStatus = await prisma.customStatusDefinition.create({
      data: { organizationId: fixtures.orgA.id, entityType: "LEAD", key: `k_${randomUUID().slice(0, 8)}`, label: "Org A Archived Status", position: 101, archivedAt: new Date() },
    });
    const orgBStatus = await prisma.customStatusDefinition.create({
      data: { organizationId: fixtures.orgB.id, entityType: "LEAD", key: `k_${randomUUID().slice(0, 8)}`, label: "Org B Status", position: 100 },
    });

    const orgAMaps = await loadWorkflowAutomationLabelMaps(fixtures.orgA.id);
    expect(orgAMaps.customStatusLabelById[orgAStatus.id]).toBe("Org A Status");
    expect(orgAMaps.customStatusLabelById[orgAArchivedStatus.id]).toBe("Org A Archived Status");
    // Org B's own definition never leaks into Org A's map, even though the lookup itself is a flat id-keyed object.
    expect(orgAMaps.customStatusLabelById[orgBStatus.id]).toBeUndefined();

    await prisma.customStatusDefinition.deleteMany({ where: { organizationId: fixtures.orgB.id, isSystem: false } });
  });
});
