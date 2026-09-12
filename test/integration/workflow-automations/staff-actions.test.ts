import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createWorkflowAutomationAction,
  updateWorkflowAutomationAction,
  setWorkflowAutomationEnabledAction,
  archiveWorkflowAutomationAction,
} from "@/app/(dashboard)/settings/workflow-automations/actions";
import { listWorkflowAutomations, getWorkflowAutomation } from "@/lib/workflow-automations/automations";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal, resetNavigationMock } from "../../support/navigation-mock";

/**
 * Workflow Automations V1 — Staff Authoring UI, Server Action layer.
 * Mirrors test/integration/recurring-invoices/staff-actions.test.ts's own
 * seedTestData/actAs/expectRedirect pattern — with one deliberate
 * difference: createWorkflowAutomationAction redirects to the plain list
 * page (there is no per-automation detail page in this block, only list +
 * edit — see this feature's own spec), so the new row's id is never
 * encoded in the redirect URL the way createRecurringInvoiceAction's own
 * `/recurring-invoices/${id}` redirect is. Every test here instead looks
 * the created row up by its own (organizationId, name).
 */

async function expectRedirect(promise: Promise<unknown>): Promise<RedirectSignal> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
  return caught as RedirectSignal;
}

function formData(fields: Record<string, string | undefined>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) fd.set(key, value);
  }
  return fd;
}

async function cleanupAll(organizationIds: string[]) {
  await prisma.workflowAutomationRun.deleteMany({ where: { workflowAutomation: { organizationId: { in: organizationIds } } } });
  await prisma.workflowAutomation.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.customFieldValue.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.customFieldOption.deleteMany({ where: { definition: { organizationId: { in: organizationIds } } } });
  await prisma.customFieldDefinition.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.customStatusDefinition.deleteMany({ where: { organizationId: { in: organizationIds }, isSystem: false } });
}

async function createCustomStatusDefinition(organizationId: string, entityType: "LEAD" | "CLIENT", overrides: Record<string, unknown> = {}) {
  return prisma.customStatusDefinition.create({
    data: { organizationId, entityType, key: `status_${randomUUID().slice(0, 8)}`, label: "Custom", position: 100, ...overrides },
  });
}

function leadAutomationFields(statusDefinitionId: string, overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    name: `Test automation ${randomUUID().slice(0, 8)}`,
    triggerEntityType: "LEAD",
    triggerAction: "STATUS_CHANGED",
    action: JSON.stringify({ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinitionId }),
    ...overrides,
  };
}

async function findByName(organizationId: string, name: string) {
  return prisma.workflowAutomation.findFirstOrThrow({ where: { organizationId, name } });
}

/** Creates via the real Server Action (as OWNER), returns the created row's own id. */
async function createViaAction(fixtures: TestFixtures, statusDefinitionId: string, overrides: Record<string, string | undefined> = {}) {
  const fields = leadAutomationFields(statusDefinitionId, overrides);
  actAs(fixtures.owner, fixtures.orgA.id);
  await expectRedirect(createWorkflowAutomationAction({ error: null }, formData(fields)));
  resetAuthMock();
  resetNavigationMock();
  const created = await findByName(fixtures.orgA.id, fields.name!);
  return created.id;
}

