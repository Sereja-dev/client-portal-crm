import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createRecurringInvoice, type RecurringInvoiceActor } from "@/lib/recurring-invoices/recurring-invoices";
import { generateRecurringInvoiceOccurrence } from "@/lib/recurring-invoices/generate";
import { computeNextIssueDate } from "@/lib/recurring-invoices/date-math";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/** Recurring Invoices Phase 1 — nextIssueDate advancement (test items 49-51). */

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
    invoiceNumberPrefix: "NID-",
    currency: "USD",
    lineItems: [{ description: "Retainer", quantity: "1", unitPrice: "100.00" }],
    ...overrides,
  };
}

async function createSchedule(fixtures: TestFixtures, overrides: Record<string, unknown> = {}) {
  const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures, overrides));
  if (!created.ok) throw new Error("expected ok");
  return created.recurringInvoice;
}

describe("Recurring Invoices — nextIssueDate advancement", () => {
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

  it("49. a successful current occurrence advances nextIssueDate exactly once, to the correct next date", async () => {
    const schedule = await createSchedule(fixtures);
    const expectedNext = computeNextIssueDate(schedule.nextIssueDate, "MONTHLY", schedule.anchorDay);

    const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    expect(result.outcome).toBe("generated");

    const updated = await prisma.recurringInvoice.findUnique({ where: { id: schedule.id } });
    expect(updated?.nextIssueDate.getTime()).toBe(expectedNext.getTime());
  });

  it("50. a failed (exhausted) occurrence does not advance nextIssueDate", async () => {
    const schedule = await createSchedule(fixtures, { invoiceNumberPrefix: "N50-", startingSequence: 1 });
    for (let seq = 1; seq <= 5; seq++) {
      await prisma.invoice.create({
        data: {
          invoiceNumber: `N50-${seq}`,
          status: "DRAFT",
          amount: "0",
          subtotal: "0",
          discountAmount: "0",
          taxAmount: "0",
          currency: "USD",
          issueDate: new Date(),
          clientId: fixtures.clientA.id,
          organizationId: fixtures.orgA.id,
        },
      });
    }

    const before = schedule.nextIssueDate;
    const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    expect(result).toEqual({ outcome: "failed", reason: "NUMBERING_EXHAUSTED" });

    const updated = await prisma.recurringInvoice.findUnique({ where: { id: schedule.id } });
    expect(updated?.nextIssueDate.getTime()).toBe(before.getTime());
  }, 15_000);

  it("51. an out-of-order completion (an occurrence that is no longer the current forward pointer) cannot move nextIssueDate backward", async () => {
    const schedule = await createSchedule(fixtures);
    const firstOccurrenceDate = schedule.nextIssueDate;
    const secondOccurrenceDate = computeNextIssueDate(firstOccurrenceDate, "MONTHLY", schedule.anchorDay);

    // Manually advance nextIssueDate to simulate the SECOND occurrence
    // already having completed first (out-of-order backlog processing) —
    // nextIssueDate now points past the first occurrence entirely.
    await prisma.recurringInvoice.update({ where: { id: schedule.id }, data: { nextIssueDate: secondOccurrenceDate } });

    // Now generate the FIRST (earlier, out-of-order) occurrence.
    const result = await generateRecurringInvoiceOccurrence(schedule.id, firstOccurrenceDate, new Date("2027-03-01T00:00:00.000Z"));
    expect(result.outcome).toBe("generated");

    const updated = await prisma.recurringInvoice.findUnique({ where: { id: schedule.id } });
    // nextIssueDate must remain at the later, already-correct value —
    // never regressed back to a date computed from the earlier occurrence.
    expect(updated?.nextIssueDate.getTime()).toBe(secondOccurrenceDate.getTime());
  });
});
