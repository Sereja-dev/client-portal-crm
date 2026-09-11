import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createRecurringInvoice, type RecurringInvoiceActor } from "@/lib/recurring-invoices/recurring-invoices";
import { generateRecurringInvoiceOccurrence, claimOccurrence, CLAIM_LEASE_MS, MAX_ATTEMPTS } from "@/lib/recurring-invoices/generate";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Recurring Invoices Phase 1 — idempotency/concurrency (test items 31-40).
 * Real integration tests against the real database: Promise.allSettled for
 * genuine concurrent calls, the real @@unique(recurringInvoiceId,
 * occurrenceDate) constraint, and real conditional-update row counts —
 * never faked with unit mocks, per the finalized concurrency design's own
 * explicit requirement.
 */

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
    invoiceNumberPrefix: "CONC-",
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

describe("Recurring Invoices — idempotency / concurrency", () => {
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

  it("31. the first claim for a brand-new occurrence succeeds with attemptCount 1", async () => {
    const schedule = await createSchedule(fixtures);
    const result = await claimOccurrence(prisma, schedule.id, schedule.nextIssueDate, new Date());
    expect(result.outcome).toBe("claimed");

    const row = await prisma.recurringInvoiceOccurrence.findUnique({
      where: { recurringInvoiceId_occurrenceDate: { recurringInvoiceId: schedule.id, occurrenceDate: schedule.nextIssueDate } },
    });
    expect(row?.attemptCount).toBe(1);
    expect(row?.status).toBe("PENDING");
  });

  it("32. two genuinely concurrent generation calls for the same occurrence create at most one Invoice", async () => {
    const schedule = await createSchedule(fixtures);
    const now = new Date("2027-01-02T00:00:00.000Z");

    const [a, b] = await Promise.allSettled([
      generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, now),
      generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, now),
    ]);

    const outcomes = [a, b].map((r) => (r.status === "fulfilled" ? r.value.outcome : `rejected:${String(r.reason)}`));
    // Exactly one "generated", the other must be skipped_claimed (lost the
    // claim race) — never two "generated", never a thrown rejection.
    expect(outcomes.filter((o) => o === "generated")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "skipped_claimed")).toHaveLength(1);

    const invoiceCount = await prisma.invoice.count({ where: { recurringInvoiceId: schedule.id } });
    expect(invoiceCount).toBe(1);
    const occurrence = await prisma.recurringInvoiceOccurrence.findUnique({
      where: { recurringInvoiceId_occurrenceDate: { recurringInvoiceId: schedule.id, occurrenceDate: schedule.nextIssueDate } },
    });
    expect(occurrence?.status).toBe("COMPLETED");
  });

  it("33. a COMPLETED occurrence never regenerates on a later call", async () => {
    const schedule = await createSchedule(fixtures);
    const now = new Date("2027-01-02T00:00:00.000Z");

    const first = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, now);
    expect(first.outcome).toBe("generated");

    const second = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, now);
    expect(second).toEqual({ outcome: "skipped_completed" });

    expect(await prisma.invoice.count({ where: { recurringInvoiceId: schedule.id } })).toBe(1);
  });

  it("34. a fresh PENDING claim is skipped, never reclaimed", async () => {
    const schedule = await createSchedule(fixtures);
    const now = new Date();
    await prisma.recurringInvoiceOccurrence.create({
      data: { recurringInvoiceId: schedule.id, occurrenceDate: schedule.nextIssueDate, status: "PENDING", claimedAt: now, claimToken: "token-fresh", attemptCount: 1 },
    });

    const result = await claimOccurrence(prisma, schedule.id, schedule.nextIssueDate, now);
    expect(result).toEqual({ outcome: "skipped_claimed" });

    const row = await prisma.recurringInvoiceOccurrence.findUnique({
      where: { recurringInvoiceId_occurrenceDate: { recurringInvoiceId: schedule.id, occurrenceDate: schedule.nextIssueDate } },
    });
    expect(row?.claimToken).toBe("token-fresh");
  });

  it("35. a stale PENDING claim (past the lease) is reclaimed with a new token and incremented attemptCount", async () => {
    const schedule = await createSchedule(fixtures);
    const now = new Date();
    const staleClaimedAt = new Date(now.getTime() - CLAIM_LEASE_MS - 1000);
    await prisma.recurringInvoiceOccurrence.create({
      data: { recurringInvoiceId: schedule.id, occurrenceDate: schedule.nextIssueDate, status: "PENDING", claimedAt: staleClaimedAt, claimToken: "token-stale", attemptCount: 1 },
    });

    const result = await claimOccurrence(prisma, schedule.id, schedule.nextIssueDate, now);
    expect(result.outcome).toBe("claimed");
    if (result.outcome !== "claimed") throw new Error("expected claimed");
    expect(result.claimToken).not.toBe("token-stale");

    const row = await prisma.recurringInvoiceOccurrence.findUnique({
      where: { recurringInvoiceId_occurrenceDate: { recurringInvoiceId: schedule.id, occurrenceDate: schedule.nextIssueDate } },
    });
    expect(row?.claimToken).toBe(result.claimToken);
    expect(row?.attemptCount).toBe(2);
  });

  it("36. a FAILED occurrence is reclaimed with a new token and incremented attemptCount", async () => {
    const schedule = await createSchedule(fixtures);
    const now = new Date();
    await prisma.recurringInvoiceOccurrence.create({
      data: {
        recurringInvoiceId: schedule.id,
        occurrenceDate: schedule.nextIssueDate,
        status: "FAILED",
        claimedAt: now,
        claimToken: "token-failed",
        attemptCount: 1,
        failureReason: "NUMBERING_EXHAUSTED",
      },
    });

    const result = await claimOccurrence(prisma, schedule.id, schedule.nextIssueDate, now);
    expect(result.outcome).toBe("claimed");
    if (result.outcome !== "claimed") throw new Error("expected claimed");
    expect(result.claimToken).not.toBe("token-failed");

    const row = await prisma.recurringInvoiceOccurrence.findUnique({
      where: { recurringInvoiceId_occurrenceDate: { recurringInvoiceId: schedule.id, occurrenceDate: schedule.nextIssueDate } },
    });
    expect(row?.status).toBe("PENDING");
    expect(row?.attemptCount).toBe(2);
  });

  it("37. a stale worker's old claimToken can never win the exact conditional write a generation attempt depends on, once reclaimed", async () => {
    const schedule = await createSchedule(fixtures);
    const now = new Date();

    // "Worker A" claims.
    const claimA = await claimOccurrence(prisma, schedule.id, schedule.nextIssueDate, now);
    if (claimA.outcome !== "claimed") throw new Error("expected claimed");

    // Simulate A stalling past the lease, then "Worker B" reclaiming.
    await prisma.recurringInvoiceOccurrence.update({
      where: { id: claimA.occurrenceId },
      data: { claimedAt: new Date(now.getTime() - CLAIM_LEASE_MS - 1000) },
    });
    const laterNow = new Date(now.getTime() + 1000);
    const claimB = await claimOccurrence(prisma, schedule.id, schedule.nextIssueDate, laterNow);
    if (claimB.outcome !== "claimed") throw new Error("expected claimed");
    expect(claimB.claimToken).not.toBe(claimA.claimToken);

    // "Worker A" resumes and attempts exactly the same conditional write
    // generate.ts's own attemptGeneration() step 1 (ownership reverify)
    // and step 4 (completion) both depend on — this is the real DB
    // mechanism the ownership guarantee rests on, exercised directly.
    const staleWrite = await prisma.recurringInvoiceOccurrence.updateMany({
      where: { id: claimA.occurrenceId, status: "PENDING", claimToken: claimA.claimToken },
      data: { claimedAt: new Date() },
    });
    expect(staleWrite.count).toBe(0);

    const row = await prisma.recurringInvoiceOccurrence.findUnique({ where: { id: claimA.occurrenceId } });
    expect(row?.claimToken).toBe(claimB.claimToken);
  });

  it("38. a stale worker's old claimToken can never mark a newer worker's occurrence FAILED", async () => {
    const schedule = await createSchedule(fixtures);
    const now = new Date();

    const claimA = await claimOccurrence(prisma, schedule.id, schedule.nextIssueDate, now);
    if (claimA.outcome !== "claimed") throw new Error("expected claimed");
    await prisma.recurringInvoiceOccurrence.update({
      where: { id: claimA.occurrenceId },
      data: { claimedAt: new Date(now.getTime() - CLAIM_LEASE_MS - 1000) },
    });
    const claimB = await claimOccurrence(prisma, schedule.id, schedule.nextIssueDate, new Date(now.getTime() + 1000));
    if (claimB.outcome !== "claimed") throw new Error("expected claimed");

    // Worker B completes it for real.
    await prisma.recurringInvoiceOccurrence.update({
      where: { id: claimB.occurrenceId },
      data: { status: "COMPLETED" },
    });

    // Worker A (stale token) attempts the exact Transaction C FAILED-marking predicate.
    const staleFail = await prisma.recurringInvoiceOccurrence.updateMany({
      where: { id: claimA.occurrenceId, status: "PENDING", claimToken: claimA.claimToken },
      data: { status: "FAILED", failureReason: "NUMBERING_EXHAUSTED" },
    });
    expect(staleFail.count).toBe(0);

    const row = await prisma.recurringInvoiceOccurrence.findUnique({ where: { id: claimA.occurrenceId } });
    expect(row?.status).toBe("COMPLETED");
  });

  it("39. attemptCount increments only on claim/reclaim — a successful single-candidate generation leaves it at 1", async () => {
    const schedule = await createSchedule(fixtures);
    const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    expect(result.outcome).toBe("generated");

    const row = await prisma.recurringInvoiceOccurrence.findUnique({
      where: { recurringInvoiceId_occurrenceDate: { recurringInvoiceId: schedule.id, occurrenceDate: schedule.nextIssueDate } },
    });
    expect(row?.attemptCount).toBe(1);
  });

  it("40. full numbering exhaustion (a crash-equivalent full-round failure) leaves no partial Invoice/sequence/completion state", async () => {
    const schedule = await createSchedule(fixtures, { invoiceNumberPrefix: "EXH-", startingSequence: 1 });
    // Manually occupy every candidate this round will try (1..MAX_ATTEMPTS).
    for (let seq = 1; seq <= MAX_ATTEMPTS; seq++) {
      await prisma.invoice.create({
        data: {
          invoiceNumber: `EXH-${seq}`,
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

    const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, new Date("2027-01-02T00:00:00.000Z"));
    expect(result).toEqual({ outcome: "failed", reason: "NUMBERING_EXHAUSTED" });

    // No partial/duplicate Invoice beyond the MAX_ATTEMPTS manually-seeded ones.
    expect(await prisma.invoice.count({ where: { organizationId: fixtures.orgA.id, invoiceNumber: { startsWith: "EXH-" } } })).toBe(MAX_ATTEMPTS);

    const occurrence = await prisma.recurringInvoiceOccurrence.findUnique({
      where: { recurringInvoiceId_occurrenceDate: { recurringInvoiceId: schedule.id, occurrenceDate: schedule.nextIssueDate } },
    });
    expect(occurrence?.status).toBe("FAILED");
    expect(occurrence?.invoiceId).toBeNull();

    const updatedSchedule = await prisma.recurringInvoice.findUnique({ where: { id: schedule.id } });
    expect(updatedSchedule?.nextSequence).toBe(1 + MAX_ATTEMPTS);
  });
});
