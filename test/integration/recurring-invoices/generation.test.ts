import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createRecurringInvoice, updateRecurringInvoice, type RecurringInvoiceActor } from "@/lib/recurring-invoices/recurring-invoices";
import { generateRecurringInvoiceOccurrence } from "@/lib/recurring-invoices/generate";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/** Recurring Invoices Phase 1 — generated Invoice correctness (test items 22-30). */

async function cleanupAll(organizationIds: string[]) {
  await prisma.invoice.deleteMany({ where: { organizationId: { in: organizationIds } } });
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
    firstIssueDate: "2027-01-01",
    invoiceNumberPrefix: "GEN-",
    currency: "USD",
    dueDateOffsetDays: 14,
    discountType: "PERCENTAGE",
    discountValue: "10",
    taxRatePercent: "8",
    notes: "Client-facing note",
    internalNotes: "Staff-only note",
    lineItems: [
      { description: "Design retainer", quantity: "1", unitPrice: "500.00" },
      { description: "Hosting", quantity: "2", unitPrice: "25.00" },
    ],
    ...overrides,
  };
}

describe("Recurring Invoices — generation correctness", () => {
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

  it("22/23/24/25/26/27/28. a successful generation produces a correct DRAFT Invoice", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");
    const schedule = created.recurringInvoice;

    const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    expect(result.outcome).toBe("generated");
    if (result.outcome !== "generated") throw new Error("expected generated");

    const invoice = await prisma.invoice.findUnique({ where: { id: result.invoiceId }, include: { lineItems: { orderBy: { position: "asc" } } } });
    expect(invoice).not.toBeNull();
    // 22. DRAFT
    expect(invoice!.status).toBe("DRAFT");
    // 23. links back
    expect(invoice!.recurringInvoiceId).toBe(schedule.id);
    // 24. copies client/project/currency/tax/discount/notes
    expect(invoice!.clientId).toBe(fixtures.clientA.id);
    expect(invoice!.projectId).toBe(fixtures.project.id);
    expect(invoice!.currency).toBe("USD");
    expect(invoice!.discountType).toBe("PERCENTAGE");
    expect(invoice!.discountValue?.toString()).toBe("10");
    expect(invoice!.taxRatePercent?.toString()).toBe("8");
    expect(invoice!.notes).toBe("Client-facing note");
    expect(invoice!.internalNotes).toBe("Staff-only note");
    // 25. line items
    expect(invoice!.lineItems).toHaveLength(2);
    expect(invoice!.lineItems[0].description).toBe("Design retainer");
    expect(invoice!.lineItems[1].description).toBe("Hosting");
    // 26. totals via the real calculator: subtotal 550, 10% discount = 55, tax 8% of 495 = 39.60, total 534.60
    expect(invoice!.subtotal.toString()).toBe("550");
    expect(invoice!.discountAmount.toString()).toBe("55");
    expect(invoice!.taxAmount.toString()).toBe("39.6");
    expect(invoice!.amount.toString()).toBe("534.6");
    // 27. occurrenceDate becomes issueDate
    expect(invoice!.issueDate.getTime()).toBe(schedule.nextIssueDate.getTime());
    // 28. dueDateOffsetDays computes the expected dueDate
    expect(invoice!.dueDate?.getTime()).toBe(schedule.nextIssueDate.getTime() + 14 * 24 * 60 * 60 * 1000);
  });

  it("29. a null dueDateOffsetDays yields a null dueDate", async () => {
    const created = await createRecurringInvoice(
      fixtures.orgA.id,
      actorFor(fixtures.owner, "OWNER"),
      validInput(fixtures, { dueDateOffsetDays: undefined }),
    );
    if (!created.ok) throw new Error("expected ok");
    const schedule = created.recurringInvoice;
    expect(schedule.dueDateOffsetDays).toBeNull();

    const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    if (result.outcome !== "generated") throw new Error("expected generated");
    const invoice = await prisma.invoice.findUnique({ where: { id: result.invoiceId } });
    expect(invoice!.dueDate).toBeNull();
  });

  it("30. historical generated Invoice remains unchanged after the RecurringInvoice template is later edited", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");
    const schedule = created.recurringInvoice;

    const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    if (result.outcome !== "generated") throw new Error("expected generated");
    const before = await prisma.invoice.findUnique({ where: { id: result.invoiceId } });

    await updateRecurringInvoice(fixtures.orgA.id, schedule.id, actorFor(fixtures.owner, "OWNER"), {
      name: "Renamed",
      currency: "USD",
      lineItems: [{ description: "Completely different line item", quantity: "9", unitPrice: "9.00" }],
    });

    const after = await prisma.invoice.findUnique({ where: { id: result.invoiceId }, include: { lineItems: true } });
    expect(after!.amount.toString()).toBe(before!.amount.toString());
    expect(after!.lineItems.some((li) => li.description === "Design retainer")).toBe(true);
  });

  it("generation without a Project produces a project-less Invoice", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures, { projectId: undefined }));
    if (!created.ok) throw new Error("expected ok");
    const schedule = created.recurringInvoice;
    expect(schedule.projectId).toBeNull();

    const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    if (result.outcome !== "generated") throw new Error("expected generated");
    const invoice = await prisma.invoice.findUnique({ where: { id: result.invoiceId } });
    expect(invoice!.projectId).toBeNull();
  });
});
