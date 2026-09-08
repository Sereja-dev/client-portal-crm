import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createQuoteAction, reopenQuoteAction } from "@/app/(dashboard)/quotes/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Quotes / Estimates Phase 2 — reopenQuoteAction. Covers RETURN FORMAT §T
 * REOPEN items 32-36.
 */

const NAME_PREFIX = "Quote-Reopen";

function uniqueNumber(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    number: uniqueNumber(),
    issueDate: "2026-06-01",
    currency: "USD",
    items: [{ description: "Design", quantity: "1", unitPrice: "50.00" }],
    ...overrides,
  };
}

describe("reopenQuoteAction", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    await cleanupTestData(fixtures);
  });

  it("32 & 34. DECLINED -> DRAFT, clearing declinedAt/sentAt/recipient snapshot", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await prisma.quote.update({
      where: { id: created.quoteId },
      data: {
        status: "DECLINED",
        sentAt: new Date(),
        declinedAt: new Date(),
        recipientName: "Stale Name",
        recipientEmail: "stale@example.com",
      },
    });

    const result = await reopenQuoteAction(created.quoteId);
    expect(result.ok).toBe(true);

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
    expect(quote.status).toBe("DRAFT");
    expect(quote.declinedAt).toBeNull();
    expect(quote.sentAt).toBeNull();
    expect(quote.recipientName).toBeNull();
    expect(quote.recipientEmail).toBeNull();

    const activity = await prisma.activity.findFirst({
      where: { entityType: "QUOTE", entityId: created.quoteId, action: "STATUS_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    expect(activity?.metadata).toMatchObject({ from: "DECLINED", to: "DRAFT" });
  });

  it("33 & 34. an expired SENT Quote reopens to DRAFT, clearing sentAt/recipient snapshot", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(
      baseInput({ clientId: fixtures.clientA.id, issueDate: "2019-01-01", validUntil: "2020-01-01" }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await prisma.quote.update({
      where: { id: created.quoteId },
      data: { status: "SENT", sentAt: new Date(), recipientName: "Stale Name", recipientEmail: "stale@example.com" },
    });

    const result = await reopenQuoteAction(created.quoteId);
    expect(result.ok).toBe(true);

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
    expect(quote.status).toBe("DRAFT");
    expect(quote.sentAt).toBeNull();
    expect(quote.recipientName).toBeNull();
    expect(quote.recipientEmail).toBeNull();
  });

  it("35. an APPROVED Quote cannot reopen", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await prisma.quote.update({ where: { id: created.quoteId }, data: { status: "APPROVED", approvedAt: new Date() } });

    const result = await reopenQuoteAction(created.quoteId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_transition");

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
    expect(quote.status).toBe("APPROVED");
  });

  it("36. an ordinary, non-expired SENT Quote cannot use reopen (editing it already resets to DRAFT)", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id, validUntil: "2099-01-01" }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await prisma.quote.update({ where: { id: created.quoteId }, data: { status: "SENT", sentAt: new Date() } });

    const result = await reopenQuoteAction(created.quoteId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_transition");

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
    expect(quote.status).toBe("SENT");
  });

  it("a converted Quote cannot reopen", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `${NAME_PREFIX}-INV-${randomUUID().slice(0, 8)}`,
        clientId: fixtures.clientA.id,
        projectId: fixtures.project.id,
        organizationId: fixtures.orgA.id,
        amount: "500.00",
        subtotal: "500.00",
      },
    });
    try {
      await prisma.quote.update({
        where: { id: created.quoteId },
        data: { status: "DECLINED", declinedAt: new Date(), convertedInvoiceId: invoice.id },
      });

      const result = await reopenQuoteAction(created.quoteId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("immutable");
    } finally {
      await prisma.quote.updateMany({ where: { id: created.quoteId }, data: { convertedInvoiceId: null } });
      await prisma.invoice.deleteMany({ where: { id: invoice.id } });
    }
  });

  it("a not-found quoteId (foreign org) is rejected", async () => {
    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    const foreignCreated = await createQuoteAction(baseInput({ clientId: fixtures.clientB.id }));
    expect(foreignCreated.ok).toBe(true);
    if (!foreignCreated.ok) return;
    await prisma.quote.update({ where: { id: foreignCreated.quoteId }, data: { status: "DECLINED", declinedAt: new Date() } });
    resetAuthMock();

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await reopenQuoteAction(foreignCreated.quoteId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_found");
  });
});
