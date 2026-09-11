import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  archiveRecurringInvoice,
  createRecurringInvoice,
  pauseRecurringInvoice,
  resumeRecurringInvoice,
  updateRecurringInvoice,
  type RecurringInvoiceActor,
} from "@/lib/recurring-invoices/recurring-invoices";
import { generateRecurringInvoiceOccurrence } from "@/lib/recurring-invoices/generate";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/** Recurring Invoices Phase 1 — Activity behavior (test items 56-60). */

async function cleanupAll(organizationIds: string[]) {
  await prisma.invoice.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.recurringInvoice.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

function actorFor(user: { id: string; name: string }, role: "OWNER" | "ADMIN" | "MEMBER"): RecurringInvoiceActor {
  return { id: user.id, name: user.name, role };
}

function validInput(fixtures: TestFixtures, overrides: Record<string, unknown> = {}) {
  return {
    clientId: fixtures.clientA.id,
    projectId: fixtures.project.id,
    frequency: "MONTHLY",
    firstIssueDate: "2027-01-01",
    invoiceNumberPrefix: "ACT-",
    currency: "USD",
    lineItems: [{ description: "Retainer", quantity: "1", unitPrice: "100.00" }],
    ...overrides,
  };
}

describe("Recurring Invoices — Activity", () => {
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

  it("56. create emits RECURRING_INVOICE CREATED", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");

    const activity = await prisma.activity.findFirst({
      where: { entityType: "RECURRING_INVOICE", entityId: created.recurringInvoice.id, action: "CREATED" },
    });
    expect(activity).not.toBeNull();
    expect(activity?.actorId).toBe(fixtures.owner.id);
  });

  it("57. a real edit emits a meaningful UPDATED with changed field names only", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");

    await updateRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.owner, "OWNER"), { currency: "USD", name: "New name" });

    const activity = await prisma.activity.findFirst({
      where: { entityType: "RECURRING_INVOICE", entityId: created.recurringInvoice.id, action: "UPDATED" },
    });
    expect(activity).not.toBeNull();
    // changedFields is names-only (matches invoice-metadata.ts's own
    // convention) — "name" itself is still present as the identifying
    // top-level display field (exactly like Invoice's own invoiceNumber),
    // which is expected, not a values-leaked-into-the-diff bug.
    const metadata = activity?.metadata as { changedFields: string[]; name: string };
    expect(metadata.changedFields).toContain("name");
    expect(metadata.changedFields).not.toContain("New name");
    expect(metadata.name).toBe("New name");
  });

  it("58. pause/resume/archive each emit STATUS_CHANGED", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");

    await pauseRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.owner, "OWNER"));
    await resumeRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.owner, "OWNER"));
    await archiveRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.owner, "OWNER"));

    const statusChanges = await prisma.activity.findMany({
      where: { entityType: "RECURRING_INVOICE", entityId: created.recurringInvoice.id, action: "STATUS_CHANGED" },
      orderBy: { createdAt: "asc" },
    });
    expect(statusChanges).toHaveLength(3);
    expect((statusChanges[0].metadata as { from: string; to: string }).to).toBe("PAUSED");
    expect((statusChanges[1].metadata as { from: string; to: string }).to).toBe("ACTIVE");
    expect((statusChanges[2].metadata as { from: string; to: string }).to).toBe("ARCHIVED");
  });

  it("59. occurrence claim/reclaim/skip bookkeeping emits no Activity rows at all", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");
    const schedule = created.recurringInvoice;

    const activityCountBefore = await prisma.activity.count({ where: { organizationId: fixtures.orgA.id } });

    // A second, immediately-following call for the same occurrence is
    // skipped (already COMPLETED after the first) — this must add zero
    // new Activity rows of its own.
    await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    const activityCountAfterGenerate = await prisma.activity.count({ where: { organizationId: fixtures.orgA.id } });
    // Exactly one new row: the generated Invoice's own INVOICE/CREATED (item 60).
    expect(activityCountAfterGenerate).toBe(activityCountBefore + 1);

    await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-03T00:00:00.000Z"));
    const activityCountAfterSkip = await prisma.activity.count({ where: { organizationId: fixtures.orgA.id } });
    expect(activityCountAfterSkip).toBe(activityCountAfterGenerate);
  });

  it("60. the generated Invoice gets an ordinary INVOICE/CREATED Activity row, actorId null, attributed to the recurring schedule", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");
    const schedule = created.recurringInvoice;

    const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    if (result.outcome !== "generated") throw new Error("expected generated");

    const activity = await prisma.activity.findFirst({ where: { entityType: "INVOICE", entityId: result.invoiceId, action: "CREATED" } });
    expect(activity).not.toBeNull();
    expect(activity?.actorId).toBeNull();
    const metadata = activity?.metadata as { actorName: string };
    expect(metadata.actorName).toBe("Recurring schedule");
  });
});
