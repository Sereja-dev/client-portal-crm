import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createLeadAction, updateLeadAction } from "@/app/(dashboard)/leads/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

const NAME_PREFIX = "Lead-Update";

function uniqueName(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

async function createLead(orgId: string, actor: { id: string; email: string; name: string }, overrides: Record<string, unknown> = {}) {
  const name = uniqueName();
  actAs(actor, orgId);
  const result = await createLeadAction({ name, ...overrides });
  if (!result.ok) throw new Error("fixture create failed");
  return result.leadId;
}

describe("updateLeadAction", () => {
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

  it("5. happy path updates the editable fields", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    resetAuthMock();
    actAs(fixtures.owner, fixtures.orgA.id);
    const newName = uniqueName();

    const result = await updateLeadAction(leadId, {
      name: newName,
      company: "New Co",
      email: "updated@example.com",
      phone: "555-0199",
      value: 1000,
      notes: "updated notes",
    });

    expect(result).toEqual({ ok: true });
    const updated = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(updated?.name).toBe(newName);
    expect(updated?.company).toBe("New Co");
    expect(updated?.email).toBe("updated@example.com");
    expect(Number(updated?.value)).toBe(1000);
  });

  it("6. a foreign-org lead id is a quiet not_found, indistinguishable from a nonexistent one", async () => {
    const leadId = await createLead(fixtures.orgB.id, fixtures.orgBOwner);
    resetAuthMock();
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await updateLeadAction(leadId, { name: uniqueName() });
    const resultForRandomId = await updateLeadAction(randomUUID(), { name: uniqueName() });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(resultForRandomId).toEqual({ ok: false, reason: "not_found" });

    // The orgB lead itself is genuinely untouched.
    const stillThere = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(stillThere?.organizationId).toBe(fixtures.orgB.id);
  });

  it("7. generic update has no way to set stage, lostReason, archivedAt, convertedClientId, or organizationId — the input type has no such fields", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    resetAuthMock();
    actAs(fixtures.owner, fixtures.orgA.id);
    const before = await prisma.lead.findUnique({ where: { id: leadId } });

    // Even smuggled in via an object literal past the type system, none
    // of these are read by parseLeadInput/updateLeadAction at all.
    const result = await updateLeadAction(leadId, {
      name: before!.name,
      ...({
        stage: "WON",
        lostReason: "should never apply",
        archivedAt: new Date().toISOString(),
        convertedClientId: randomUUID(),
        organizationId: fixtures.orgB.id,
      } as object),
    });

    expect(result).toEqual({ ok: true });
    const after = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(after?.stage).toBe(before?.stage);
    expect(after?.lostReason).toBeNull();
    expect(after?.archivedAt).toBeNull();
    expect(after?.convertedClientId).toBeNull();
    expect(after?.organizationId).toBe(fixtures.orgA.id);
  });

  it("8. assignment to a same-org Member works; a foreign-org user is rejected", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    resetAuthMock();
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = uniqueName();

    const ok = await updateLeadAction(leadId, { name, assignedToUserId: fixtures.member.id });
    expect(ok).toEqual({ ok: true });
    expect((await prisma.lead.findUnique({ where: { id: leadId } }))?.assignedToUserId).toBe(fixtures.member.id);

    const rejected = await updateLeadAction(leadId, { name, assignedToUserId: fixtures.orgBOwner.id });
    expect(rejected).toEqual({ ok: false, reason: "invalid_assignee" });
    // Unchanged — the rejected attempt never wrote anything.
    expect((await prisma.lead.findUnique({ where: { id: leadId } }))?.assignedToUserId).toBe(fixtures.member.id);
  });

  it("a re-submit of identical values writes no new UPDATED Activity row", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner, { company: "Same Co" });
    resetAuthMock();
    actAs(fixtures.owner, fixtures.orgA.id);
    const before = await prisma.lead.findUnique({ where: { id: leadId } });

    await updateLeadAction(leadId, {
      name: before!.name,
      company: before!.company,
      email: before!.email,
      phone: before!.phone,
      value: before!.value ? Number(before!.value) : undefined,
      notes: before!.notes,
    });

    const activities = await prisma.activity.findMany({
      where: { entityType: "LEAD", entityId: leadId, action: "UPDATED" },
    });
    expect(activities).toHaveLength(0);
  });

  it("UPDATED Activity metadata never contains email/phone/notes values, only changed field names", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner, { email: "old@example.com" });
    resetAuthMock();
    actAs(fixtures.owner, fixtures.orgA.id);
    const before = await prisma.lead.findUnique({ where: { id: leadId } });

    await updateLeadAction(leadId, {
      name: before!.name,
      email: "brand-new-secret@example.com",
      notes: "brand new secret notes",
    });

    const activities = await prisma.activity.findMany({
      where: { entityType: "LEAD", entityId: leadId, action: "UPDATED" },
    });
    expect(activities).toHaveLength(1);
    const metadata = activities[0].metadata as Record<string, unknown>;
    expect(metadata.changedFields).toContain("email");
    expect(metadata.changedFields).toContain("notes");
    expect(JSON.stringify(metadata)).not.toContain("brand-new-secret@example.com");
    expect(JSON.stringify(metadata)).not.toContain("brand new secret notes");
  });
});