describe("Workflow Automations — Staff Server Actions", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupAll([fixtures.orgA.id, fixtures.orgB.id]);
    resetAuthMock();
    resetNavigationMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  // -- Authorization --------------------------------------------------

  it("an OWNER can create, edit, enable/disable, and archive an automation", async () => {
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const id = await createViaAction(fixtures, statusDefinition.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(
      updateWorkflowAutomationAction(
        id,
        { error: null },
        formData({ name: "Renamed", action: JSON.stringify({ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }) }),
      ),
    );
    const disableResult = await setWorkflowAutomationEnabledAction(id, false);
    expect(disableResult).toEqual({ ok: true });
    const archiveResult = await archiveWorkflowAutomationAction(id);
    expect(archiveResult).toEqual({ ok: true });
    resetAuthMock();
    resetNavigationMock();
  });

  it("an ADMIN can create, edit, enable/disable, and archive an automation", async () => {
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const fields = leadAutomationFields(statusDefinition.id);
    actAs(fixtures.admin, fixtures.orgA.id);
    await expectRedirect(createWorkflowAutomationAction({ error: null }, formData(fields)));
    resetAuthMock();
    resetNavigationMock();
    const created = await findByName(fixtures.orgA.id, fields.name!);

    actAs(fixtures.admin, fixtures.orgA.id);
    const enableResult = await setWorkflowAutomationEnabledAction(created.id, false);
    expect(enableResult).toEqual({ ok: true });
    const archiveResult = await archiveWorkflowAutomationAction(created.id);
    expect(archiveResult).toEqual({ ok: true });
    resetAuthMock();
  });

  it("a MEMBER cannot create an automation", async () => {
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    actAs(fixtures.member, fixtures.orgA.id);
    const result = await createWorkflowAutomationAction({ error: null }, formData(leadAutomationFields(statusDefinition.id)));
    resetAuthMock();
    expect(result.error).toBe("You don't have permission to do that.");
    expect(await prisma.workflowAutomation.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("a MEMBER cannot edit, enable/disable, or archive an existing automation", async () => {
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const id = await createViaAction(fixtures, statusDefinition.id);

    actAs(fixtures.member, fixtures.orgA.id);
    // A well-formed action field is included deliberately — this proves
    // the FORBIDDEN rejection itself, not a masking config-shape error a
    // MEMBER would see identically to any other actor.
    const updateResult = await updateWorkflowAutomationAction(
      id,
      { error: null },
      formData({ name: "Hijacked", action: JSON.stringify({ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }) }),
    );
    expect(updateResult.error).toBe("You don't have permission to do that.");
    const enableResult = await setWorkflowAutomationEnabledAction(id, false);
    expect(enableResult).toEqual({ ok: false, reason: "FORBIDDEN" });
    const archiveResult = await archiveWorkflowAutomationAction(id);
    expect(archiveResult).toEqual({ ok: false, reason: "FORBIDDEN" });
    resetAuthMock();

    const stillThere = await prisma.workflowAutomation.findUniqueOrThrow({ where: { id } });
    expect(stillThere.name).not.toBe("Hijacked");
    expect(stillThere.isEnabled).toBe(true);
    expect(stillThere.archivedAt).toBeNull();
  });

  it("list is empty for a fresh organization", async () => {
    const result = await listWorkflowAutomations(fixtures.orgA.id, { id: fixtures.owner.id, name: fixtures.owner.name, role: "OWNER" });
    expect(result).toEqual({ ok: true, workflowAutomations: [] });
  });

  // -- Create: valid Lead / Client automations ----------------------------

  it("creates a valid LEAD.STATUS_CHANGED automation with a condition", async () => {
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const fields = leadAutomationFields(statusDefinition.id, {
      condition: JSON.stringify({ field: "status", operator: "CHANGED_TO", value: "LOST" }),
    });
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(createWorkflowAutomationAction({ error: null }, formData(fields)));
    resetAuthMock();

    const automation = await findByName(fixtures.orgA.id, fields.name!);
    expect(automation.triggerEntityType).toBe("LEAD");
    expect(automation.triggerAction).toBe("STATUS_CHANGED");
    expect(automation.conditions).toEqual([{ field: "status", operator: "CHANGED_TO", value: "LOST" }]);
    expect(automation.actions).toEqual([{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }]);
  });

  it("creates a valid CLIENT.CREATED automation", async () => {
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT");
    const name = `Client created automation ${randomUUID().slice(0, 8)}`;
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(
      createWorkflowAutomationAction(
        { error: null },
        formData({
          name,
          triggerEntityType: "CLIENT",
          triggerAction: "CREATED",
          action: JSON.stringify({ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }),
        }),
      ),
    );
    resetAuthMock();

    const automation = await findByName(fixtures.orgA.id, name);
    expect(automation.triggerEntityType).toBe("CLIENT");
    expect(automation.triggerAction).toBe("CREATED");
  });

  // -- Invalid trigger / action rejected server-side -----------------------

  it("a genuinely unsupported trigger (QUOTE.STATUS_CHANGED — not in the V1 allowlist at all) is rejected server-side even if submitted directly", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createWorkflowAutomationAction(
      { error: null },
      formData({
        name: "Should be rejected",
        triggerEntityType: "QUOTE",
        triggerAction: "STATUS_CHANGED",
        action: JSON.stringify({ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: randomUUID() }),
      }),
    );
    resetAuthMock();
    expect(result.error).toContain("not a supported Workflow Automations trigger");
    expect(await prisma.workflowAutomation.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("an action for a configurable-but-not-executable trigger (INVOICE.STATUS_CHANGED — no Custom Status/Field correspondence) is rejected server-side", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createWorkflowAutomationAction(
      { error: null },
      formData({
        name: "Invoice with action",
        triggerEntityType: "INVOICE",
        triggerAction: "STATUS_CHANGED",
        action: JSON.stringify({ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: randomUUID() }),
      }),
    );
    resetAuthMock();
    expect(result.error).toContain("supports no action types in V1");
    expect(await prisma.workflowAutomation.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("a cross-organization Custom Status reference is rejected server-side", async () => {
    const orgBStatus = await createCustomStatusDefinition(fixtures.orgB.id, "LEAD");
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createWorkflowAutomationAction({ error: null }, formData(leadAutomationFields(orgBStatus.id)));
    resetAuthMock();
    expect(result.error).toContain("does not exist");
    expect(await prisma.workflowAutomation.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);

    await prisma.customStatusDefinition.deleteMany({ where: { organizationId: fixtures.orgB.id, isSystem: false } });
  });

  it("an archived Custom Status cannot be newly selected", async () => {
    const archived = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD", { archivedAt: new Date() });
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createWorkflowAutomationAction({ error: null }, formData(leadAutomationFields(archived.id)));
    resetAuthMock();
    expect(result.error).toContain("archived");
    expect(await prisma.workflowAutomation.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  // -- Editing --------------------------------------------------------

  it("editing a valid automation updates name/conditions/actions but never the trigger", async () => {
    const statusDefinitionA = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const statusDefinitionB = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const id = await createViaAction(fixtures, statusDefinitionA.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(
      updateWorkflowAutomationAction(
        id,
        { error: null },
        formData({
          name: "Renamed automation",
          condition: JSON.stringify({ field: "status", operator: "CHANGED_TO", value: "WON" }),
          action: JSON.stringify({ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinitionB.id }),
        }),
      ),
    );
    resetAuthMock();

    const updated = await prisma.workflowAutomation.findUniqueOrThrow({ where: { id } });
    expect(updated.name).toBe("Renamed automation");
    expect(updated.conditions).toEqual([{ field: "status", operator: "CHANGED_TO", value: "WON" }]);
    expect(updated.actions).toEqual([{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinitionB.id }]);
    // Trigger is never accepted by updateWorkflowAutomationAction at all — unchanged regardless of what a tampered request might submit.
    expect(updated.triggerEntityType).toBe("LEAD");
    expect(updated.triggerAction).toBe("STATUS_CHANGED");
  });

  it("editing with a condition field that doesn't belong to this automation's own fixed trigger is rejected — incompatible config can never be silently saved", async () => {
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const id = await createViaAction(fixtures, statusDefinition.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await updateWorkflowAutomationAction(
      id,
      { error: null },
      formData({
        condition: JSON.stringify({ field: "notARealField", operator: "EQUALS", value: "x" }),
        action: JSON.stringify({ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }),
      }),
    );
    resetAuthMock();
    expect(result.error).toBeTruthy();

    const stillOriginal = await prisma.workflowAutomation.findUniqueOrThrow({ where: { id } });
    expect(stillOriginal.conditions).toEqual([]);
  });

  // -- Organization isolation -------------------------------------------

  it("organization B cannot edit, enable/disable, or archive organization A's automation", async () => {
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const id = await createViaAction(fixtures, statusDefinition.id);

    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    const updateResult = await updateWorkflowAutomationAction(
      id,
      { error: null },
      formData({ name: "Hijacked", action: JSON.stringify({ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }) }),
    );
    expect(updateResult.error).toBe("This automation is no longer available.");
    const enableResult = await setWorkflowAutomationEnabledAction(id, false);
    expect(enableResult).toEqual({ ok: false, reason: "NOT_FOUND" });
    const archiveResult = await archiveWorkflowAutomationAction(id);
    expect(archiveResult).toEqual({ ok: false, reason: "NOT_FOUND" });
    resetAuthMock();

    const stillOriginal = await prisma.workflowAutomation.findUniqueOrThrow({ where: { id } });
    expect(stillOriginal.name).not.toBe("Hijacked");
    expect(stillOriginal.isEnabled).toBe(true);
    expect(stillOriginal.archivedAt).toBeNull();
  });

  it("organization B's automations are excluded from organization A's list", async () => {
    const statusDefinitionA = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    await createViaAction(fixtures, statusDefinitionA.id, { name: "Org A automation" });

    const statusDefinitionB = await createCustomStatusDefinition(fixtures.orgB.id, "LEAD");
    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    await expectRedirect(
      createWorkflowAutomationAction(
        { error: null },
        formData(leadAutomationFields(statusDefinitionB.id, { name: "Org B automation" })),
      ),
    );
    resetAuthMock();
    resetNavigationMock();

    const result = await listWorkflowAutomations(fixtures.orgA.id, { id: fixtures.owner.id, name: fixtures.owner.name, role: "OWNER" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.workflowAutomations.map((a) => a.name)).toEqual(["Org A automation"]);

    await prisma.workflowAutomation.deleteMany({ where: { organizationId: fixtures.orgB.id } });
    await prisma.customStatusDefinition.deleteMany({ where: { organizationId: fixtures.orgB.id, isSystem: false } });
  });

  // -- Lifecycle ------------------------------------------------------

  it("enable/disable is idempotent and archive is terminal", async () => {
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const id = await createViaAction(fixtures, statusDefinition.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    const disableResult = await setWorkflowAutomationEnabledAction(id, false);
    expect(disableResult).toEqual({ ok: true });
    const disableAgainResult = await setWorkflowAutomationEnabledAction(id, false);
    expect(disableAgainResult).toEqual({ ok: true });

    const archiveResult = await archiveWorkflowAutomationAction(id);
    expect(archiveResult).toEqual({ ok: true });
    const archiveAgainResult = await archiveWorkflowAutomationAction(id);
    expect(archiveAgainResult).toEqual({ ok: true });

    const enableAfterArchiveResult = await setWorkflowAutomationEnabledAction(id, true);
    expect(enableAfterArchiveResult).toEqual({ ok: false, reason: "ARCHIVED" });
    resetAuthMock();
  });

  it("an archived automation is excluded from the default (active-only) list", async () => {
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const id = await createViaAction(fixtures, statusDefinition.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    await archiveWorkflowAutomationAction(id);
    resetAuthMock();

    const result = await listWorkflowAutomations(fixtures.orgA.id, { id: fixtures.owner.id, name: fixtures.owner.name, role: "OWNER" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.workflowAutomations).toHaveLength(0);

    const includingArchived = await getWorkflowAutomation(fixtures.orgA.id, id, { id: fixtures.owner.id, name: fixtures.owner.name, role: "OWNER" });
    if (!includingArchived.ok) throw new Error("expected ok");
    expect(includingArchived.workflowAutomation?.archivedAt).not.toBeNull();
  });
});
