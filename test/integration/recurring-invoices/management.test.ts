import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createRecurringInvoice,
  getRecurringInvoice,
  listRecurringInvoices,
  updateRecurringInvoice,
  type RecurringInvoiceActor,
} from "@/lib/recurring-invoices/recurring-invoices";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Recurring Invoices Phase 1 — management functions (test items 10-15,
 * 21). Domain layer only, exercised directly, same "no Server Action/UI
 * layer yet" shape every other Phase 1 this session used.
 */

async function cleanupRecurringInvoices(organizationIds: string[]) {
  await prisma.recurringInvoice.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

function actorFor(user: { id: string; name: string }, role: "OWNER" | "ADMIN" | "MEMBER"): RecurringInvoiceActor {
  return { id: user.id, name: user.name, role };
}

function validInput(fixtures: TestFixtures, overrides: Record<string, unknown> = {}) {
  return {
    name: "Monthly retainer",
    clientId: fixtures.clientA.id,
    projectId: fixtures.project.id,
    frequency: "MONTHLY",
    firstIssueDate: "2027-01-31",
    invoiceNumberPrefix: "INV-",
    startingSequence: 1,
    currency: "USD",
    lineItems: [{ description: "Retainer", quantity: "1", unitPrice: "500.00" }],
    ...overrides,
  };
}

describe("Recurring Invoices — management", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupRecurringInvoices([fixtures.orgA.id, fixtures.orgB.id]);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("10. an OWNER can create a schedule", async () => {
    const result = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.recurringInvoice.organizationId).toBe(fixtures.orgA.id);
    expect(result.recurringInvoice.status).toBe("ACTIVE");
    expect(result.recurringInvoice.anchorDay).toBe(31);
    expect(result.recurringInvoice.nextSequence).toBe(1);
    expect(result.recurringInvoice.lineItems).toHaveLength(1);
  });

  it("11. an ADMIN can create a schedule", async () => {
    const result = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.admin, "ADMIN"), validInput(fixtures));
    expect(result.ok).toBe(true);
  });

  it("12. a MEMBER cannot create a schedule", async () => {
    const result = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.member, "MEMBER"), validInput(fixtures));
    expect(result).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(await prisma.recurringInvoice.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("13. a cross-org Client is rejected even for an OWNER", async () => {
    const result = await createRecurringInvoice(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      validInput(fixtures, { clientId: fixtures.clientB.id, projectId: undefined }),
    );
    expect(result).toEqual({ ok: false, reason: "INVALID_TARGET" });
  });

  it("14. an invalid/nonexistent Project is rejected", async () => {
    const result = await createRecurringInvoice(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      validInput(fixtures, { projectId: "11111111-2222-3333-4444-555555555555" }),
    );
    expect(result).toEqual({ ok: false, reason: "INVALID_TARGET" });
  });

  it("15. a Project belonging to a different Client (same org) is rejected", async () => {
    const otherClient = await prisma.client.create({
      data: { name: "Other Client", organizationId: fixtures.orgA.id, status: "ACTIVE", userId: fixtures.owner.id },
    });
    const otherProject = await prisma.project.create({
      data: { name: "Other Project", clientId: otherClient.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "PLANNING" },
    });

    const result = await createRecurringInvoice(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      // fixtures.project belongs to fixtures.clientA, not otherClient.
      validInput(fixtures, { clientId: otherClient.id, projectId: fixtures.project.id }),
    );
    expect(result).toEqual({ ok: false, reason: "INVALID_TARGET" });

    await prisma.project.deleteMany({ where: { id: otherProject.id } });
    await prisma.client.deleteMany({ where: { id: otherClient.id } });
  });

  it("21a. get/list are org-scoped — an org B actor never sees an org A schedule", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");

    const getResult = await getRecurringInvoice(fixtures.orgB.id, created.recurringInvoice.id, actorFor(fixtures.orgBOwner, "OWNER"));
    expect(getResult).toEqual({ ok: true, recurringInvoice: null });

    const listResult = await listRecurringInvoices(fixtures.orgB.id, actorFor(fixtures.orgBOwner, "OWNER"));
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) throw new Error("expected ok");
    expect(listResult.recurringInvoices.map((r) => r.id)).not.toContain(created.recurringInvoice.id);
  });

  it("21b. get/list within the correct org find the schedule, and MEMBER is forbidden from reading too", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");

    const getResult = await getRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.admin, "ADMIN"));
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) throw new Error("expected ok");
    expect(getResult.recurringInvoice?.id).toBe(created.recurringInvoice.id);

    const listResult = await listRecurringInvoices(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"));
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) throw new Error("expected ok");
    expect(listResult.recurringInvoices.map((r) => r.id)).toContain(created.recurringInvoice.id);

    const memberGet = await getRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.member, "MEMBER"));
    expect(memberGet).toEqual({ ok: false, reason: "FORBIDDEN" });

    const memberList = await listRecurringInvoices(fixtures.orgA.id, actorFor(fixtures.member, "MEMBER"));
    expect(memberList).toEqual({ ok: false, reason: "FORBIDDEN" });
  });

  it("update: a MEMBER cannot edit a schedule", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");

    const result = await updateRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.member, "MEMBER"), {
      name: "Renamed",
    });
    expect(result).toEqual({ ok: false, reason: "FORBIDDEN" });
  });

  it("update: an OWNER can edit template fields; a real edit emits UPDATED, a no-op edit does not", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");

    const updated = await updateRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Renamed retainer",
      currency: "USD",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error("expected ok");
    expect(updated.recurringInvoice.name).toBe("Renamed retainer");

    // frequency/anchorDay/nextIssueDate/nextSequence are never touched by update.
    expect(updated.recurringInvoice.frequency).toBe("MONTHLY");
    expect(updated.recurringInvoice.anchorDay).toBe(31);
    expect(updated.recurringInvoice.nextSequence).toBe(1);

    const activityCount = await prisma.activity.count({
      where: { entityType: "RECURRING_INVOICE", entityId: created.recurringInvoice.id, action: "UPDATED" },
    });
    expect(activityCount).toBe(1);

    // No-op — resubmitting the exact same values must not write a second Activity row.
    const noop = await updateRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Renamed retainer",
    });
    expect(noop.ok).toBe(true);
    const activityCountAfterNoop = await prisma.activity.count({
      where: { entityType: "RECURRING_INVOICE", entityId: created.recurringInvoice.id, action: "UPDATED" },
    });
    expect(activityCountAfterNoop).toBe(1);
  });

  it("update: a cross-org Client is rejected", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");

    const result = await updateRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.owner, "OWNER"), {
      clientId: fixtures.clientB.id,
      projectId: null,
    });
    expect(result).toEqual({ ok: false, reason: "INVALID_TARGET" });
  });
});
