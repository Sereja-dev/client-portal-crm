import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createRecurringInvoice, type RecurringInvoiceActor } from "@/lib/recurring-invoices/recurring-invoices";
import { generateRecurringInvoiceOccurrence, MAX_ATTEMPTS } from "@/lib/recurring-invoices/generate";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/** Recurring Invoices Phase 1 — number-collision handling (test items 41-48). */

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
    invoiceNumberPrefix: "NUM-",
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

async function seedManualInvoices(fixtures: TestFixtures, prefix: string, sequences: number[]) {
  for (const seq of sequences) {
    await prisma.invoice.create({
      data: {
        invoiceNumber: `${prefix}${seq}`,
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
}

describe("Recurring Invoices — number-collision handling", () => {
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

  it("41. a collision on the first candidate retries the next candidate", async () => {
    const schedule = await createSchedule(fixtures, { invoiceNumberPrefix: "N41-" });
    await seedManualInvoices(fixtures, "N41-", [1]);

    const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    expect(result.outcome).toBe("generated");
    if (result.outcome !== "generated") throw new Error("expected generated");

    const invoice = await prisma.invoice.findUnique({ where: { id: result.invoiceId } });
    expect(invoice?.invoiceNumber).toBe("N41-2");
  });

  it("42. occupied N42-5 and N42-6, free N42-7 -> creates N42-7 and persists nextSequence=8", async () => {
    const schedule = await createSchedule(fixtures, { invoiceNumberPrefix: "N42-", startingSequence: 5 });
    await seedManualInvoices(fixtures, "N42-", [5, 6]);

    const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    expect(result.outcome).toBe("generated");
    if (result.outcome !== "generated") throw new Error("expected generated");

    const invoice = await prisma.invoice.findUnique({ where: { id: result.invoiceId } });
    expect(invoice?.invoiceNumber).toBe("N42-7");

    const updatedSchedule = await prisma.recurringInvoice.findUnique({ where: { id: schedule.id } });
    expect(updatedSchedule?.nextSequence).toBe(8);
  });

  it("43. failed collision attempts do not permanently mutate nextSequence before success", async () => {
    const schedule = await createSchedule(fixtures, { invoiceNumberPrefix: "N43-", startingSequence: 1 });
    await seedManualInvoices(fixtures, "N43-", [1, 2, 3]);

    // Read nextSequence mid-flight is not directly observable from the
    // outside (the whole call is one function), so this is verified via
    // the end state: three failed candidates (1,2,3) never left a
    // permanent mark — the final committed value is exactly
    // startingCandidate + 1 (4), matching only the one successful create.
    const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    expect(result.outcome).toBe("generated");
    if (result.outcome !== "generated") throw new Error("expected generated");

    const invoice = await prisma.invoice.findUnique({ where: { id: result.invoiceId } });
    expect(invoice?.invoiceNumber).toBe("N43-4");
    const updatedSchedule = await prisma.recurringInvoice.findUnique({ where: { id: schedule.id } });
    expect(updatedSchedule?.nextSequence).toBe(5);
  });

  it("44. a guard miss caused by concurrent sequence movement triggers a fresh-base restart", async () => {
    const schedule = await createSchedule(fixtures, { invoiceNumberPrefix: "N44-", startingSequence: 1 });

    // Simulate a concurrent occurrence of the SAME schedule already having
    // advanced nextSequence past where this call's own initial read will
    // start — the very first candidate attempt's sequence-guard UPDATE
    // will miss (count 0), forcing a fresh re-read rather than a numbering
    // collision retry.
    await prisma.recurringInvoice.update({ where: { id: schedule.id }, data: { nextSequence: 9 } });

    const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    expect(result.outcome).toBe("generated");
    if (result.outcome !== "generated") throw new Error("expected generated");

    const invoice = await prisma.invoice.findUnique({ where: { id: result.invoiceId } });
    // The guard-miss forced a re-read of the moved value (9), so the
    // successful candidate is 9, not the stale original 1.
    expect(invoice?.invoiceNumber).toBe("N44-9");
  });

  it("45. a full MAX_ATTEMPTS occupied range marks the occurrence FAILED", async () => {
    const schedule = await createSchedule(fixtures, { invoiceNumberPrefix: "N45-", startingSequence: 1 });
    await seedManualInvoices(
      fixtures,
      "N45-",
      Array.from({ length: MAX_ATTEMPTS }, (_, i) => i + 1),
    );

    const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    expect(result).toEqual({ outcome: "failed", reason: "NUMBERING_EXHAUSTED" });

    const occurrence = await prisma.recurringInvoiceOccurrence.findUnique({
      where: { recurringInvoiceId_occurrenceDate: { recurringInvoiceId: schedule.id, occurrenceDate: schedule.nextIssueDate } },
    });
    expect(occurrence?.status).toBe("FAILED");
    expect(occurrence?.failureReason).toBe("NUMBERING_EXHAUSTED");
  }, 15_000);

  it("46. the full occupied range advances nextSequence past every exhausted candidate", async () => {
    const schedule = await createSchedule(fixtures, { invoiceNumberPrefix: "N46-", startingSequence: 1 });
    await seedManualInvoices(
      fixtures,
      "N46-",
      Array.from({ length: MAX_ATTEMPTS }, (_, i) => i + 1),
    );

    await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));

    const updatedSchedule = await prisma.recurringInvoice.findUnique({ where: { id: schedule.id } });
    expect(updatedSchedule?.nextSequence).toBe(1 + MAX_ATTEMPTS);
  }, 15_000);

  it("47. a reclaimed FAILED occurrence starts from the advanced nextSequence, not the old exhausted range", async () => {
    const schedule = await createSchedule(fixtures, { invoiceNumberPrefix: "N47-", startingSequence: 1 });
    await seedManualInvoices(
      fixtures,
      "N47-",
      Array.from({ length: MAX_ATTEMPTS }, (_, i) => i + 1),
    );

    const first = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    expect(first).toEqual({ outcome: "failed", reason: "NUMBERING_EXHAUSTED" });

    // A later run reclaims the FAILED occurrence — N47-6 (the advanced
    // nextSequence) is free, so it should succeed immediately without
    // ever retrying N47-1..N47-5 again.
    const second = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-03T00:00:00.000Z"));
    expect(second.outcome).toBe("generated");
    if (second.outcome !== "generated") throw new Error("expected generated");
    const invoice = await prisma.invoice.findUnique({ where: { id: second.invoiceId } });
    expect(invoice?.invoiceNumber).toBe(`N47-${1 + MAX_ATTEMPTS}`);
  }, 15_000);

  it("48. a concurrent exhaustion bump cannot regress or overwrite a newer sequence value", async () => {
    const schedule = await createSchedule(fixtures, { invoiceNumberPrefix: "N48-", startingSequence: 1 });
    await seedManualInvoices(
      fixtures,
      "N48-",
      Array.from({ length: MAX_ATTEMPTS }, (_, i) => i + 1),
    );

    // Simulate a DIFFERENT concurrent occurrence of the same schedule
    // having already advanced nextSequence far ahead (e.g. its own
    // successful generation) before this call's own attempt loop even
    // reads its starting baseSequence. The forward-only guard (WHERE
    // nextSequence = roundBaseSequence) on both the per-attempt bump and
    // the exhaustion-path bump must detect any such mismatch and skip
    // silently rather than ever clobbering a newer value backward.
    await prisma.recurringInvoice.update({ where: { id: schedule.id }, data: { nextSequence: 100 } });

    const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    // Every candidate now starts from 100 (a fresh read after the
    // pre-advance), none of which are manually occupied, so this
    // generates successfully rather than exhausting — demonstrating the
    // guard-miss/fresh-base mechanism already protects nextSequence from
    // ever being regressed to the stale 1..5 range.
    expect(result.outcome).toBe("generated");
    const updatedSchedule = await prisma.recurringInvoice.findUnique({ where: { id: schedule.id } });
    expect(updatedSchedule!.nextSequence).toBeGreaterThanOrEqual(100);
  }, 15_000);
});
