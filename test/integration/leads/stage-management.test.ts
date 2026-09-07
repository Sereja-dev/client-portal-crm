import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createLeadAction,
  markLeadLostAction,
  moveLeadStageAction,
} from "@/app/(dashboard)/leads/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

const NAME_PREFIX = "Lead-Stage";

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

describe("moveLeadStageAction / markLeadLostAction", () => {
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

  it("9. stage move happy path — NEW -> QUALIFIED — and records STATUS_CHANGED {from,to}", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await moveLeadStageAction(leadId, "QUALIFIED");

    expect(result).toEqual({ ok: true });
    expect((await prisma.lead.findUnique({ where: { id: leadId } }))?.stage).toBe("QUALIFIED");

    const activities = await prisma.activity.findMany({
      where: { entityType: "LEAD", entityId: leadId, action: "STATUS_CHANGED" },
    });
    expect(activities).toHaveLength(1);
    expect(activities[0].metadata).toEqual({ from: "NEW", to: "QUALIFIED" });
  });

  it("moving to WON before conversion is allowed (won but not yet converted)", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await moveLeadStageAction(leadId, "WON");

    expect(result).toEqual({ ok: true });
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(lead?.stage).toBe("WON");
    expect(lead?.convertedClientId).toBeNull();
  });

  it("LOST is not a valid target for the generic stage move — invalid_stage, use markLeadLostAction instead", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await moveLeadStageAction(leadId, "LOST");

    expect(result).toEqual({ ok: false, reason: "invalid_stage" });
    expect((await prisma.lead.findUnique({ where: { id: leadId } }))?.stage).toBe("NEW");
  });

  it("10. stage move against a foreign-org lead is a quiet not_found", async () => {
    const leadId = await createLead(fixtures.orgB.id, fixtures.orgBOwner);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await moveLeadStageAction(leadId, "QUALIFIED");

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect((await prisma.lead.findUnique({ where: { id: leadId } }))?.stage).toBe("NEW");
  });

  it("11. markLeadLostAction sets stage LOST and stores lostReason on the Lead, but never in Activity metadata", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await markLeadLostAction(leadId, "Went with a competitor");

    expect(result).toEqual({ ok: true });
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(lead?.stage).toBe("LOST");
    expect(lead?.lostReason).toBe("Went with a competitor");

    const activities = await prisma.activity.findMany({
      where: { entityType: "LEAD", entityId: leadId, action: "STATUS_CHANGED" },
    });
    expect(activities).toHaveLength(1);
    expect(activities[0].metadata).toEqual({ from: "NEW", to: "LOST" });
    expect(JSON.stringify(activities[0].metadata)).not.toContain("competitor");
  });

  it("markLeadLostAction against a foreign-org lead is a quiet not_found", async () => {
    const leadId = await createLead(fixtures.orgB.id, fixtures.orgBOwner);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await markLeadLostAction(leadId, "irrelevant");

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("12. leaving LOST via a generic stage move clears lostReason automatically (reactivation)", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);
    await markLeadLostAction(leadId, "Budget cut");
    expect((await prisma.lead.findUnique({ where: { id: leadId } }))?.lostReason).toBe("Budget cut");

    const result = await moveLeadStageAction(leadId, "CONTACTED");

    expect(result).toEqual({ ok: true });
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(lead?.stage).toBe("CONTACTED");
    expect(lead?.lostReason).toBeNull();

    const activities = await prisma.activity.findMany({
      where: { entityType: "LEAD", entityId: leadId, action: "STATUS_CHANGED" },
      orderBy: { createdAt: "asc" },
    });
    expect(activities).toHaveLength(2);
    expect(activities[1].metadata).toEqual({ from: "LOST", to: "CONTACTED" });
  });

  it("13. a converted lead cannot move stage — converted_locked", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);
    // Simulate a completed conversion directly (conversion itself is
    // covered end-to-end in convert.test.ts) — this test is only about
    // moveLeadStageAction's own lock check.
    const fakeClientId = randomUUID();
    await prisma.client.create({
      data: { id: fakeClientId, name: "Converted Co", organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    await prisma.lead.update({
      where: { id: leadId },
      data: { convertedClientId: fakeClientId, convertedAt: new Date(), stage: "WON" },
    });

    const result = await moveLeadStageAction(leadId, "QUALIFIED");

    expect(result).toEqual({ ok: false, reason: "converted_locked" });
    expect((await prisma.lead.findUnique({ where: { id: leadId } }))?.stage).toBe("WON");

    await prisma.client.delete({ where: { id: fakeClientId } });
  });

  it("a converted lead cannot be marked lost — converted_locked", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);
    const fakeClientId = randomUUID();
    await prisma.client.create({
      data: { id: fakeClientId, name: "Converted Co 2", organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    await prisma.lead.update({
      where: { id: leadId },
      data: { convertedClientId: fakeClientId, convertedAt: new Date(), stage: "WON" },
    });

    const result = await markLeadLostAction(leadId, "too late");

    expect(result).toEqual({ ok: false, reason: "converted_locked" });
    expect((await prisma.lead.findUnique({ where: { id: leadId } }))?.stage).toBe("WON");

    await prisma.client.delete({ where: { id: fakeClientId } });
  });
});
