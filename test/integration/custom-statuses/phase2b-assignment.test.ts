import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createClientAction } from "@/app/(dashboard)/clients/new/actions";
import { updateClientAction } from "@/app/(dashboard)/clients/[id]/edit/actions";
import { createProjectAction } from "@/app/(dashboard)/projects/new/actions";
import { updateProjectAction } from "@/app/(dashboard)/projects/[id]/edit/actions";
import {
  createLeadAction,
  assignLeadStatusDefinitionAction,
  markLeadLostAction,
  convertLeadToClientAction,
} from "@/app/(dashboard)/leads/actions";
import { createCustomStatusDefinition, archiveCustomStatusDefinition } from "@/lib/custom-statuses/definitions";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * Custom Statuses Phase 2B — Client/Project/Lead generic status
 * ASSIGNMENT via the real Server Actions (Section Z CLIENT 21-30, LEAD
 * 31-42, PROJECT 43-50, SECURITY 57-64, as they apply to the new
 * assignment surface added in this phase — the sync/compatibility
 * behavior for a SYSTEM target was already proven in
 * custom-statuses/system-semantics.test.ts; this file covers the new
 * CUSTOM-target and security paths that phase specifically added).
 *
 * Section M is CRITICAL: assignLeadStatusDefinitionAction must never let
 * a generic status pick silently perform a WON/LOST business action.
 */

