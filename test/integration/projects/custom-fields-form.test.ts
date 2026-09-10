import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createProjectAction } from "@/app/(dashboard)/projects/new/actions";
import { updateProjectAction } from "@/app/(dashboard)/projects/[id]/edit/actions";
import { deleteProjectAction } from "@/app/(dashboard)/projects/actions";
import { createCustomFieldDefinition } from "@/lib/custom-fields/definitions";
import { upsertCustomFieldValue } from "@/lib/custom-fields/values";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * Custom Fields Phase 2B — Project create/edit form integration.
 * Representative coverage only (Section X) — see leads/
 * custom-fields-form.test.ts's own identical header comment for why. The
 * one genuinely Project-specific regression this file adds is item 37:
 * deleteProjectAction's own Phase 1 custom-field-value cleanup (added in
 * Custom Fields Phase 1) must still work correctly now that Projects can
 * actually carry real custom field values created through this phase's
 * own form integration, not just directly via the domain layer.
 *
 * createProjectAction/updateProjectAction redirect() on success (see
 * clients/custom-fields-form.test.ts's own identical header comment for
 * the expectRedirect technique) — deleteProjectAction does not.
 */

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

// Custom Statuses Phase 2B (Section R) — statusDefinitionId is now
// required on the Project form; this suite is entirely about custom
// fields, unrelated to status, so every call defaults to orgA's own
// bootstrapped 'planning' system definition (set in beforeAll below).
let defaultStatusDefinitionId: string;

function baseProjectFields(clientId: string, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    name: `Project-${randomUUID().slice(0, 8)}`,
    clientId,
    status: "PLANNING",
    statusDefinitionId: defaultStatusDefinitionId,
    ...overrides,
  };
}

async function expectRedirect(promise: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
}

describe("Custom Fields — Project create/edit form integration", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    defaultStatusDefinitionId = (
      await prisma.customStatusDefinition.findFirstOrThrow({
        where: { organizationId: fixtures.orgA.id, entityType: "PROJECT", isSystem: true, key: "planning" },
      })
    ).id;
  });

  afterEach(async () => {
    resetAuthMock();
    await prisma.customFieldDefinition.deleteMany({ where: { organizationId: fixtures.orgA.id } });
    await prisma.project.deleteMany({ where: { organizationId: fixtures.orgA.id, id: { not: fixtures.project.id } } });
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  async function makeDefinition(
    fieldType: "TEXT" | "NUMBER" | "DATE" | "CHECKBOX" | "SELECT",
    opts: { required?: boolean } = {},
  ) {
    const result = await createCustomFieldDefinition(fixtures.orgA.id, "PROJECT", {
      label: `Field-${randomUUID().slice(0, 6)}`,
      fieldType,
      required: opts.required ?? false,
    });
    if (!result.ok) throw new Error("expected ok");
    return result.definition;
  }

  async function findCreatedProject() {
    return prisma.project.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: { startsWith: "Project-" } } });
  }

  it("create Project with a NUMBER custom field", async () => {
    const def = await makeDefinition("NUMBER");
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(
      createProjectAction({ error: null }, buildFormData({ ...baseProjectFields(fixtures.clientA.id), [`customField_${def.id}`]: "99.99" })),
    );
    const project = await findCreatedProject();
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: project.id } });
    expect(Number(value?.numberValue)).toBe(99.99);
  });

  it("create Project with a DATE custom field", async () => {
    const def = await makeDefinition("DATE");
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(
      createProjectAction({ error: null }, buildFormData({ ...baseProjectFields(fixtures.clientA.id), [`customField_${def.id}`]: "2026-06-01" })),
    );
    const project = await findCreatedProject();
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: project.id } });
    expect(value?.dateValue?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("required CHECKBOX rejects nothing (false is a valid, persisted answer)", async () => {
    const def = await makeDefinition("CHECKBOX", { required: true });
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(createProjectAction({ error: null }, buildFormData(baseProjectFields(fixtures.clientA.id))));
    const project = await findCreatedProject();
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: project.id } });
    expect(value?.booleanValue).toBe(false);
  });

  it("edit: pre-existing value loaded and updated", async () => {
    const def = await makeDefinition("TEXT"); // TEXT also valid for Project
    const project = await prisma.project.create({
      data: { name: `Project-${randomUUID().slice(0, 8)}`, clientId: fixtures.clientA.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "PLANNING" },
    });
    await upsertCustomFieldValue(fixtures.orgA.id, "PROJECT", project.id, def.id, "Original note");
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(
      updateProjectAction(
        project.id,
        { error: null },
        buildFormData({ ...baseProjectFields(fixtures.clientA.id, { name: project.name }), [`customField_${def.id}`]: "Updated note" }),
      ),
    );
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: project.id } });
    expect(value?.textValue).toBe("Updated note");
  });

  it("required NUMBER empty rejected, no partial update applied", async () => {
    const def = await makeDefinition("NUMBER", { required: true });
    const project = await prisma.project.create({
      data: { name: `Project-${randomUUID().slice(0, 8)}`, clientId: fixtures.clientA.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "PLANNING" },
    });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await updateProjectAction(project.id, { error: null }, buildFormData(baseProjectFields(fixtures.clientA.id, { name: "Should not apply" })));
    expect(result.customFieldErrors?.[def.id]).toBeTruthy();
    const reloaded = await prisma.project.findUnique({ where: { id: project.id } });
    expect(reloaded?.name).toBe(project.name);
  });

  // ---------------------------------------------------------------------
  // Section Q / item 37 — Project delete cleanup, now exercised against
  // a real value written through this phase's own form integration.
  // ---------------------------------------------------------------------

  it("37. deleteProjectAction cleans up custom field values created through the form-integration path", async () => {
    const def = await makeDefinition("TEXT");
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(
      createProjectAction({ error: null }, buildFormData({ ...baseProjectFields(fixtures.clientA.id), [`customField_${def.id}`]: "Will be deleted" })),
    );
    const project = await findCreatedProject();
    expect(await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: project.id } })).not.toBeNull();

    const result = await deleteProjectAction(project.id);
    expect(result).toEqual({ ok: true });
    expect(await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: project.id } })).toBeNull();
    expect(await prisma.project.findUnique({ where: { id: project.id } })).toBeNull();
  });
});
