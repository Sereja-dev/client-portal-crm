import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createQuoteAction, updateQuoteAction } from "@/app/(dashboard)/quotes/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Quotes / Estimates Phase 2 — updateQuoteAction. Covers RETURN FORMAT
 * §T UPDATE items 13-22 (item 23, the update rate limit, is covered
 * separately in update-rate-limit.test.ts).
 */

const NAME_PREFIX = "Quote-Update";

function uniqueNumber(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    number: uniqueNumber(),
    title: "Original title",
    issueDate: "2026-06-01",
    currency: "USD",
    items: [{ description: "Design", quantity: "10", unitPrice: "50.00" }],
    ...overrides,
  };
}

describe("updateQuoteAction", () => {
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

  it("13. a DRAFT Quote is freely editable", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateQuoteAction(
      created.quoteId,
      baseInput({ clientId: fixtures.clientA.id, title: "Updated title" }),
    );
    expect(result.ok).toBe(true);

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
    expect(quote.title).toBe("Updated title");
    expect(quote.status).toBe("DRAFT");
  });

  it("14. the target can change while DRAFT, and is revalidated", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const otherClient = await prisma.client.create({
      data: { name: `${NAME_PREFIX}-Other-Client`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    try {
      const result = await updateQuoteAction(created.quoteId, baseInput({ clientId: otherClient.id }));
      expect(result.ok).toBe(true);
      const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
      expect(quote.clientId).toBe(otherClient.id);
    } finally {
      await prisma.quote.updateMany({ where: { id: created.quoteId }, data: { clientId: fixtures.clientA.id } });
      await prisma.client.deleteMany({ where: { id: otherClient.id } });
    }
  });

  it("15. a foreign-org target on update is rejected", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateQuoteAction(created.quoteId, baseInput({ clientId: fixtures.clientB.id }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_target");

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
    expect(quote.clientId).toBe(fixtures.clientA.id);
  });

  it("16. totals are recalculated on update", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateQuoteAction(
      created.quoteId,
      baseInput({
        clientId: fixtures.clientA.id,
        items: [{ description: "New item", quantity: "2", unitPrice: "25.00" }],
        discountType: "FIXED",
        discountValue: "10",
      }),
    );
    expect(result.ok).toBe(true);
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
    expect(quote.subtotal.toString()).toBe("50");
    expect(quote.discountAmount.toString()).toBe("10");
    expect(quote.total.toString()).toBe("40");
  });

  it("17 & 18. editing a SENT Quote resets it to DRAFT and clears sentAt/recipient snapshot", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await prisma.quote.update({
      where: { id: created.quoteId },
      data: { status: "SENT", sentAt: new Date(), recipientName: "Snapshot Name", recipientEmail: "snapshot@example.com" },
    });

    const result = await updateQuoteAction(created.quoteId, baseInput({ clientId: fixtures.clientA.id, title: "Post-send edit" }));
    expect(result.ok).toBe(true);

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
    expect(quote.status).toBe("DRAFT");
    expect(quote.sentAt).toBeNull();
    expect(quote.recipientName).toBeNull();
    expect(quote.recipientEmail).toBeNull();
    expect(quote.title).toBe("Post-send edit");

    const statusChanged = await prisma.activity.findFirst({
      where: { entityType: "QUOTE", entityId: created.quoteId, action: "STATUS_CHANGED" },
    });
    expect(statusChanged).not.toBeNull();
    expect(statusChanged?.metadata).toMatchObject({ from: "SENT", to: "DRAFT" });
  });

  it("19. editing an APPROVED Quote is rejected", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await prisma.quote.update({ where: { id: created.quoteId }, data: { status: "APPROVED", approvedAt: new Date() } });

    const result = await updateQuoteAction(created.quoteId, baseInput({ clientId: fixtures.clientA.id, title: "Should not apply" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("immutable");

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
    expect(quote.title).not.toBe("Should not apply");
  });

  it("20. editing a DECLINED Quote directly is rejected (must reopen first)", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await prisma.quote.update({ where: { id: created.quoteId }, data: { status: "DECLINED", declinedAt: new Date() } });

    const result = await updateQuoteAction(created.quoteId, baseInput({ clientId: fixtures.clientA.id, title: "Should not apply" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("immutable");
  });

  it("21. editing a converted Quote is rejected, even though its stored status is APPROVED", async () => {
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
        data: { status: "APPROVED", approvedAt: new Date(), convertedInvoiceId: invoice.id },
      });

      const result = await updateQuoteAction(created.quoteId, baseInput({ clientId: fixtures.clientA.id, title: "Should not apply" }));
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
    resetAuthMock();

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await updateQuoteAction(foreignCreated.quoteId, baseInput({ clientId: fixtures.clientA.id }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_found");
  });

  // Deliberately the LAST test in this file — see create.test.ts's own
  // comment on this same ordering discipline: a genuine, real Postgres
  // unique-constraint violation mid-transaction (even one this action
  // correctly catches and maps) can leave the shared local PGlite/
  // pg-adapter test harness's one pooled connection in a state where the
  // very next, otherwise-unrelated query intermittently misbehaves.
  it("22. a duplicate Quote number on update is controlled, not a raw P2002", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const existingNumber = uniqueNumber();
    const existing = await createQuoteAction(baseInput({ number: existingNumber, clientId: fixtures.clientA.id }));
    expect(existing.ok).toBe(true);

    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok || !existing.ok) return;

    const result = await updateQuoteAction(created.quoteId, baseInput({ number: existingNumber, clientId: fixtures.clientA.id }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("duplicate_quote_number");
  });
});
