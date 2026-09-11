import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createRecurringInvoice, type RecurringInvoiceActor } from "@/lib/recurring-invoices/recurring-invoices";
import { generateRecurringInvoiceOccurrence } from "@/lib/recurring-invoices/generate";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/** Recurring Invoices Phase 1 — DB relations/constraints (test items 52-55). */

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
    invoiceNumberPrefix: "REL-",
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

describe("Recurring Invoices — DB relations", () => {
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

  it("52. Invoice.recurringInvoiceId is SetNull when the RecurringInvoice is deleted — the Invoice survives", async () => {
    const schedule = await createSchedule(fixtures);
    const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    if (result.outcome !== "generated") throw new Error("expected generated");

    await prisma.recurringInvoice.delete({ where: { id: schedule.id } });

    const invoice = await prisma.invoice.findUnique({ where: { id: result.invoiceId } });
    expect(invoice).not.toBeNull();
    expect(invoice?.recurringInvoiceId).toBeNull();
  });

  it("52b. the occurrence's own invoiceId is SetNull when the generated Invoice itself is deleted — the occurrence remains historically meaningful", async () => {
    const schedule = await createSchedule(fixtures);
    const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    if (result.outcome !== "generated") throw new Error("expected generated");

    // The generated Invoice is DRAFT, deletable through the ordinary
    // guarded delete predicate (deleteInvoiceAction's own contract).
    await prisma.invoice.deleteMany({ where: { id: result.invoiceId, status: "DRAFT" } });

    const occurrence = await prisma.recurringInvoiceOccurrence.findUnique({
      where: { recurringInvoiceId_occurrenceDate: { recurringInvoiceId: schedule.id, occurrenceDate: schedule.nextIssueDate } },
    });
    expect(occurrence).not.toBeNull();
    expect(occurrence?.status).toBe("COMPLETED");
    expect(occurrence?.invoiceId).toBeNull();
  });

  it("53. RecurringInvoiceLineItem rows cascade-delete with their RecurringInvoice", async () => {
    const schedule = await createSchedule(fixtures, {
      lineItems: [
        { description: "A", quantity: "1", unitPrice: "1.00" },
        { description: "B", quantity: "1", unitPrice: "2.00" },
      ],
    });
    expect(await prisma.recurringInvoiceLineItem.count({ where: { recurringInvoiceId: schedule.id } })).toBe(2);

    await prisma.recurringInvoice.delete({ where: { id: schedule.id } });

    expect(await prisma.recurringInvoiceLineItem.count({ where: { recurringInvoiceId: schedule.id } })).toBe(0);
  });

  it("54. unique(recurringInvoiceId, occurrenceDate) is enforced at the database level", async () => {
    const schedule = await createSchedule(fixtures);
    await prisma.recurringInvoiceOccurrence.create({
      data: { recurringInvoiceId: schedule.id, occurrenceDate: schedule.nextIssueDate, status: "PENDING", claimToken: "t1", claimedAt: new Date(), attemptCount: 1 },
    });

    await expect(
      prisma.recurringInvoiceOccurrence.create({
        data: { recurringInvoiceId: schedule.id, occurrenceDate: schedule.nextIssueDate, status: "PENDING", claimToken: "t2", claimedAt: new Date(), attemptCount: 1 },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it("55. no domain function ever produces a cross-org RecurringInvoice association", async () => {
    // createRecurringInvoice itself already rejects a cross-org
    // clientId/projectId (see management.test.ts's own items 13-15) —
    // this test confirms the persisted row, once created, never resolves
    // to a foreign-org Client/Project either.
    const schedule = await createSchedule(fixtures);
    const full = await prisma.recurringInvoice.findUnique({ where: { id: schedule.id }, include: { client: true, project: true } });
    expect(full?.client.organizationId).toBe(fixtures.orgA.id);
    expect(full?.project?.organizationId).toBe(fixtures.orgA.id);
    expect(full?.organizationId).toBe(fixtures.orgA.id);
  });
});
