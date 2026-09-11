import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  archiveRecurringInvoice,
  createRecurringInvoice,
  pauseRecurringInvoice,
  resumeRecurringInvoice,
  type RecurringInvoiceActor,
} from "@/lib/recurring-invoices/recurring-invoices";
import { generateRecurringInvoiceOccurrence } from "@/lib/recurring-invoices/generate";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/** Recurring Invoices Phase 1 — lifecycle (test items 16-20). */

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
    firstIssueDate: "2027-01-01",
    invoiceNumberPrefix: "INV-",
    currency: "USD",
    lineItems: [{ description: "Retainer", quantity: "1", unitPrice: "500.00" }],
    ...overrides,
  };
}

describe("Recurring Invoices — lifecycle", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await prisma.invoice.deleteMany({ where: { organizationId: fixtures.orgA.id, invoiceNumber: { startsWith: "INV-" } } });
    await cleanupRecurringInvoices([fixtures.orgA.id, fixtures.orgB.id]);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("16. pause works (ACTIVE -> PAUSED), nextIssueDate is preserved", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");
    const before = created.recurringInvoice.nextIssueDate;

    const result = await pauseRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.owner, "OWNER"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.recurringInvoice.status).toBe("PAUSED");
    expect(result.recurringInvoice.nextIssueDate.getTime()).toBe(before.getTime());
  });

  it("17. resume works (PAUSED -> ACTIVE)", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");
    await pauseRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.owner, "OWNER"));

    const result = await resumeRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.owner, "OWNER"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.recurringInvoice.status).toBe("ACTIVE");
  });

  it("18. archive works (ACTIVE -> ARCHIVED), and is terminal (resume is rejected afterward)", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");

    const result = await archiveRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.owner, "OWNER"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.recurringInvoice.status).toBe("ARCHIVED");

    const resumeAttempt = await resumeRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.owner, "OWNER"));
    expect(resumeAttempt).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
  });

  it("19. an ARCHIVED schedule cannot generate", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");
    await archiveRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.owner, "OWNER"));

    const result = await generateRecurringInvoiceOccurrence(created.recurringInvoice.id, created.recurringInvoice.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    expect(result).toEqual({ outcome: "not_active" });
    expect(await prisma.invoice.count({ where: { recurringInvoiceId: created.recurringInvoice.id } })).toBe(0);
  });

  it("20. a PAUSED schedule cannot generate", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");
    await pauseRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.owner, "OWNER"));

    const result = await generateRecurringInvoiceOccurrence(created.recurringInvoice.id, created.recurringInvoice.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    expect(result).toEqual({ outcome: "not_active" });
    expect(await prisma.invoice.count({ where: { recurringInvoiceId: created.recurringInvoice.id } })).toBe(0);
  });

  it("pause/resume/archive are all OWNER/ADMIN-only, and idempotent when already in the target state", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), validInput(fixtures));
    if (!created.ok) throw new Error("expected ok");

    const memberPause = await pauseRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.member, "MEMBER"));
    expect(memberPause).toEqual({ ok: false, reason: "FORBIDDEN" });

    const adminPause = await pauseRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.admin, "ADMIN"));
    expect(adminPause.ok).toBe(true);

    // Idempotent — already PAUSED, pausing again is a no-op success.
    const pauseAgain = await pauseRecurringInvoice(fixtures.orgA.id, created.recurringInvoice.id, actorFor(fixtures.owner, "OWNER"));
    expect(pauseAgain.ok).toBe(true);
    if (!pauseAgain.ok) throw new Error("expected ok");
    expect(pauseAgain.recurringInvoice.status).toBe("PAUSED");
  });
});
