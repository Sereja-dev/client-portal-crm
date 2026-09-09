import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCustomFieldDefinition } from "@/lib/custom-fields/definitions";
import { upsertCustomFieldValue, deleteCustomFieldValuesForEntities } from "@/lib/custom-fields/values";
import { deleteClientAction } from "@/app/(dashboard)/clients/actions";
import { deleteProjectAction } from "@/app/(dashboard)/projects/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Custom Fields Phase 1 — delete-cleanup coverage (test items 27-30 of
 * the originating task, Section P). CustomFieldValue carries no literal
 * foreign key to Client/Lead/Project (see that model's own schema
 * comment), so it would otherwise orphan silently on a hard delete —
 * this file proves the wiring added to deleteClientAction/
 * deleteProjectAction actually cleans it up, the same way
 * attachment-cleanup coverage already proves for Attachment in
 * test/integration/clients/delete.test.ts and projects/delete.test.ts.
 * Lead is deliberately excluded — it has no hard-delete action at all
 * (soft-archive only), so nothing can ever orphan a Lead's own
 * CustomFieldValue rows.
 */

async function cleanupOrgCustomFields(organizationId: string) {
  await prisma.customFieldDefinition.deleteMany({ where: { organizationId } });
}

async function makeClient(organizationId: string, userId: string) {
  return prisma.client.create({ data: { name: `CF-Delete-${randomUUID().slice(0, 8)}`, organizationId, userId } });
}

async function makeProject(organizationId: string, clientId: string, ownerId: string) {
  return prisma.project.create({
    data: { name: `CF-Delete-Project-${randomUUID().slice(0, 8)}`, clientId, organizationId, ownerId, status: "PLANNING" },
  });
}

describe("Custom Fields — delete-cleanup wiring", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    resetAuthMock();
    await cleanupOrgCustomFields(fixtures.orgA.id);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("27. deleteCustomFieldValuesForEntities removes only the rows for the given entityIds, leaves everything else untouched, and no-ops on an empty list", async () => {
    const definition = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Notes", fieldType: "TEXT" });
    if (!definition.ok) throw new Error("expected ok");

    const clientOne = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const clientTwo = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", clientOne.id, definition.definition.id, "Delete me");
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", clientTwo.id, definition.definition.id, "Keep me");

    await prisma.$transaction((tx) =>
      deleteCustomFieldValuesForEntities(tx, { organizationId: fixtures.orgA.id, entityIds: [clientOne.id] }),
    );

    expect(await prisma.customFieldValue.findFirst({ where: { entityId: clientOne.id } })).toBeNull();
    const remaining = await prisma.customFieldValue.findFirst({ where: { entityId: clientTwo.id } });
    expect(remaining?.textValue).toBe("Keep me");

    // Empty list — no-op, no error.
    await expect(
      prisma.$transaction((tx) => deleteCustomFieldValuesForEntities(tx, { organizationId: fixtures.orgA.id, entityIds: [] })),
    ).resolves.toBeUndefined();
    expect(await prisma.customFieldValue.findFirst({ where: { entityId: clientTwo.id } })).not.toBeNull();

    await prisma.client.deleteMany({ where: { id: { in: [clientOne.id, clientTwo.id] } } });
  });

  it("28. deleteClientAction cleans up the deleted Client's own CustomFieldValue rows", async () => {
    const definition = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Notes", fieldType: "TEXT" });
    if (!definition.ok) throw new Error("expected ok");
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", client.id, definition.definition.id, "Some value");

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await deleteClientAction(client.id);

    expect(result).toEqual({ ok: true });
    expect(await prisma.customFieldValue.findFirst({ where: { entityId: client.id } })).toBeNull();
  });

  it("29. deleteClientAction also cleans up CustomFieldValue rows for every childProject cascade-deleted alongside the Client", async () => {
    const clientDef = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Notes", fieldType: "TEXT" });
    const projectDef = await createCustomFieldDefinition(fixtures.orgA.id, "PROJECT", { label: "Budget note", fieldType: "TEXT" });
    if (!clientDef.ok || !projectDef.ok) throw new Error("expected ok");

    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const childProject = await makeProject(fixtures.orgA.id, client.id, fixtures.owner.id);
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", client.id, clientDef.definition.id, "Client value");
    await upsertCustomFieldValue(fixtures.orgA.id, "PROJECT", childProject.id, projectDef.definition.id, "Project value");

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await deleteClientAction(client.id);

    expect(result).toEqual({ ok: true });
    // The Project itself cascade-deleted (Project.clientId is onDelete: Cascade).
    expect(await prisma.project.findUnique({ where: { id: childProject.id } })).toBeNull();
    expect(await prisma.customFieldValue.findFirst({ where: { entityId: client.id } })).toBeNull();
    expect(await prisma.customFieldValue.findFirst({ where: { entityId: childProject.id } })).toBeNull();
  });

  it("30. deleteProjectAction cleans up the deleted Project's own CustomFieldValue rows (Client not deleted)", async () => {
    const projectDef = await createCustomFieldDefinition(fixtures.orgA.id, "PROJECT", { label: "Budget note", fieldType: "TEXT" });
    if (!projectDef.ok) throw new Error("expected ok");

    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const project = await makeProject(fixtures.orgA.id, client.id, fixtures.owner.id);
    await upsertCustomFieldValue(fixtures.orgA.id, "PROJECT", project.id, projectDef.definition.id, "Some value");

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await deleteProjectAction(project.id);

    expect(result).toEqual({ ok: true });
    expect(await prisma.customFieldValue.findFirst({ where: { entityId: project.id } })).toBeNull();
    // The Client itself survives — only the Project was deleted.
    expect(await prisma.client.findUnique({ where: { id: client.id } })).not.toBeNull();

    await prisma.client.deleteMany({ where: { id: client.id } });
  });
});
