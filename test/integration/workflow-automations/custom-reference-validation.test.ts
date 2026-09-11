import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createWorkflowAutomation, type WorkflowAutomationActor } from "@/lib/workflow-automations/automations";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Workflow Automations Phase 1 — action configuration validation,
 * specifically the required Custom Status/Custom Field reference checks
 * (Section 6 of the Phase 1 spec): tenant isolation, entity-type
 * matching, and archived-definition rejection, all re-verified against
 * the database rather than trusted from the configuration JSON itself.
 */

function actorFor(user: { id: string; name: string }, role: "OWNER" | "ADMIN" | "MEMBER"): WorkflowAutomationActor {
  return { id: user.id, name: user.name, role };
}

async function cleanupAll(organizationIds: string[]) {
  await prisma.workflowAutomation.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.customFieldValue.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.customFieldOption.deleteMany({ where: { definition: { organizationId: { in: organizationIds } } } });
  await prisma.customFieldDefinition.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.customStatusDefinition.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

describe("Workflow Automations — action configuration: Custom Status/Custom Field reference validation", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupAll([fixtures.orgA.id, fixtures.orgB.id]);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  function leadInput(actions: unknown[]) {
    return {
      name: "Set custom status on lead loss",
      triggerEntityType: "LEAD",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions,
    };
  }

  // -- Forbidden / unrecognized action types ------------------------------

  it("an unrecognized action type is rejected", async () => {
    const result = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), leadInput([{ type: "SEND_EMAIL" }]));
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain("actions[0].type");
  });

  it("every explicitly forbidden V1 action category is rejected the same way (not allowlisted)", async () => {
    for (const type of ["ISSUE_INVOICE", "SEND_INVOICE_EMAIL", "GENERATE_RECURRING_INVOICE", "DELETE_ENTITY", "CALL_WEBHOOK"]) {
      const result = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), leadInput([{ type }]));
      expect(result.ok).toBe(false);
    }
  });

  it("malformed actions (not an array) is rejected", async () => {
    const result = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "x",
      triggerEntityType: "LEAD",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions: { type: "SET_CUSTOM_STATUS" },
    });
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain("actions must be an array");
  });

  it("a trigger with no Custom Status/Custom Field correspondence (INVOICE) accepts zero actions but rejects any", async () => {
    const zeroActions = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Invoice status automation",
      triggerEntityType: "INVOICE",
      triggerAction: "STATUS_CHANGED",
      conditions: [{ field: "status", operator: "CHANGED_TO", value: "PAID" }],
      actions: [],
    });
    expect(zeroActions.ok).toBe(true);

    const withAction = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Invoice status automation with action",
      triggerEntityType: "INVOICE",
      triggerAction: "STATUS_CHANGED",
      conditions: [],
      actions: [{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: "00000000-0000-0000-0000-000000000000" }],
    });
    expect(withAction.ok).toBe(false);
    if (withAction.ok || withAction.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(withAction.error).toContain("supports no action types in V1");
  });

  // -- SET_CUSTOM_STATUS reference validation ------------------------------

  it("SET_CUSTOM_STATUS: a nonexistent definition id is rejected", async () => {
    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      leadInput([{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: "00000000-0000-0000-0000-000000000000" }]),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain("does not exist");
  });

  it("SET_CUSTOM_STATUS: a definition from another organization is rejected", async () => {
    const orgBDefinition = await prisma.customStatusDefinition.create({
      data: { organizationId: fixtures.orgB.id, entityType: "LEAD", key: "custom_key", label: "Custom", position: 100 },
    });

    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      leadInput([{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: orgBDefinition.id }]),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain("does not exist");
  });

  it("SET_CUSTOM_STATUS: a definition for the wrong entity type (PROJECT, not LEAD) is rejected", async () => {
    const projectDefinition = await prisma.customStatusDefinition.create({
      data: { organizationId: fixtures.orgA.id, entityType: "PROJECT", key: "custom_key", label: "Custom", position: 100 },
    });

    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      leadInput([{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: projectDefinition.id }]),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain("does not exist");
  });

  it("SET_CUSTOM_STATUS: an archived definition cannot be newly selected", async () => {
    const archivedDefinition = await prisma.customStatusDefinition.create({
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "LEAD",
        key: "retired_key",
        label: "Retired",
        position: 100,
        archivedAt: new Date(),
      },
    });

    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      leadInput([{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: archivedDefinition.id }]),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain("archived");
  });

  it("SET_CUSTOM_STATUS: a real, owned, non-archived definition is accepted and persists", async () => {
    const definition = await prisma.customStatusDefinition.create({
      data: { organizationId: fixtures.orgA.id, entityType: "LEAD", key: "custom_key", label: "Custom", position: 100 },
    });

    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      leadInput([{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: definition.id }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.workflowAutomation.actions).toEqual([{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: definition.id }]);
  });

  // -- SET_CUSTOM_FIELD_VALUE reference validation -------------------------

  it("SET_CUSTOM_FIELD_VALUE: a definition from another organization is rejected", async () => {
    const orgBDefinition = await prisma.customFieldDefinition.create({
      data: { organizationId: fixtures.orgB.id, entityType: "LEAD", key: "priority_tier", label: "Priority Tier", fieldType: "TEXT", position: 0 },
    });

    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      leadInput([{ type: "SET_CUSTOM_FIELD_VALUE", customFieldDefinitionId: orgBDefinition.id, value: "High" }]),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain("does not exist");
  });

  it("SET_CUSTOM_FIELD_VALUE: a definition for the wrong entity type (CLIENT, not LEAD) is rejected", async () => {
    const clientFieldDefinition = await prisma.customFieldDefinition.create({
      data: { organizationId: fixtures.orgA.id, entityType: "CLIENT", key: "priority_tier", label: "Priority Tier", fieldType: "TEXT", position: 0 },
    });

    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      leadInput([{ type: "SET_CUSTOM_FIELD_VALUE", customFieldDefinitionId: clientFieldDefinition.id, value: "High" }]),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain("does not exist");
  });

  it("SET_CUSTOM_FIELD_VALUE: an archived definition cannot be newly selected", async () => {
    const archivedDefinition = await prisma.customFieldDefinition.create({
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "LEAD",
        key: "retired_field",
        label: "Retired",
        fieldType: "TEXT",
        position: 0,
        archivedAt: new Date(),
      },
    });

    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      leadInput([{ type: "SET_CUSTOM_FIELD_VALUE", customFieldDefinitionId: archivedDefinition.id, value: "x" }]),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain("archived");
  });

  it("SET_CUSTOM_FIELD_VALUE: a value incompatible with the field's type (NUMBER) is rejected", async () => {
    const numberField = await prisma.customFieldDefinition.create({
      data: { organizationId: fixtures.orgA.id, entityType: "LEAD", key: "deal_score", label: "Deal Score", fieldType: "NUMBER", position: 0 },
    });

    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      leadInput([{ type: "SET_CUSTOM_FIELD_VALUE", customFieldDefinitionId: numberField.id, value: "not-a-number" }]),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain("actions[0].value");
  });

  it("SET_CUSTOM_FIELD_VALUE: a SELECT value referencing an option from a different definition is rejected", async () => {
    const selectField = await prisma.customFieldDefinition.create({
      data: { organizationId: fixtures.orgA.id, entityType: "LEAD", key: "tier", label: "Tier", fieldType: "SELECT", position: 0 },
    });
    const otherSelectField = await prisma.customFieldDefinition.create({
      data: { organizationId: fixtures.orgA.id, entityType: "LEAD", key: "other_tier", label: "Other Tier", fieldType: "SELECT", position: 1 },
    });
    const foreignOption = await prisma.customFieldOption.create({
      data: { definitionId: otherSelectField.id, value: "gold", label: "Gold", position: 0 },
    });

    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      leadInput([{ type: "SET_CUSTOM_FIELD_VALUE", customFieldDefinitionId: selectField.id, value: foreignOption.id }]),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain("actions[0].value");
  });

  it("SET_CUSTOM_FIELD_VALUE: an archived SELECT option cannot be newly selected", async () => {
    const selectField = await prisma.customFieldDefinition.create({
      data: { organizationId: fixtures.orgA.id, entityType: "LEAD", key: "tier", label: "Tier", fieldType: "SELECT", position: 0 },
    });
    const archivedOption = await prisma.customFieldOption.create({
      data: { definitionId: selectField.id, value: "bronze", label: "Bronze", position: 0, archivedAt: new Date() },
    });

    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      leadInput([{ type: "SET_CUSTOM_FIELD_VALUE", customFieldDefinitionId: selectField.id, value: archivedOption.id }]),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain("archived");
  });

  it("SET_CUSTOM_FIELD_VALUE: a real, owned, non-archived TEXT definition with a compatible value is accepted and persists", async () => {
    const textField = await prisma.customFieldDefinition.create({
      data: { organizationId: fixtures.orgA.id, entityType: "LEAD", key: "priority_tier", label: "Priority Tier", fieldType: "TEXT", position: 0 },
    });

    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      leadInput([{ type: "SET_CUSTOM_FIELD_VALUE", customFieldDefinitionId: textField.id, value: "  High  " }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    // normalizeTextValue trims — the persisted value is the normalized form, never the raw input.
    expect(result.workflowAutomation.actions).toEqual([{ type: "SET_CUSTOM_FIELD_VALUE", customFieldDefinitionId: textField.id, value: "High" }]);
  });
});
