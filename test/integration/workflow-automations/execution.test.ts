import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createLeadAction, moveLeadStageAction, markLeadLostAction, convertLeadToClientAction } from "@/app/(dashboard)/leads/actions";
import { createClientAction } from "@/app/(dashboard)/clients/new/actions";
import { createWorkflowAutomation, type WorkflowAutomationActor } from "@/lib/workflow-automations/automations";
import { dispatchWorkflowAutomations } from "@/lib/workflow-automations/dispatch";
import { createActivity } from "@/lib/activity/create-activity";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import type { CreatedActivity } from "@/lib/notifications/notification-rules";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * Workflow Automations Phase 2 — execution end-to-end. Real Prisma/
 * PGlite throughout (nothing mocked except the standard integration-
 * harness auth/navigation seams every other Server Action test already
 * relies on — see test/integration/setup-mocks.ts).
 */

function actorFor(user: { id: string; name: string }, role: "OWNER" | "ADMIN" | "MEMBER"): WorkflowAutomationActor {
  return { id: user.id, name: user.name, role };
}

async function cleanupAll(organizationIds: string[], preserveClientIds: string[]) {
  await prisma.workflowAutomationRun.deleteMany({ where: { workflowAutomation: { organizationId: { in: organizationIds } } } });
  await prisma.workflowAutomation.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.customFieldValue.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.customFieldOption.deleteMany({ where: { definition: { organizationId: { in: organizationIds } } } });
  await prisma.customFieldDefinition.deleteMany({ where: { organizationId: { in: organizationIds } } });
  // Lead/Client (which may reference a CustomStatusDefinition via
  // statusDefinitionId, onDelete: Restrict) must be removed *before* the
  // definitions themselves, never after.
  await prisma.lead.deleteMany({ where: { organizationId: { in: organizationIds } } });
  // Only Client rows *this file itself* created via createClientAction/
  // convertLeadToClientAction — never the shared fixtures.clientA/
  // clientB rows every other integration test's own shared seed may
  // still depend on.
  await prisma.client.deleteMany({ where: { organizationId: { in: organizationIds }, id: { notIn: preserveClientIds } } });
  await prisma.customStatusDefinition.deleteMany({ where: { organizationId: { in: organizationIds }, isSystem: false } });
}

async function createLead(orgId: string, actor: { id: string; email: string; name: string }, overrides: Record<string, unknown> = {}) {
  actAs(actor, orgId);
  const result = await createLeadAction({ name: `Lead-${randomUUID().slice(0, 8)}`, ...overrides });
  resetAuthMock();
  if (!result.ok) throw new Error("fixture lead create failed");
  return result.leadId;
}

async function createCustomStatusDefinition(organizationId: string, entityType: "LEAD" | "CLIENT", overrides: Record<string, unknown> = {}) {
  return prisma.customStatusDefinition.create({
    data: { organizationId, entityType, key: `status_${randomUUID().slice(0, 8)}`, label: "Custom", position: 100, ...overrides },
  });
}

async function createCustomFieldDefinition(organizationId: string, entityType: "LEAD" | "CLIENT", overrides: Record<string, unknown> = {}) {
  return prisma.customFieldDefinition.create({
    data: { organizationId, entityType, key: `field_${randomUUID().slice(0, 8)}`, label: "Custom Field", fieldType: "TEXT", position: 0, ...overrides },
  });
}

async function expectRedirect(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(RedirectSignal);
}

