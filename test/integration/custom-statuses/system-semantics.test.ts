import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createClientAction } from "@/app/(dashboard)/clients/new/actions";
import { updateClientAction } from "@/app/(dashboard)/clients/[id]/edit/actions";
import { createLeadAction, moveLeadStageAction, markLeadLostAction, convertLeadToClientAction } from "@/app/(dashboard)/leads/actions";
import { createProjectAction } from "@/app/(dashboard)/projects/new/actions";
import { updateProjectAction } from "@/app/(dashboard)/projects/[id]/edit/actions";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * Custom Statuses Phase 1 — Section P/H/I/J compatibility-sync coverage,
 * exercised through the REAL, minimally-modified Client/Lead/Project
 * Server Actions (test items 31-39 of the originating task's own
 * Section Z). Proves the sync stays correct AND that nothing about
 * existing Lead WON/LOST/conversion, Client, or Project business
 * semantics changed.
 */

function uniqueName(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
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

async function findDefinition(organizationId: string, entityType: "CLIENT" | "LEAD" | "PROJECT", key: string) {
  return prisma.customStatusDefinition.findFirstOrThrow({ where: { organizationId, entityType, isSystem: true, key } });
}

describe("Custom Statuses — system semantics via the real Client/Lead/Project Server Actions", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    // orgB is deliberately left UNBOOTSTRAPPED — item 39 below proves the
    // Server Actions still succeed, fail-open, against an org with no
    // status definitions at all.
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    // Items 31/37 each create one brand-new Client/Project of their own
    // (never tracked by `fixtures`) — cleanupTestData's own clientIds
    // list only knows about fixtures.clientA/clientB, so these two must
    // be removed explicitly first. Once every Client (fixture-owned or
    // not) is gone, cleanupTestData's own Client-then-Organization
    // ordering safely cascades away Project/Lead/CustomStatusDefinition
    // exactly as test/integration/custom-statuses/migration.test.ts's
    // own items 7c/7d prove is required and safe.
    await prisma.client.deleteMany({ where: { organizationId: fixtures.orgA.id, id: { not: fixtures.clientA.id } } });
    await cleanupTestData(fixtures);
  });

  it("31. createClientAction syncs statusDefinitionId to the default 'lead' system definition when no status is chosen", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const leadDef = await findDefinition(fixtures.orgA.id, "CLIENT", "lead");

    await expectRedirect(
      createClientAction(
        { error: null },
        buildFormData({ name: uniqueName("Client"), status: "LEAD", statusDefinitionId: leadDef.id }),
      ),
    );

    const client = await prisma.client.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: { startsWith: "Client-" } }, orderBy: { createdAt: "desc" } });
    expect(client.status).toBe("LEAD");
    expect(client.statusDefinitionId).toBe(leadDef.id);
  });

  it("32. updateClientAction changing status to ACTIVE syncs statusDefinitionId to the 'active' system definition", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const activeDef = await findDefinition(fixtures.orgA.id, "CLIENT", "active");

    await expectRedirect(
      updateClientAction(
        fixtures.clientA.id,
        { error: null },
        buildFormData({ name: fixtures.clientA.name, status: "ACTIVE", statusDefinitionId: activeDef.id }),
      ),
    );

    const client = await prisma.client.findUniqueOrThrow({ where: { id: fixtures.clientA.id } });
    expect(client.status).toBe("ACTIVE");
    expect(client.statusDefinitionId).toBe(activeDef.id);
  });

  it("33. createLeadAction always creates at stage NEW, with statusDefinitionId synced to the 'new' system definition", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const newDef = await findDefinition(fixtures.orgA.id, "LEAD", "new");

    const result = await createLeadAction({ name: uniqueName("Lead") });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: result.leadId } });
    expect(lead.stage).toBe("NEW");
    expect(lead.statusDefinitionId).toBe(newDef.id);
  });

  it("34. moveLeadStageAction syncs statusDefinitionId to the target stage's own system definition, and preserves the existing 'clear lostReason only when leaving LOST' rule untouched", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const createResult = await createLeadAction({ name: uniqueName("Lead") });
    if (!createResult.ok) throw new Error("expected ok");
    await markLeadLostAction(createResult.leadId, "Budget");

    const qualifiedDef = await findDefinition(fixtures.orgA.id, "LEAD", "qualified");
    const moveResult = await moveLeadStageAction(createResult.leadId, "QUALIFIED");
    expect(moveResult).toEqual({ ok: true });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: createResult.leadId } });
    expect(lead.stage).toBe("QUALIFIED");
    expect(lead.statusDefinitionId).toBe(qualifiedDef.id);
    // Unchanged existing rule: reactivating out of LOST clears lostReason.
    expect(lead.lostReason).toBeNull();
  });

  it("35. markLeadLostAction syncs statusDefinitionId to the 'lost' system definition, alongside the existing stage/lostReason write — Section H: this is the one real path that carries LOST semantics, never a custom status", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const createResult = await createLeadAction({ name: uniqueName("Lead") });
    if (!createResult.ok) throw new Error("expected ok");
    const lostDef = await findDefinition(fixtures.orgA.id, "LEAD", "lost");

    const result = await markLeadLostAction(createResult.leadId, "Went quiet");
    expect(result).toEqual({ ok: true });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: createResult.leadId } });
    expect(lead.stage).toBe("LOST");
    expect(lead.lostReason).toBe("Went quiet");
    expect(lead.statusDefinitionId).toBe(lostDef.id);
  });

  it("36. convertLeadToClientAction syncs BOTH the new Client (ACTIVE) and the converted Lead (WON) to their own system definitions, alongside the existing conversion/quote-reconciliation behavior, completely unchanged", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const createResult = await createLeadAction({ name: uniqueName("Lead"), email: `convert-${randomUUID()}@example.com` });
    if (!createResult.ok) throw new Error("expected ok");
    const activeDef = await findDefinition(fixtures.orgA.id, "CLIENT", "active");
    const wonDef = await findDefinition(fixtures.orgA.id, "LEAD", "won");

    const result = await convertLeadToClientAction(createResult.leadId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const client = await prisma.client.findUniqueOrThrow({ where: { id: result.clientId } });
    expect(client.status).toBe("ACTIVE");
    expect(client.statusDefinitionId).toBe(activeDef.id);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: createResult.leadId } });
    expect(lead.stage).toBe("WON");
    expect(lead.statusDefinitionId).toBe(wonDef.id);
    expect(lead.convertedClientId).toBe(result.clientId);
  });

  it("37. createProjectAction syncs statusDefinitionId to the chosen status's own system definition", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const inProgressDef = await findDefinition(fixtures.orgA.id, "PROJECT", "in_progress");

    await expectRedirect(
      createProjectAction(
        { error: null },
        buildFormData({
          name: uniqueName("Project"),
          status: "IN_PROGRESS",
          clientId: fixtures.clientA.id,
          statusDefinitionId: inProgressDef.id,
        }),
      ),
    );

    const project = await prisma.project.findFirstOrThrow({
      where: { organizationId: fixtures.orgA.id, name: { startsWith: "Project-" } },
      orderBy: { createdAt: "desc" },
    });
    expect(project.status).toBe("IN_PROGRESS");
    expect(project.statusDefinitionId).toBe(inProgressDef.id);
  });

  it("38. updateProjectAction changing status to COMPLETED syncs statusDefinitionId to the 'completed' system definition — this is the one status this app's own dashboard/Portal literal reads treat specially, and both stay untouched by this sync", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const completedDef = await findDefinition(fixtures.orgA.id, "PROJECT", "completed");

    await expectRedirect(
      updateProjectAction(
        fixtures.project.id,
        { error: null },
        buildFormData({
          name: fixtures.project.name,
          status: "COMPLETED",
          clientId: fixtures.clientA.id,
          statusDefinitionId: completedDef.id,
        }),
      ),
    );

    const project = await prisma.project.findUniqueOrThrow({ where: { id: fixtures.project.id } });
    expect(project.status).toBe("COMPLETED");
    expect(project.statusDefinitionId).toBe(completedDef.id);
  });

  it("39. against an UNBOOTSTRAPPED organization (no CustomStatusDefinition rows at all), createLeadAction still succeeds — the sync is fail-open, never a hard dependency for ordinary entity creation", async () => {
    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    const result = await createLeadAction({ name: uniqueName("Lead") });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: result.leadId } });
    expect(lead.stage).toBe("NEW");
    expect(lead.statusDefinitionId).toBeNull();

    await prisma.lead.delete({ where: { id: result.leadId } });
  });
});
