import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { listDueRecurringInvoices } from "@/lib/recurring-invoices/due-schedules";
import { createRecurringInvoice, type RecurringInvoiceActor } from "@/lib/recurring-invoices/recurring-invoices";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/** Recurring Invoices Phase 2B-1 — the due-batch job's own candidate query (test items 1-8). */

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
    invoiceNumberPrefix: "DUE-",
    currency: "USD",
    lineItems: [{ description: "Retainer", quantity: "1", unitPrice: "100.00" }],
    ...overrides,
  });
  if (!created.ok) throw new Error("expected ok");
  return created.recurringInvoice;
}

describe("Recurring Invoices — listDueRecurringInvoices", () => {
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

  it("1. an ACTIVE, due schedule is included", async () => {
    const schedule = await createSchedule(fixtures, { firstIssueDate: "2027-01-01" });
    const due = await listDueRecurringInvoices(utc(2027, 1, 15), 50);
    expect(due.map((d) => d.id)).toContain(schedule.id);
  });

  it("2. an ACTIVE, future schedule is excluded", async () => {
    const schedule = await createSchedule(fixtures, { firstIssueDate: "2027-02-01" });
    const due = await listDueRecurringInvoices(utc(2027, 1, 15), 50);
    expect(due.map((d) => d.id)).not.toContain(schedule.id);
  });

  it("3. a PAUSED due schedule is excluded", async () => {
    const schedule = await createSchedule(fixtures, { firstIssueDate: "2027-01-01" });
    await prisma.recurringInvoice.update({ where: { id: schedule.id }, data: { status: "PAUSED" } });
    const due = await listDueRecurringInvoices(utc(2027, 1, 15), 50);
    expect(due.map((d) => d.id)).not.toContain(schedule.id);
  });

  it("4. an ARCHIVED due schedule is excluded", async () => {
    const schedule = await createSchedule(fixtures, { firstIssueDate: "2027-01-01" });
    await prisma.recurringInvoice.update({ where: { id: schedule.id }, data: { status: "ARCHIVED" } });
    const due = await listDueRecurringInvoices(utc(2027, 1, 15), 50);
    expect(due.map((d) => d.id)).not.toContain(schedule.id);
  });

  it("5. nextIssueDate exactly equal to today is included", async () => {
    const schedule = await createSchedule(fixtures, { firstIssueDate: "2027-01-15" });
    const due = await listDueRecurringInvoices(utc(2027, 1, 15), 50);
    expect(due.map((d) => d.id)).toContain(schedule.id);
  });

  it("6/7. ordering: oldest nextIssueDate first, id ascending tie-break", async () => {
    const later = await createSchedule(fixtures, { firstIssueDate: "2027-01-10", invoiceNumberPrefix: "LATER-" });
    const earlier = await createSchedule(fixtures, { firstIssueDate: "2027-01-01", invoiceNumberPrefix: "EARLIER-" });
    // Two schedules sharing the exact same nextIssueDate, to prove the id tie-break.
    const tieA = await createSchedule(fixtures, { firstIssueDate: "2027-01-05", invoiceNumberPrefix: "TIE-A-" });
    const tieB = await createSchedule(fixtures, { firstIssueDate: "2027-01-05", invoiceNumberPrefix: "TIE-B-" });

    const due = await listDueRecurringInvoices(utc(2027, 1, 15), 50);
    const ids = due.map((d) => d.id).filter((id) => [later.id, earlier.id, tieA.id, tieB.id].includes(id));

    expect(ids[0]).toBe(earlier.id);
    expect(ids[ids.length - 1]).toBe(later.id);
    const [expectedFirstTie, expectedSecondTie] = [tieA.id, tieB.id].sort();
    const tieIndexA = ids.indexOf(expectedFirstTie);
    const tieIndexB = ids.indexOf(expectedSecondTie);
    expect(tieIndexA).toBeLessThan(tieIndexB);
  });

  it("8. limit is respected", async () => {
    await createSchedule(fixtures, { firstIssueDate: "2027-01-01", invoiceNumberPrefix: "L1-" });
    await createSchedule(fixtures, { firstIssueDate: "2027-01-02", invoiceNumberPrefix: "L2-" });
    await createSchedule(fixtures, { firstIssueDate: "2027-01-03", invoiceNumberPrefix: "L3-" });
    const due = await listDueRecurringInvoices(utc(2027, 1, 15), 2);
    expect(due).toHaveLength(2);
  });

  it("selects only id and nextIssueDate — no template/line-item data", async () => {
    const schedule = await createSchedule(fixtures, { firstIssueDate: "2027-01-01" });
    const due = await listDueRecurringInvoices(utc(2027, 1, 15), 50);
    const row = due.find((d) => d.id === schedule.id);
    expect(Object.keys(row!).sort()).toEqual(["id", "nextIssueDate"]);
  });
});