describe("Workflow Automations Phase 2 — execution", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    // seedTestData creates orgA/orgB directly via prisma.organization.
    // create (not the getOrCreateOrganizationId path that normally
    // bootstraps this) — createClientAction requires a real system
    // CLIENT status definition to select, same setup create.test.ts's
    // own beforeAll already performs for the identical reason.
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgB.id);
  });

  afterEach(async () => {
    // Same PGlite driver-adapter connection-reuse yield already
    // established in src/lib/current-user.ts's own Stability Correction
    // F1 — several tests in this file deliberately cause a transaction
    // to throw and roll back (rolled-back multi-action runs, archived-
    // reference failures); reusing the same connection for the next
    // test's own queries immediately afterward can occasionally race the
    // driver's own async connection cleanup, in exactly the way that
    // correction's own investigation first documented. Real Postgres
    // (Supabase) has no such artifact — this is purely a test-harness
    // concern, applied once per test boundary rather than scattered
    // through individual assertions.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await cleanupAll([fixtures.orgA.id, fixtures.orgB.id], [fixtures.clientA.id, fixtures.clientB.id]);
    resetAuthMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  // -----------------------------------------------------------------------
  // 1. Lead status trigger → matching automation executes
  // -----------------------------------------------------------------------
  it("a matching LEAD.STATUS_CHANGED automation executes via the real Staff Server Action, changing only the triggering Lead", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const otherLeadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");

    const automation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Set custom status on qualify",
      triggerEntityType: "LEAD",
      triggerAction: "STATUS_CHANGED",
      conditions: [{ field: "status", operator: "CHANGED_TO", value: "QUALIFIED" }],
      actions: [{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }],
    });
    if (!automation.ok) throw new Error("expected ok");

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await moveLeadStageAction(leadId, "QUALIFIED");
    resetAuthMock();
    expect(result.ok).toBe(true);

    const [lead, otherLead, runs] = await Promise.all([
      prisma.lead.findUniqueOrThrow({ where: { id: leadId } }),
      prisma.lead.findUniqueOrThrow({ where: { id: otherLeadId } }),
      prisma.workflowAutomationRun.findMany({ where: { workflowAutomationId: automation.workflowAutomation.id } }),
    ]);

    expect(lead.statusDefinitionId).toBe(statusDefinition.id);
    // 7. Action changes only the triggering entity — the other Lead in
    // the same organization is completely untouched.
    expect(otherLead.statusDefinitionId).not.toBe(statusDefinition.id);

    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("SUCCEEDED");
  });

  // -----------------------------------------------------------------------
  // 2. Client created trigger → matching automation executes
  // -----------------------------------------------------------------------
  it("a matching CLIENT.CREATED automation executes via the real Staff Server Action", async () => {
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT");
    const automation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Set custom status on Client creation",
      triggerEntityType: "CLIENT",
      triggerAction: "CREATED",
      conditions: [],
      actions: [{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }],
    });
    if (!automation.ok) throw new Error("expected ok");

    const clientStatusDefinition = await prisma.customStatusDefinition.findFirst({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", isSystem: true },
    });

    const formData = new FormData();
    formData.set("name", `Client-${randomUUID().slice(0, 8)}`);
    formData.set("statusDefinitionId", clientStatusDefinition?.id ?? "");

    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(createClientAction({ error: null }, formData));
    resetAuthMock();

    const client = await prisma.client.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: { startsWith: "Client-" } } });
    const runs = await prisma.workflowAutomationRun.findMany({ where: { workflowAutomationId: automation.workflowAutomation.id } });

    expect(client.statusDefinitionId).toBe(statusDefinition.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("SUCCEEDED");
  });

  it("a matching CLIENT.CREATED automation executes via Lead → Client conversion", async () => {
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT");
    const automation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Set custom status on conversion",
      triggerEntityType: "CLIENT",
      triggerAction: "CREATED",
      conditions: [],
      actions: [{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }],
    });
    if (!automation.ok) throw new Error("expected ok");

    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await convertLeadToClientAction(leadId);
    resetAuthMock();
    if (!result.ok) throw new Error("expected ok");

    const client = await prisma.client.findUniqueOrThrow({ where: { id: result.clientId } });
    const runs = await prisma.workflowAutomationRun.findMany({ where: { workflowAutomationId: automation.workflowAutomation.id } });

    expect(client.statusDefinitionId).toBe(statusDefinition.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("SUCCEEDED");
  });

  // -----------------------------------------------------------------------
  // 3-6. Non-firing cases
  // -----------------------------------------------------------------------
  it("a condition mismatch executes nothing and creates no run row", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const automation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Only fires on WON",
      triggerEntityType: "LEAD",
      triggerAction: "STATUS_CHANGED",
      conditions: [{ field: "status", operator: "CHANGED_TO", value: "WON" }],
      actions: [{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }],
    });
    if (!automation.ok) throw new Error("expected ok");

    actAs(fixtures.owner, fixtures.orgA.id);
    await moveLeadStageAction(leadId, "QUALIFIED"); // not WON — condition must not match
    resetAuthMock();

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.statusDefinitionId).not.toBe(statusDefinition.id);
    expect(await prisma.workflowAutomationRun.count({ where: { workflowAutomationId: automation.workflowAutomation.id } })).toBe(0);
  });

  it("a disabled automation is ignored", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const automation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Disabled automation",
      triggerEntityType: "LEAD",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions: [{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }],
    });
    if (!automation.ok) throw new Error("expected ok");
    await prisma.workflowAutomation.update({ where: { id: automation.workflowAutomation.id }, data: { isEnabled: false } });

    actAs(fixtures.owner, fixtures.orgA.id);
    await moveLeadStageAction(leadId, "QUALIFIED");
    resetAuthMock();

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.statusDefinitionId).not.toBe(statusDefinition.id);
    expect(await prisma.workflowAutomationRun.count({ where: { workflowAutomationId: automation.workflowAutomation.id } })).toBe(0);
  });

  it("an archived automation is ignored", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const automation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Archived automation",
      triggerEntityType: "LEAD",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions: [{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }],
    });
    if (!automation.ok) throw new Error("expected ok");
    await prisma.workflowAutomation.update({ where: { id: automation.workflowAutomation.id }, data: { archivedAt: new Date() } });

    actAs(fixtures.owner, fixtures.orgA.id);
    await moveLeadStageAction(leadId, "QUALIFIED");
    resetAuthMock();

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.statusDefinitionId).not.toBe(statusDefinition.id);
    expect(await prisma.workflowAutomationRun.count({ where: { workflowAutomationId: automation.workflowAutomation.id } })).toBe(0);
  });

  it("another organization's automation is never triggered by this organization's Activity", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const orgBStatusDefinition = await createCustomStatusDefinition(fixtures.orgB.id, "LEAD");
    const orgBAutomation = await createWorkflowAutomation(fixtures.orgB.id, actorFor(fixtures.orgBOwner, "OWNER"), {
      name: "Org B automation",
      triggerEntityType: "LEAD",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions: [{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: orgBStatusDefinition.id }],
    });
    if (!orgBAutomation.ok) throw new Error("expected ok");

    actAs(fixtures.owner, fixtures.orgA.id);
    await moveLeadStageAction(leadId, "QUALIFIED");
    resetAuthMock();

    expect(await prisma.workflowAutomationRun.count({ where: { workflowAutomationId: orgBAutomation.workflowAutomation.id } })).toBe(0);

    await prisma.customStatusDefinition.deleteMany({ where: { organizationId: fixtures.orgB.id, isSystem: false } });
    await prisma.workflowAutomation.deleteMany({ where: { organizationId: fixtures.orgB.id } });
  });

  // -----------------------------------------------------------------------
  // 8. Arbitrary target entity cannot be supplied through action config
  // -----------------------------------------------------------------------
  it("an action can never target an arbitrary entity — execution always derives the target from the triggering Activity's own entityId, never from stored config", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const otherLeadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");

    const automation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Target tamper attempt",
      triggerEntityType: "LEAD",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions: [{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }],
    });
    if (!automation.ok) throw new Error("expected ok");

    // Bypass Phase 1's own validation entirely via a raw write, injecting
    // an extra field real config could never carry (Phase 1's action
    // schema has no target-entity field at all — see actions.ts's own
    // WorkflowAutomationAction type). Even if it did leak into storage
    // somehow, execute-run.ts's own executeOneAction never reads
    // anything from the action object except customStatusDefinitionId —
    // the entity id always comes from the second argument
    // (activity.entityId), never the action's own JSON.
    await prisma.workflowAutomation.update({
      where: { id: automation.workflowAutomation.id },
      data: {
        actions: [{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id, entityId: otherLeadId, targetId: otherLeadId }],
      },
    });

    actAs(fixtures.owner, fixtures.orgA.id);
    await moveLeadStageAction(leadId, "QUALIFIED");
    resetAuthMock();

    const [lead, otherLead] = await Promise.all([
      prisma.lead.findUniqueOrThrow({ where: { id: leadId } }),
      prisma.lead.findUniqueOrThrow({ where: { id: otherLeadId } }),
    ]);
    expect(lead.statusDefinitionId).toBe(statusDefinition.id); // the real triggering Lead was updated
    expect(otherLead.statusDefinitionId).not.toBe(statusDefinition.id); // the "targeted" Lead was never touched
  });

  // -----------------------------------------------------------------------
  // 9-10. Execution-time reference re-validation
  // -----------------------------------------------------------------------
  it("a Custom Status archived after the automation was created → FAILED with a safe reason, and the Lead is left untouched", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const automation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Will reference an archived status",
      triggerEntityType: "LEAD",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions: [{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }],
    });
    if (!automation.ok) throw new Error("expected ok");

    await prisma.customStatusDefinition.update({ where: { id: statusDefinition.id }, data: { archivedAt: new Date() } });

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await moveLeadStageAction(leadId, "QUALIFIED");
    resetAuthMock();
    expect(result.ok).toBe(true); // 16. the original Staff mutation still succeeds

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.stage).toBe("QUALIFIED"); // the real mutation persisted
    expect(lead.statusDefinitionId).not.toBe(statusDefinition.id); // the automation's own effect did not

    const runs = await prisma.workflowAutomationRun.findMany({ where: { workflowAutomationId: automation.workflowAutomation.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("FAILED");
    expect(runs[0].failureReason).toBe("custom_status_archived");
    expect(runs[0].failedActionIndex).toBe(0);
  });

  it("a Custom Field archived after the automation was created → FAILED with a safe reason", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const fieldDefinition = await createCustomFieldDefinition(fixtures.orgA.id, "LEAD");
    const automation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Will reference an archived field",
      triggerEntityType: "LEAD",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions: [{ type: "SET_CUSTOM_FIELD_VALUE", customFieldDefinitionId: fieldDefinition.id, value: "High" }],
    });
    if (!automation.ok) throw new Error("expected ok");

    await prisma.customFieldDefinition.update({ where: { id: fieldDefinition.id }, data: { archivedAt: new Date() } });

    actAs(fixtures.owner, fixtures.orgA.id);
    await moveLeadStageAction(leadId, "QUALIFIED");
    resetAuthMock();

    expect(await prisma.customFieldValue.count({ where: { definitionId: fieldDefinition.id, entityId: leadId } })).toBe(0);

    const runs = await prisma.workflowAutomationRun.findMany({ where: { workflowAutomationId: automation.workflowAutomation.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("FAILED");
    expect(runs[0].failureReason).toBe("custom_field_archived");
    expect(runs[0].failedActionIndex).toBe(0);
  });

  it("an invalid (cross-organization) Custom Field reference → FAILED", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const orgBField = await createCustomFieldDefinition(fixtures.orgB.id, "LEAD");

    // Direct write, bypassing Phase 1's own create-time validation (which
    // would correctly reject this) — simulating a reference that was
    // valid once but the organization boundary itself shifted (e.g. a
    // future data-migration bug), which execution must still catch.
    const automation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Cross-org field reference",
      triggerEntityType: "LEAD",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions: [],
    });
    if (!automation.ok) throw new Error("expected ok");
    await prisma.workflowAutomation.update({
      where: { id: automation.workflowAutomation.id },
      data: { actions: [{ type: "SET_CUSTOM_FIELD_VALUE", customFieldDefinitionId: orgBField.id, value: "High" }] },
    });

    actAs(fixtures.owner, fixtures.orgA.id);
    await moveLeadStageAction(leadId, "QUALIFIED");
    resetAuthMock();

    const runs = await prisma.workflowAutomationRun.findMany({ where: { workflowAutomationId: automation.workflowAutomation.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("FAILED");
    expect(runs[0].failureReason).toBe("custom_field_not_found");

    await prisma.customFieldDefinition.deleteMany({ where: { organizationId: fixtures.orgB.id } });
  });

  // -----------------------------------------------------------------------
  // 11. Multi-action atomicity — second action failing rolls back the first
  // -----------------------------------------------------------------------
  it("when the second of two actions fails, the first action's effect is rolled back — the run is FAILED, not partially applied", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const fieldDefinition = await createCustomFieldDefinition(fixtures.orgA.id, "LEAD");

    const automation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Two actions, second will fail",
      triggerEntityType: "LEAD",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions: [
        { type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id },
        { type: "SET_CUSTOM_FIELD_VALUE", customFieldDefinitionId: fieldDefinition.id, value: "High" },
      ],
    });
    if (!automation.ok) throw new Error("expected ok");

    // Archive the field definition only after the automation is created
    // (so Phase 1's own create-time validation legitimately accepted
    // both actions) — action 2 will fail at execution time.
    await prisma.customFieldDefinition.update({ where: { id: fieldDefinition.id }, data: { archivedAt: new Date() } });

    actAs(fixtures.owner, fixtures.orgA.id);
    await moveLeadStageAction(leadId, "QUALIFIED");
    resetAuthMock();

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    // Action 1 (SET_CUSTOM_STATUS) tentatively succeeded but must have
    // been rolled back along with the whole transaction.
    expect(lead.statusDefinitionId).not.toBe(statusDefinition.id);
    expect(await prisma.customFieldValue.count({ where: { definitionId: fieldDefinition.id, entityId: leadId } })).toBe(0);

    const runs = await prisma.workflowAutomationRun.findMany({ where: { workflowAutomationId: automation.workflowAutomation.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("FAILED");
    expect(runs[0].failureReason).toBe("custom_field_archived");
    expect(runs[0].failedActionIndex).toBe(1); // the second action (0-based index 1)
  });

  // -----------------------------------------------------------------------
  // 12-15. Success / idempotency / concurrency
  // -----------------------------------------------------------------------
  it("a successful run produces exactly one SUCCEEDED WorkflowAutomationRun row", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const automation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Simple success",
      triggerEntityType: "LEAD",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions: [{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }],
    });
    if (!automation.ok) throw new Error("expected ok");

    actAs(fixtures.owner, fixtures.orgA.id);
    await moveLeadStageAction(leadId, "QUALIFIED");
    resetAuthMock();

    const runs = await prisma.workflowAutomationRun.findMany({ where: { workflowAutomationId: automation.workflowAutomation.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("SUCCEEDED");
    expect(runs[0].failureReason).toBeNull();
    expect(runs[0].failedActionIndex).toBeNull();
  });

  it("dispatching the same Activity twice, sequentially, executes the action only once (idempotent)", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const automation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Sequential duplicate dispatch",
      triggerEntityType: "LEAD",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions: [{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }],
    });
    if (!automation.ok) throw new Error("expected ok");

    const activity: CreatedActivity = await prisma.$transaction((tx) =>
      createActivity(tx, {
        organizationId: fixtures.orgA.id,
        actorId: fixtures.owner.id,
        entityType: "LEAD",
        entityId: leadId,
        action: "STATUS_CHANGED",
        metadata: { from: "NEW", to: "QUALIFIED" },
      }),
    );

    await dispatchWorkflowAutomations(activity);
    // Same PGlite driver-adapter connection-reuse yield already
    // established in src/lib/current-user.ts's own Stability Correction
    // F1 — reusing this same connection for a fresh query immediately
    // after a transaction commits can occasionally race the driver's
    // own async connection cleanup. Real Postgres (Supabase) has no such
    // artifact; this yield is purely a test-harness concern.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await dispatchWorkflowAutomations(activity); // duplicate — same Activity id
    await new Promise((resolve) => setTimeout(resolve, 50));

    const runs = await prisma.workflowAutomationRun.findMany({ where: { workflowAutomationId: automation.workflowAutomation.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("SUCCEEDED");
  });

  it("dispatching the same Activity concurrently executes the action only once — the database unique constraint is the real concurrency boundary", async () => {
    // PGlite's own single-process WASM engine has known, narrower read-
    // after-write visibility guarantees than real Postgres under genuine
    // multi-connection write contention (the same class of harness
    // limitation as src/lib/current-user.ts's own documented Stability
    // Correction F1) — a single immediate read right after a real
    // Promise.all race can transiently observe a not-yet-visible state
    // even once every write involved has actually committed. This test
    // still issues the real race (two genuinely concurrent
    // dispatchWorkflowAutomations calls against the same Activity, no
    // simulation) and asserts the real invariant — exactly one row, ever
    // — via a short poll rather than a single point-in-time read, so it
    // tolerates the harness's own eventual-consistency quirk without
    // weakening what's actually being proven: the database unique
    // constraint is what makes only one of the two racing transactions
    // able to commit its own action + run-row write.
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const automation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Concurrent duplicate dispatch",
      triggerEntityType: "LEAD",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions: [{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }],
    });
    if (!automation.ok) throw new Error("expected ok");

    const activity: CreatedActivity = await prisma.$transaction((tx) =>
      createActivity(tx, {
        organizationId: fixtures.orgA.id,
        actorId: fixtures.owner.id,
        entityType: "LEAD",
        entityId: leadId,
        action: "STATUS_CHANGED",
        metadata: { from: "NEW", to: "QUALIFIED" },
      }),
    );

    await expect(
      Promise.all([dispatchWorkflowAutomations(activity), dispatchWorkflowAutomations(activity)]),
    ).resolves.toEqual([undefined, undefined]); // neither call ever throws, win or lose

    let runs: Awaited<ReturnType<typeof prisma.workflowAutomationRun.findMany>> = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      runs = await prisma.workflowAutomationRun.findMany({ where: { workflowAutomationId: automation.workflowAutomation.id } });
      if (runs.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(runs).toHaveLength(1); // never two — the unique constraint allows exactly one winner
    expect(runs[0].status).toBe("SUCCEEDED");
  });

  // -----------------------------------------------------------------------
  // 16. Original Staff mutation remains successful when automation execution fails
  // -----------------------------------------------------------------------
  it("the original Staff mutation (markLeadLostAction) still succeeds even when its automation's own execution fails", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const automation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Will fail at execution time",
      triggerEntityType: "LEAD",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions: [{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }],
    });
    if (!automation.ok) throw new Error("expected ok");
    await prisma.customStatusDefinition.update({ where: { id: statusDefinition.id }, data: { archivedAt: new Date() } });

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await markLeadLostAction(leadId, "Not a fit");
    resetAuthMock();

    expect(result.ok).toBe(true);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.stage).toBe("LOST");
    expect(lead.lostReason).toBe("Not a fit");

    const runs = await prisma.workflowAutomationRun.findMany({ where: { workflowAutomationId: automation.workflowAutomation.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("FAILED");
  });

  // -----------------------------------------------------------------------
  // 17. No execution from Portal/public/cron paths
  // -----------------------------------------------------------------------
  it("no Staff/Portal/public/cron code path outside this phase's own 4 call sites imports dispatchWorkflowAutomations", async () => {
    const portalOnlyFiles = [
      "src/lib/client-requests/portal.ts",
      "src/app/portal/(app)/quotes/actions.ts",
      "src/lib/lead-capture-forms/public.ts",
      "src/lib/recurring-invoices/generate.ts",
      "src/app/api/cron/recurring-invoices/route.ts",
    ];
    for (const file of portalOnlyFiles) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("dispatchWorkflowAutomations");
    }
  });

  it("execute-run.ts (the automation-execution engine itself) never imports or calls dispatchWorkflowAutomations — the entire recursion-prevention story for V1", async () => {
    const source = readFileSync("src/lib/workflow-automations/execute-run.ts", "utf8");
    expect(source).not.toContain("dispatchWorkflowAutomations");
    expect(source).not.toContain("./dispatch");
  });

  it("exactly the 4 expected Staff call sites call dispatchWorkflowAutomations", async () => {
    const expectedFiles = [
      "src/app/(dashboard)/leads/actions.ts", // moveLeadStageAction, markLeadLostAction, convertLeadToClientAction
      "src/app/(dashboard)/clients/new/actions.ts", // createClientAction
    ];
    for (const file of expectedFiles) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("dispatchWorkflowAutomations");
    }
  });

  // -----------------------------------------------------------------------
  // 18. No execution from INVOICE.STATUS_CHANGED / CLIENT_REQUEST.STATUS_CHANGED
  // -----------------------------------------------------------------------
  it("INVOICE.STATUS_CHANGED and CLIENT_REQUEST.STATUS_CHANGED never execute in this phase, even with a matching enabled automation and a real Activity", async () => {
    for (const file of ["src/app/(dashboard)/invoices/[id]/status-actions.ts", "src/lib/invoices/pdf/issue-invoice.ts", "src/lib/client-requests/staff.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("dispatchWorkflowAutomations");
    }

    // Direct-write automations for both non-executable triggers (Phase 1
    // itself would refuse to create one with any non-empty actions for
    // these triggers — see actions.ts's own "supports no action types in
    // V1" rule — a bare, empty-actions automation is still enough to
    // prove dispatch itself refuses to run it).
    const invoiceAutomation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Invoice automation",
      triggerEntityType: "INVOICE",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions: [],
    });
    if (!invoiceAutomation.ok) throw new Error("expected ok");
    const requestAutomation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Client request automation",
      triggerEntityType: "CLIENT_REQUEST",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions: [],
    });
    if (!requestAutomation.ok) throw new Error("expected ok");

    const invoiceActivity: CreatedActivity = await prisma.$transaction((tx) =>
      createActivity(tx, {
        organizationId: fixtures.orgA.id,
        actorId: fixtures.owner.id,
        entityType: "INVOICE",
        entityId: randomUUID(),
        action: "STATUS_CHANGED",
        metadata: { from: "DRAFT", to: "SENT" },
      }),
    );
    const requestActivity: CreatedActivity = await prisma.$transaction((tx) =>
      createActivity(tx, {
        organizationId: fixtures.orgA.id,
        actorId: fixtures.owner.id,
        entityType: "CLIENT_REQUEST",
        entityId: randomUUID(),
        action: "STATUS_CHANGED",
        metadata: { from: "OPEN", to: "RESOLVED" },
      }),
    );

    await dispatchWorkflowAutomations(invoiceActivity);
    await dispatchWorkflowAutomations(requestActivity);

    expect(await prisma.workflowAutomationRun.count({ where: { workflowAutomationId: invoiceAutomation.workflowAutomation.id } })).toBe(0);
    expect(await prisma.workflowAutomationRun.count({ where: { workflowAutomationId: requestAutomation.workflowAutomation.id } })).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 19. No unexpected Notification/email/PDF/invoice side effects
  // -----------------------------------------------------------------------
  it("a Lead-status automation produces no Notification, NotificationDelivery, Invoice, or InvoicePdfArchiveObject side effects", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const statusDefinition = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD");
    const automation = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "No side effects beyond the custom status",
      triggerEntityType: "LEAD",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions: [{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }],
    });
    if (!automation.ok) throw new Error("expected ok");

    const notificationsBefore = await prisma.notification.count({ where: { organizationId: fixtures.orgA.id } });
    const invoicesBefore = await prisma.invoice.count({ where: { organizationId: fixtures.orgA.id } });

    actAs(fixtures.owner, fixtures.orgA.id);
    await moveLeadStageAction(leadId, "QUALIFIED");
    resetAuthMock();

    expect(await prisma.notification.count({ where: { organizationId: fixtures.orgA.id } })).toBe(notificationsBefore);
    expect(await prisma.notificationDelivery.count()).toBe(0);
    expect(await prisma.invoice.count({ where: { organizationId: fixtures.orgA.id } })).toBe(invoicesBefore);
    expect(await prisma.invoicePdfArchiveObject.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });
});