function uniqueName(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
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

async function findSystemDef(organizationId: string, entityType: "CLIENT" | "LEAD" | "PROJECT", key: string) {
  return prisma.customStatusDefinition.findFirstOrThrow({ where: { organizationId, entityType, isSystem: true, key } });
}

describe("Custom Statuses Phase 2B — Client/Project/Lead assignment via the real Server Actions", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgB.id);
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { organizationId: fixtures.orgA.id, id: { not: fixtures.clientA.id } } });
    await prisma.project.deleteMany({ where: { organizationId: fixtures.orgA.id, id: { not: fixtures.project.id } } });
    await prisma.lead.deleteMany({ where: { organizationId: fixtures.orgA.id } });
    await cleanupTestData(fixtures);
  });

  // ---------------------------------------------------------------------
  // Client — CUSTOM target
  // ---------------------------------------------------------------------

  it("Client CREATE with a CUSTOM target: statusDefinitionId is authoritative, legacy column falls back to the pre-existing hardcoded default ('LEAD'), never a new value", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "VIP" });
    if (!customDef.ok) throw new Error("expected ok");
    const name = uniqueName("Client");

    await expectRedirect(createClientAction({ error: null }, buildFormData({ name, statusDefinitionId: customDef.definition.id })));

    const client = await prisma.client.findFirstOrThrow({ where: { name } });
    expect(client.statusDefinitionId).toBe(customDef.definition.id);
    expect(client.status).toBe("LEAD");
  });

  it("Client EDIT with a CUSTOM target: the legacy column is left completely untouched (not synced to any fallback)", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = uniqueName("Client");
    await expectRedirect(
      createClientAction(
        { error: null },
        buildFormData({ name, statusDefinitionId: (await findSystemDef(fixtures.orgA.id, "CLIENT", "active")).id }),
      ),
    );
    const client = await prisma.client.findFirstOrThrow({ where: { name } });
    expect(client.status).toBe("ACTIVE");

    const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "Dormant" });
    if (!customDef.ok) throw new Error("expected ok");
    await expectRedirect(
      updateClientAction(client.id, { error: null }, buildFormData({ name, statusDefinitionId: customDef.definition.id })),
    );

    const updated = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(updated.statusDefinitionId).toBe(customDef.definition.id);
    // Untouched: still the legacy value from before this edit, never a new fallback.
    expect(updated.status).toBe("ACTIVE");
  });

  it("Client EDIT: an archived definition cannot be newly assigned, but the entity's own current archived status can be kept unchanged", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const activeDef = await findSystemDef(fixtures.orgA.id, "CLIENT", "active");
    const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "Fading" });
    if (!customDef.ok) throw new Error("expected ok");
    const name = uniqueName("Client");
    await expectRedirect(createClientAction({ error: null }, buildFormData({ name, statusDefinitionId: customDef.definition.id })));
    const client = await prisma.client.findFirstOrThrow({ where: { name } });

    await archiveCustomStatusDefinition(fixtures.orgA.id, customDef.definition.id);

    // Resubmitting the SAME (now-archived) status is allowed — it's this
    // Client's own existing current status, not a new selection.
    await expectRedirect(
      updateClientAction(client.id, { error: null }, buildFormData({ name, statusDefinitionId: customDef.definition.id })),
    );
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).statusDefinitionId).toBe(customDef.definition.id);

    // A DIFFERENT client cannot newly select that same now-archived status.
    const otherName = uniqueName("Client");
    const result = await createClientAction({ error: null }, buildFormData({ name: otherName, statusDefinitionId: customDef.definition.id }));
    expect(result).toEqual({
      error: null,
      fieldErrors: { statusDefinitionId: "This status is archived and can't be assigned." },
    });

    // Switching an unrelated field on the archived-status client to a
    // DIFFERENT status is also rejected for that archived target.
    const secondClient = await prisma.client.findFirstOrThrow({ where: { name: fixtures.clientA.name } });
    const rejected = await updateClientAction(
      secondClient.id,
      { error: null },
      buildFormData({ name: secondClient.name, statusDefinitionId: customDef.definition.id }),
    );
    expect(rejected).toEqual({
      error: null,
      fieldErrors: { statusDefinitionId: "This status is archived and can't be assigned." },
    });
    void activeDef;
  });

  // ---------------------------------------------------------------------
  // Client — security (Section S)
  // ---------------------------------------------------------------------

  it("Client CREATE rejects a statusDefinitionId belonging to a DIFFERENT organization", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const orgBDef = await findSystemDef(fixtures.orgB.id, "CLIENT", "lead");
    const name = uniqueName("Client");

    const result = await createClientAction({ error: null }, buildFormData({ name, statusDefinitionId: orgBDef.id }));
    expect(result).toEqual({ error: null, fieldErrors: { statusDefinitionId: "Select a valid status." } });
    expect(await prisma.client.findFirst({ where: { name } })).toBeNull();
  });

  it("Client CREATE rejects a statusDefinitionId with the WRONG entityType (a LEAD definition on the Client form)", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const leadDef = await findSystemDef(fixtures.orgA.id, "LEAD", "new");
    const name = uniqueName("Client");

    const result = await createClientAction({ error: null }, buildFormData({ name, statusDefinitionId: leadDef.id }));
    expect(result).toEqual({ error: null, fieldErrors: { statusDefinitionId: "Select a valid status." } });
    expect(await prisma.client.findFirst({ where: { name } })).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Project — CUSTOM target + security
  // ---------------------------------------------------------------------

  it("Project CREATE with a CUSTOM target: statusDefinitionId is authoritative, legacy column falls back to the pre-existing hardcoded default ('PLANNING')", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "PROJECT", { label: "Discovery" });
    if (!customDef.ok) throw new Error("expected ok");
    const name = uniqueName("Project");

    await expectRedirect(
      createProjectAction(
        { error: null },
        buildFormData({ name, clientId: fixtures.clientA.id, statusDefinitionId: customDef.definition.id }),
      ),
    );

    const project = await prisma.project.findFirstOrThrow({ where: { name } });
    expect(project.statusDefinitionId).toBe(customDef.definition.id);
    expect(project.status).toBe("PLANNING");
  });

  it("Project CREATE rejects an archived definition for a new Project", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "PROJECT", { label: "Shelved" });
    if (!customDef.ok) throw new Error("expected ok");
    await archiveCustomStatusDefinition(fixtures.orgA.id, customDef.definition.id);
    const name = uniqueName("Project");

    const result = await createProjectAction(
      { error: null },
      buildFormData({ name, clientId: fixtures.clientA.id, statusDefinitionId: customDef.definition.id }),
    );
    expect(result).toEqual({
      error: null,
      fieldErrors: { statusDefinitionId: "This status is archived and can't be assigned." },
    });
    expect(await prisma.project.findFirst({ where: { name } })).toBeNull();
  });

  it("Project EDIT: a custom status resembling IN_PROGRESS never satisfies the real system IN_PROGRESS semantic check", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "PROJECT", { label: "In Progress (Custom)" });
    if (!customDef.ok) throw new Error("expected ok");

    await expectRedirect(
      updateProjectAction(
        fixtures.project.id,
        { error: null },
        buildFormData({ name: fixtures.project.name, clientId: fixtures.clientA.id, statusDefinitionId: customDef.definition.id }),
      ),
    );

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: fixtures.project.id },
      include: { statusDefinition: { select: { isSystem: true, entityType: true, key: true } } },
    });
    // isSystem is the only real signal — a look-alike label/key never counts.
    expect(project.statusDefinition?.isSystem).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Lead — generic assignment (Section M, CRITICAL)
  // ---------------------------------------------------------------------

  it("assignLeadStatusDefinitionAction with a CUSTOM target writes only statusDefinitionId — `stage` is left completely untouched", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const createResult = await createLeadAction({ name: uniqueName("Lead") });
    if (!createResult.ok) throw new Error("expected ok");
    const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD", { label: "Nurturing" });
    if (!customDef.ok) throw new Error("expected ok");

    const result = await assignLeadStatusDefinitionAction(createResult.leadId, customDef.definition.id);
    expect(result).toEqual({ ok: true });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: createResult.leadId } });
    expect(lead.statusDefinitionId).toBe(customDef.definition.id);
    // Untouched — creation's own NEW stage stays exactly as it was.
    expect(lead.stage).toBe("NEW");
  });

  it("assignLeadStatusDefinitionAction with a non-LOST SYSTEM target delegates to the real stage-move invariants (stage syncs too)", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const createResult = await createLeadAction({ name: uniqueName("Lead") });
    if (!createResult.ok) throw new Error("expected ok");
    const qualifiedDef = await findSystemDef(fixtures.orgA.id, "LEAD", "qualified");

    const result = await assignLeadStatusDefinitionAction(createResult.leadId, qualifiedDef.id);
    expect(result).toEqual({ ok: true });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: createResult.leadId } });
    expect(lead.stage).toBe("QUALIFIED");
    expect(lead.statusDefinitionId).toBe(qualifiedDef.id);
  });

  it("assignLeadStatusDefinitionAction REJECTS the system LOST definition — LOST can only ever be reached through markLeadLostAction's own dedicated dialog", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const createResult = await createLeadAction({ name: uniqueName("Lead") });
    if (!createResult.ok) throw new Error("expected ok");
    const lostDef = await findSystemDef(fixtures.orgA.id, "LEAD", "lost");

    const result = await assignLeadStatusDefinitionAction(createResult.leadId, lostDef.id);
    expect(result).toEqual({ ok: false, reason: "use_mark_lost_action" });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: createResult.leadId } });
    // Nothing changed — no lostReason was ever collected, so the Lead
    // must not have silently become LOST.
    expect(lead.stage).toBe("NEW");
    expect(lead.lostReason).toBeNull();
  });

  it("assignLeadStatusDefinitionAction with WON stays reachable (matches moveLeadStageAction's own pre-existing 'won but not converted' behavior)", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const createResult = await createLeadAction({ name: uniqueName("Lead") });
    if (!createResult.ok) throw new Error("expected ok");
    const wonDef = await findSystemDef(fixtures.orgA.id, "LEAD", "won");

    const result = await assignLeadStatusDefinitionAction(createResult.leadId, wonDef.id);
    expect(result).toEqual({ ok: true });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: createResult.leadId } });
    expect(lead.stage).toBe("WON");
    expect(lead.convertedClientId).toBeNull();
  });

  it("assignLeadStatusDefinitionAction with a CUSTOM target clears lostReason when reactivating out of LOST, exactly like every other stage-changing action", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const createResult = await createLeadAction({ name: uniqueName("Lead") });
    if (!createResult.ok) throw new Error("expected ok");
    await markLeadLostAction(createResult.leadId, "Budget");
    const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD", { label: "Reconsidering" });
    if (!customDef.ok) throw new Error("expected ok");

    const result = await assignLeadStatusDefinitionAction(createResult.leadId, customDef.definition.id);
    expect(result).toEqual({ ok: true });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: createResult.leadId } });
    expect(lead.statusDefinitionId).toBe(customDef.definition.id);
    expect(lead.lostReason).toBeNull();
    // `stage` itself is a CUSTOM-target write's own business — never
    // touched — so it stays at whatever the legacy column last held.
    expect(lead.stage).toBe("LOST");
  });

  it("assignLeadStatusDefinitionAction respects the converted-lock — a converted Lead's status can never change through this generic action either", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const createResult = await createLeadAction({ name: uniqueName("Lead"), email: `convert-${randomUUID()}@example.com` });
    if (!createResult.ok) throw new Error("expected ok");
    const convertResult = await convertLeadToClientAction(createResult.leadId);
    expect(convertResult.ok).toBe(true);
    const qualifiedDef = await findSystemDef(fixtures.orgA.id, "LEAD", "qualified");

    const result = await assignLeadStatusDefinitionAction(createResult.leadId, qualifiedDef.id);
    expect(result).toEqual({ ok: false, reason: "converted_locked" });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: createResult.leadId } });
    expect(lead.stage).toBe("WON");
  });

  it("assignLeadStatusDefinitionAction rejects a foreign-org definition id, and a wrong-entityType (CLIENT) definition id", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const createResult = await createLeadAction({ name: uniqueName("Lead") });
    if (!createResult.ok) throw new Error("expected ok");

    const orgBDef = await findSystemDef(fixtures.orgB.id, "LEAD", "new");
    const foreignResult = await assignLeadStatusDefinitionAction(createResult.leadId, orgBDef.id);
    expect(foreignResult).toEqual({ ok: false, reason: "status_not_found" });

    const wrongTypeDef = await findSystemDef(fixtures.orgA.id, "CLIENT", "lead");
    const wrongTypeResult = await assignLeadStatusDefinitionAction(createResult.leadId, wrongTypeDef.id);
    expect(wrongTypeResult).toEqual({ ok: false, reason: "status_not_found" });
  });
});
