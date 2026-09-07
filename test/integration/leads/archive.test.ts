import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { archiveLeadAction, createLeadAction, unarchiveLeadAction } from "@/app/(dashboard)/leads/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

const NAME_PREFIX = "Lead-Archive";

function uniqueName(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

async function createLead(orgId: string, actor: { id: string; email: string; name: string }) {
  const name = uniqueName();
  actAs(actor, orgId);
  const result = await createLeadAction({ name });
  if (!result.ok) throw new Error("fixture create failed");
  resetAuthMock();
  return result.leadId;
}

describe("archiveLeadAction / unarchiveLeadAction", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("14. archive sets archivedAt (soft only — the row still exists) and logs an UPDATED activity", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await archiveLeadAction(leadId);

    expect(result).toEqual({ ok: true });
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(lead).not.toBeNull();
    expect(lead?.archivedAt).not.toBeNull();

    const activities = await prisma.activity.findMany({
      where: { entityType: "LEAD", entityId: leadId, action: "UPDATED" },
    });
    expect(activities).toHaveLength(1);
    expect((activities[0].metadata as Record<string, unknown>).changedFields).toEqual(["archivedAt"]);
  });

  it("archiving an already-archived lead is a harmless no-op — no duplicate Activity row", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);
    await archiveLeadAction(leadId);

    const result = await archiveLeadAction(leadId);

    expect(result).toEqual({ ok: true });
    const activities = await prisma.activity.findMany({
      where: { entityType: "LEAD", entityId: leadId, action: "UPDATED" },
    });
    expect(activities).toHaveLength(1);
  });

  it("15. unarchive clears archivedAt", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);
    await archiveLeadAction(leadId);

    const result = await unarchiveLeadAction(leadId);

    expect(result).toEqual({ ok: true });
    expect((await prisma.lead.findUnique({ where: { id: leadId } }))?.archivedAt).toBeNull();
  });

  it("16. archive against a foreign-org lead is a quiet not_found", async () => {
    const leadId = await createLead(fixtures.orgB.id, fixtures.orgBOwner);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await archiveLeadAction(leadId);

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect((await prisma.lead.findUnique({ where: { id: leadId } }))?.archivedAt).toBeNull();
  });

  it("unarchive against a foreign-org lead is a quiet not_found", async () => {
    const leadId = await createLead(fixtures.orgB.id, fixtures.orgBOwner);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await unarchiveLeadAction(leadId);

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("a converted lead may still be archived (archive is visibility, not deletion)", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    const fakeClientId = randomUUID();
    await prisma.client.create({
      data: { id: fakeClientId, name: "Converted Co", organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    await prisma.lead.update({
      where: { id: leadId },
      data: { convertedClientId: fakeClientId, convertedAt: new Date(), stage: "WON" },
    });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await archiveLeadAction(leadId);

    expect(result).toEqual({ ok: true });
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(lead?.archivedAt).not.toBeNull();
    expect(lead?.convertedClientId).toBe(fakeClientId);

    await prisma.client.delete({ where: { id: fakeClientId } });
  });
});
