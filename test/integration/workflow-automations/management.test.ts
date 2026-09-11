import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createWorkflowAutomation,
  updateWorkflowAutomation,
  setWorkflowAutomationEnabled,
  archiveWorkflowAutomation,
  getWorkflowAutomation,
  listWorkflowAutomations,
  type WorkflowAutomationActor,
} from "@/lib/workflow-automations/automations";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Workflow Automations Phase 1 — config/domain CRUD (authorization,
 * trigger/condition validation, lifecycle). Domain layer only, exercised
 * directly — no Server Action/UI layer exists yet, same "no Server
 * Action/UI layer yet" shape Recurring Invoices Phase 1's own
 * management.test.ts used.
 */

async function cleanupWorkflowAutomations(organizationIds: string[]) {
  await prisma.workflowAutomation.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

function actorFor(user: { id: string; name: string }, role: "OWNER" | "ADMIN" | "MEMBER"): WorkflowAutomationActor {
  return { id: user.id, name: user.name, role };
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Notify on lead loss",
    triggerEntityType: "LEAD",
    triggerAction: "STATUS_CHANGED",
    conditions: [{ field: "status", operator: "CHANGED_TO", value: "LOST" }],
    actions: [],
    ...overrides,
  };
}

describe("Workflow Automations — management", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupWorkflowAutomations([fixtures.orgA.id, fixtures.orgB.id]);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  // -- Authorization ---------------------------------------------------

  it("an OWNER can create automation configuration", async () => {
    const result = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.workflowAutomation.organizationId).toBe(fixtures.orgA.id);
    expect(result.workflowAutomation.isEnabled).toBe(true);
    expect(result.workflowAutomation.archivedAt).toBeNull();
    expect(result.workflowAutomation.createdByUserId).toBe(fixtures.owner.id);
  });

  it("an ADMIN can create automation configuration", async () => {
    const result = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.admin, "ADMIN"), validInput());
    expect(result.ok).toBe(true);
  });

  it("a MEMBER cannot create automation configuration", async () => {
    const result = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.member, "MEMBER"), validInput());
    expect(result).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(await prisma.workflowAutomation.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("a MEMBER cannot update automation configuration", async () => {
    const created = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput());
    if (!created.ok) throw new Error("expected ok");
    const result = await updateWorkflowAutomation(fixtures.orgA.id, created.workflowAutomation.id, actorFor(fixtures.member, "MEMBER"), {
      name: "Renamed",
    });
    expect(result).toEqual({ ok: false, reason: "FORBIDDEN" });
  });

  it("a MEMBER cannot enable/disable automation configuration", async () => {
    const created = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput());
    if (!created.ok) throw new Error("expected ok");
    const result = await setWorkflowAutomationEnabled(fixtures.orgA.id, created.workflowAutomation.id, actorFor(fixtures.member, "MEMBER"), false);
    expect(result).toEqual({ ok: false, reason: "FORBIDDEN" });
  });

  it("a MEMBER cannot archive automation configuration", async () => {
    const created = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput());
    if (!created.ok) throw new Error("expected ok");
    const result = await archiveWorkflowAutomation(fixtures.orgA.id, created.workflowAutomation.id, actorFor(fixtures.member, "MEMBER"));
    expect(result).toEqual({ ok: false, reason: "FORBIDDEN" });
  });

  it("a MEMBER cannot list or read automation configuration", async () => {
    const created = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput());
    if (!created.ok) throw new Error("expected ok");
    expect(await listWorkflowAutomations(fixtures.orgA.id, actorFor(fixtures.member, "MEMBER"))).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(await getWorkflowAutomation(fixtures.orgA.id, created.workflowAutomation.id, actorFor(fixtures.member, "MEMBER"))).toEqual({
      ok: false,
      reason: "FORBIDDEN",
    });
  });

  it("organization B cannot read organization A's automation", async () => {
    const created = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput());
    if (!created.ok) throw new Error("expected ok");
    const result = await getWorkflowAutomation(fixtures.orgB.id, created.workflowAutomation.id, actorFor(fixtures.orgBOwner, "OWNER"));
    expect(result).toEqual({ ok: true, workflowAutomation: null });
  });

  it("organization B cannot update organization A's automation", async () => {
    const created = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput());
    if (!created.ok) throw new Error("expected ok");
    const result = await updateWorkflowAutomation(fixtures.orgB.id, created.workflowAutomation.id, actorFor(fixtures.orgBOwner, "OWNER"), {
      name: "Hijacked",
    });
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
    const stillOriginal = await prisma.workflowAutomation.findUniqueOrThrow({ where: { id: created.workflowAutomation.id } });
    expect(stillOriginal.name).toBe("Notify on lead loss");
  });

  it("organization B's automations are excluded from organization A's list", async () => {
    await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput({ name: "A automation" }));
    await createWorkflowAutomation(fixtures.orgB.id, actorFor(fixtures.orgBOwner, "OWNER"), validInput({ name: "B automation" }));
    const result = await listWorkflowAutomations(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"));
    if (!result.ok) throw new Error("expected ok");
    expect(result.workflowAutomations.map((a) => a.name)).toEqual(["A automation"]);
  });

  // -- Trigger validation -----------------------------------------------

  it("an invalid triggerEntityType is rejected", async () => {
    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      validInput({ triggerEntityType: "NOT_A_REAL_ENTITY" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.reason).toBe("VALIDATION");
  });

  it("an invalid triggerAction is rejected", async () => {
    const result = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput({ triggerAction: "NOT_A_REAL_ACTION" }));
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.reason).toBe("VALIDATION");
  });

  it("a real but unsupported (entityType, action) pair is rejected — QUOTE.STATUS_CHANGED is deliberately not in the V1 allowlist", async () => {
    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      validInput({ triggerEntityType: "QUOTE", triggerAction: "STATUS_CHANGED", conditions: [] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.reason).toBe("VALIDATION");
    expect(result.error).toContain("not a supported Workflow Automations trigger");
  });

  it("a real but unsupported CREATED pair on an allowlisted-for-a-different-action entity is rejected — LEAD.CREATED is not the same as LEAD.STATUS_CHANGED", async () => {
    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      validInput({ triggerEntityType: "LEAD", triggerAction: "CREATED", conditions: [] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.reason).toBe("VALIDATION");
  });

  // -- Condition validation ----------------------------------------------

  it("malformed conditions (not an array) is rejected", async () => {
    const result = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput({ conditions: { field: "status" } }));
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain("conditions must be an array");
  });

  it("a condition field not in the trigger's own vocabulary is rejected", async () => {
    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      validInput({ conditions: [{ field: "notARealField", operator: "EQUALS", value: "LOST" }] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain("conditions[0].field");
  });

  it("an unrecognized operator is rejected", async () => {
    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      validInput({ conditions: [{ field: "status", operator: "STARTS_WITH", value: "L" }] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain("conditions[0].operator");
  });

  it("a value outside the field's closed allowedValues is rejected", async () => {
    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      validInput({ conditions: [{ field: "status", operator: "EQUALS", value: "NOT_A_REAL_STAGE" }] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain("conditions[0].value");
  });

  it("CHANGED_TO/CHANGED_FROM are rejected against CLIENT.CREATED's snapshot-only field (no real transition exists)", async () => {
    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      validInput({
        triggerEntityType: "CLIENT",
        triggerAction: "CREATED",
        conditions: [{ field: "status", operator: "CHANGED_TO", value: "ACTIVE" }],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain("before/after transition");
  });

  it("EXISTS with a value is rejected — EXISTS never reads value", async () => {
    const result = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      validInput({ conditions: [{ field: "status", operator: "EXISTS", value: "LOST" }] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "VALIDATION") throw new Error("expected a VALIDATION failure");
    expect(result.error).toContain('value must be omitted for operator "EXISTS"');
  });

  // -- Round-trip / persistence -------------------------------------------

  it("a valid configuration persists and round-trips correctly", async () => {
    const created = await createWorkflowAutomation(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      validInput({
        name: "  Notify on lead loss  ", // leading/trailing whitespace must be trimmed
        conditions: [
          { field: "status", operator: "CHANGED_TO", value: "LOST" },
          { field: "status", operator: "EXISTS" },
        ],
      }),
    );
    if (!created.ok) throw new Error("expected ok");
    expect(created.workflowAutomation.name).toBe("Notify on lead loss");

    const fetched = await getWorkflowAutomation(fixtures.orgA.id, created.workflowAutomation.id, actorFor(fixtures.owner, "OWNER"));
    if (!fetched.ok || !fetched.workflowAutomation) throw new Error("expected a row");
    expect(fetched.workflowAutomation.triggerEntityType).toBe("LEAD");
    expect(fetched.workflowAutomation.triggerAction).toBe("STATUS_CHANGED");
    expect(fetched.workflowAutomation.conditions).toEqual([
      { field: "status", operator: "CHANGED_TO", value: "LOST" },
      { field: "status", operator: "EXISTS" },
    ]);
    expect(fetched.workflowAutomation.actions).toEqual([]);
  });

  it("update replaces conditions and records changedFields, leaving the trigger untouched", async () => {
    const created = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput());
    if (!created.ok) throw new Error("expected ok");

    const updated = await updateWorkflowAutomation(fixtures.orgA.id, created.workflowAutomation.id, actorFor(fixtures.admin, "ADMIN"), {
      name: "Renamed automation",
      conditions: [{ field: "status", operator: "CHANGED_FROM", value: "NEW" }],
    });
    if (!updated.ok) throw new Error("expected ok");
    expect(updated.workflowAutomation.name).toBe("Renamed automation");
    expect(updated.workflowAutomation.conditions).toEqual([{ field: "status", operator: "CHANGED_FROM", value: "NEW" }]);
    expect(updated.workflowAutomation.triggerEntityType).toBe("LEAD");
    expect(updated.workflowAutomation.triggerAction).toBe("STATUS_CHANGED");

    const activity = await prisma.activity.findFirst({
      where: { entityType: "WORKFLOW_AUTOMATION", entityId: created.workflowAutomation.id, action: "UPDATED" },
    });
    expect(activity).not.toBeNull();
    expect((activity?.metadata as { changedFields?: string[] })?.changedFields).toEqual(["name", "conditions"]);
  });

  it("an update with no actual change is a no-op (no new Activity row)", async () => {
    const created = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput());
    if (!created.ok) throw new Error("expected ok");
    const before = await prisma.activity.count({ where: { entityType: "WORKFLOW_AUTOMATION", entityId: created.workflowAutomation.id } });

    const updated = await updateWorkflowAutomation(fixtures.orgA.id, created.workflowAutomation.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Notify on lead loss",
    });
    if (!updated.ok) throw new Error("expected ok");

    const after = await prisma.activity.count({ where: { entityType: "WORKFLOW_AUTOMATION", entityId: created.workflowAutomation.id } });
    expect(after).toBe(before);
  });

  // -- Enable / disable ----------------------------------------------------

  it("enable/disable toggles isEnabled and is idempotent", async () => {
    const created = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput());
    if (!created.ok) throw new Error("expected ok");
    expect(created.workflowAutomation.isEnabled).toBe(true);

    const disabled = await setWorkflowAutomationEnabled(fixtures.orgA.id, created.workflowAutomation.id, actorFor(fixtures.owner, "OWNER"), false);
    if (!disabled.ok) throw new Error("expected ok");
    expect(disabled.workflowAutomation.isEnabled).toBe(false);

    // Idempotent no-op — disabling an already-disabled row succeeds without error.
    const disabledAgain = await setWorkflowAutomationEnabled(fixtures.orgA.id, created.workflowAutomation.id, actorFor(fixtures.owner, "OWNER"), false);
    if (!disabledAgain.ok) throw new Error("expected ok");
    expect(disabledAgain.workflowAutomation.isEnabled).toBe(false);

    const enabled = await setWorkflowAutomationEnabled(fixtures.orgA.id, created.workflowAutomation.id, actorFor(fixtures.owner, "OWNER"), true);
    if (!enabled.ok) throw new Error("expected ok");
    expect(enabled.workflowAutomation.isEnabled).toBe(true);
  });

  it("an archived automation cannot be re-enabled/disabled", async () => {
    const created = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput());
    if (!created.ok) throw new Error("expected ok");
    await archiveWorkflowAutomation(fixtures.orgA.id, created.workflowAutomation.id, actorFor(fixtures.owner, "OWNER"));

    const result = await setWorkflowAutomationEnabled(fixtures.orgA.id, created.workflowAutomation.id, actorFor(fixtures.owner, "OWNER"), true);
    expect(result).toEqual({ ok: false, reason: "ARCHIVED" });
  });

  // -- Archive / listing -----------------------------------------------

  it("archive is terminal and idempotent, and excludes the row from the default (active-only) list", async () => {
    const created = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput());
    if (!created.ok) throw new Error("expected ok");

    const archived = await archiveWorkflowAutomation(fixtures.orgA.id, created.workflowAutomation.id, actorFor(fixtures.owner, "OWNER"));
    if (!archived.ok) throw new Error("expected ok");
    expect(archived.workflowAutomation.archivedAt).not.toBeNull();

    // Idempotent — archiving twice succeeds and doesn't move the timestamp to null or error.
    const archivedAgain = await archiveWorkflowAutomation(fixtures.orgA.id, created.workflowAutomation.id, actorFor(fixtures.owner, "OWNER"));
    if (!archivedAgain.ok) throw new Error("expected ok");
    expect(archivedAgain.workflowAutomation.archivedAt).not.toBeNull();

    const defaultList = await listWorkflowAutomations(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"));
    if (!defaultList.ok) throw new Error("expected ok");
    expect(defaultList.workflowAutomations).toHaveLength(0);

    const fullList = await listWorkflowAutomations(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), { includeArchived: true });
    if (!fullList.ok) throw new Error("expected ok");
    expect(fullList.workflowAutomations).toHaveLength(1);
  });

  it("creating an automation records a WORKFLOW_AUTOMATION/CREATED Activity row, never containing raw conditions/actions JSON", async () => {
    const created = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput());
    if (!created.ok) throw new Error("expected ok");

    const activity = await prisma.activity.findFirst({
      where: { entityType: "WORKFLOW_AUTOMATION", entityId: created.workflowAutomation.id, action: "CREATED" },
    });
    expect(activity).not.toBeNull();
    expect(activity?.organizationId).toBe(fixtures.orgA.id);
    expect(activity?.actorId).toBe(fixtures.owner.id);
    const metadata = activity?.metadata as Record<string, unknown>;
    expect(metadata.name).toBe("Notify on lead loss");
    expect(JSON.stringify(metadata)).not.toContain("CHANGED_TO");
  });
});
