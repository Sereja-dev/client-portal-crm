import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { processDueRecurringInvoices, BATCH_SIZE } from "@/lib/recurring-invoices/jobs/process-due-recurring-invoices";
import { createRecurringInvoice, type RecurringInvoiceActor } from "@/lib/recurring-invoices/recurring-invoices";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Recurring Invoices Phase 2B-1 — the due-batch job, real end-to-end
 * (test items 9, 17-25). Real database, real generateRecurringInvoiceOccurrence
 * — never mocked, matching this repo's own "Prisma is never mocked"
 * discipline.
 */

function actorFor(user: { id: string; name: string }): RecurringInvoiceActor {
  return { id: user.id, name: user.name, role: "OWNER" };
}

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

async function cleanupAll(organizationIds: string[]) {
  await prisma.invoice.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.recurringInvoice.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

async function createSchedule(fixtures: TestFixtures, overrides: Record<string, unknown> = {}) {
  const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner), {
    clientId: fixtures.clientA.id,
    frequency: "MONTHLY",
    firstIssueDate: "2027-01-01",
    invoiceNumberPrefix: "JOB-",
    currency: "USD",
    lineItems: [{ description: "Retainer", quantity: "1", unitPrice: "100.00" }],
    ...overrides,
  });
  if (!created.ok) throw new Error("expected ok");
  return created.recurringInvoice;
}

describe("Recurring Invoices — processDueRecurringInvoices", () => {
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

  it("9. scanned reflects the exact number of due schedules found", async () => {
    await createSchedule(fixtures, { firstIssueDate: "2027-01-01", invoiceNumberPrefix: "S1-" });
    await createSchedule(fixtures, { firstIssueDate: "2027-01-02", invoiceNumberPrefix: "S2-" });
    const summary = await processDueRecurringInvoices(utc(2027, 1, 15), BATCH_SIZE);
    expect(summary.scanned).toBe(2);
    expect(summary.generated).toBe(2);
  });

  it("17/18. one schedule's unexpected exception does not stop the rest of the batch", async () => {
    // Deliberately corrupt this schedule's own line item via a raw write
    // (bypassing domain validation entirely) so calculateInvoiceTotals()
    // fails at generation time — the one documented path that makes
    // generateRecurringInvoiceOccurrence throw rather than return a
    // controlled result.
    const broken = await createSchedule(fixtures, { firstIssueDate: "2027-01-01", invoiceNumberPrefix: "BROKEN-" });
    await prisma.recurringInvoiceLineItem.updateMany({ where: { recurringInvoiceId: broken.id }, data: { quantity: "0" } });

    const healthy = await createSchedule(fixtures, { firstIssueDate: "2027-01-02", invoiceNumberPrefix: "HEALTHY-" });

    const summary = await processDueRecurringInvoices(utc(2027, 1, 15), BATCH_SIZE);
    expect(summary.scanned).toBe(2);
    expect(summary.errored).toBe(1);
    expect(summary.generated).toBe(1);

    const healthyInvoice = await prisma.invoice.findFirst({ where: { recurringInvoiceId: healthy.id } });
    expect(healthyInvoice).not.toBeNull();
    const brokenInvoice = await prisma.invoice.findFirst({ where: { recurringInvoiceId: broken.id } });
    expect(brokenInvoice).toBeNull();
  });

  it("19. the injected `now` (not the real wall clock) drives due-ness consistently", async () => {
    // firstIssueDate is deliberately a real future calendar date relative
    // to whenever this test actually runs — only "due" if the injected
    // `now` below is honored instead of a real new Date() anywhere in the
    // job.
    const schedule = await createSchedule(fixtures, { firstIssueDate: "2099-06-15", invoiceNumberPrefix: "FUTURE-" });
    const summary = await processDueRecurringInvoices(utc(2099, 6, 20), BATCH_SIZE);
    expect(summary.generated).toBe(1);
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { recurringInvoiceId: schedule.id } });
    expect(invoice.issueDate.toISOString()).toBe("2099-06-15T00:00:00.000Z");
  });

  it("20. occurrenceDate passed to the generator equals the schedule's own nextIssueDate, never `today`", async () => {
    // A schedule overdue by two weeks — occurrenceDate must be the
    // original Jan 1 date, not Jan 15 ("today").
    const schedule = await createSchedule(fixtures, { firstIssueDate: "2027-01-01", invoiceNumberPrefix: "BACKLOG-" });
    await processDueRecurringInvoices(utc(2027, 1, 15), BATCH_SIZE);
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { recurringInvoiceId: schedule.id } });
    expect(invoice.issueDate.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("21/25. exactly one occurrence per schedule per invocation, even when still overdue afterward", async () => {
    // Backlogged 3+ months — after ONE job run, only one occurrence may
    // be generated, and the schedule may legitimately still be due (a
    // later run handles the next one).
    const schedule = await createSchedule(fixtures, { firstIssueDate: "2027-01-01", invoiceNumberPrefix: "MULTI-" });
    const summary = await processDueRecurringInvoices(utc(2027, 4, 15), BATCH_SIZE);
    expect(summary.generated).toBe(1);

    const invoiceCount = await prisma.invoice.count({ where: { recurringInvoiceId: schedule.id } });
    expect(invoiceCount).toBe(1);

    const updated = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id: schedule.id } });
    // Advanced by exactly one MONTHLY step (Feb 1), still overdue relative
    // to the injected "today" (Apr 15) — proving the backlog wasn't
    // collapsed into one run.
    expect(updated.nextIssueDate.toISOString()).toBe("2027-02-01T00:00:00.000Z");
  });

  it("22. a real due schedule processed through the job produces one DRAFT Invoice via the existing generator", async () => {
    const schedule = await createSchedule(fixtures, { firstIssueDate: "2027-01-01", invoiceNumberPrefix: "REAL-" });
    const summary = await processDueRecurringInvoices(utc(2027, 1, 15), BATCH_SIZE);
    expect(summary.generated).toBe(1);
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { recurringInvoiceId: schedule.id } });
    expect(invoice.status).toBe("DRAFT");
    expect(invoice.invoiceNumber).toBe("REAL-1");
  });

  it("23/24. two overlapping job invocations covering the same schedule create at most one Invoice — no cron-level lock needed", async () => {
    const schedule = await createSchedule(fixtures, { firstIssueDate: "2027-01-01", invoiceNumberPrefix: "OVERLAP-" });
    const now = utc(2027, 1, 15);

    const [a, b] = await Promise.allSettled([
      processDueRecurringInvoices(now, BATCH_SIZE),
      processDueRecurringInvoices(now, BATCH_SIZE),
    ]);

    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("fulfilled");
    const generatedTotal =
      (a.status === "fulfilled" ? a.value.generated : 0) + (b.status === "fulfilled" ? b.value.generated : 0);
    expect(generatedTotal).toBe(1); // exactly one of the two invocations actually generated it

    const invoiceCount = await prisma.invoice.count({ where: { recurringInvoiceId: schedule.id } });
    expect(invoiceCount).toBe(1); // the occurrence ledger inside generateRecurringInvoiceOccurrence is the sole exclusivity boundary — the job itself adds no lock of its own
  });
});
