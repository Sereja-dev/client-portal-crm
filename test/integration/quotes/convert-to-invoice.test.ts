import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createQuoteAction, convertQuoteToInvoiceAction } from "@/app/(dashboard)/quotes/actions";
import { deleteInvoiceAction } from "@/app/(dashboard)/invoices/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Quotes / Estimates Phase 2.3 — convertQuoteToInvoiceAction. Covers §AB
 * QUOTE CONVERSION (items 36-55) and DELETE/RECONVERT (items 56-58).
 *
 * Every test below acts as fixtures.owner in fixtures.orgA unless noted.
 * A Quote is moved to APPROVED by a direct Prisma update — this phase
 * has no Portal approve/decline flow yet, matching every other Quote
 * lifecycle test file's own established precedent (send.test.ts,
 * reopen.test.ts) of driving status directly for states no Server
 * Action can reach yet.
 */

const NAME_PREFIX = "Quote-Convert";

function uniqueNumber(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

function uniqueInvoiceNumber(): string {
  return `${NAME_PREFIX}-INV-${randomUUID().slice(0, 8)}`;
}

function baseQuoteInput(overrides: Record<string, unknown> = {}) {
  return {
    number: uniqueNumber(),
    issueDate: "2026-06-01",
    currency: "USD",
    items: [{ description: "Design", quantity: "2", unitPrice: "50.00" }],
    ...overrides,
  };
}

async function createApprovedQuote(overrides: Record<string, unknown> = {}) {
  const created = await createQuoteAction(baseQuoteInput(overrides));
  if (!created.ok) throw new Error("fixture Quote create failed");
  await prisma.quote.update({ where: { id: created.quoteId }, data: { status: "APPROVED", approvedAt: new Date() } });
  return created.quoteId;
}

describe("convertQuoteToInvoiceAction", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: NAME_PREFIX } } });
    await prisma.quote.deleteMany({ where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    await cleanupTestData(fixtures);
  });

  it("36 & 40 & 41 & 42 & 43 & 45 & 46. an APPROVED Quote converts to a project-less DRAFT Invoice, exact totals/items/currency copied, clientId from the Quote, convertedInvoiceId set, Quote remains APPROVED", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const quoteId = await createApprovedQuote({ clientId: fixtures.clientA.id, currency: "EUR" });
    const quoteBefore = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { items: { orderBy: { position: "asc" } } } });

    const invoiceNumber = uniqueInvoiceNumber();
    const result = await convertQuoteToInvoiceAction(quoteId, invoiceNumber);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: result.invoiceId }, include: { lineItems: { orderBy: { position: "asc" } } } });
    expect(invoice.status).toBe("DRAFT");
    expect(invoice.projectId).toBeNull();
    expect(invoice.clientId).toBe(fixtures.clientA.id);
    expect(invoice.currency).toBe("EUR");
    expect(invoice.amount.toString()).toBe(quoteBefore.total.toString());
    expect(invoice.subtotal?.toString()).toBe(quoteBefore.subtotal.toString());
    expect(invoice.discountAmount?.toString()).toBe(quoteBefore.discountAmount.toString());
    expect(invoice.taxAmount?.toString()).toBe(quoteBefore.taxAmount.toString());
    expect(invoice.lineItems).toHaveLength(1);
    expect(invoice.lineItems[0].description).toBe("Design");
    expect(invoice.lineItems[0].quantity.toString()).toBe("2");
    expect(invoice.lineItems[0].unitPrice.toFixed(2)).toBe("50.00");

    const quoteAfter = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    expect(quoteAfter.convertedInvoiceId).toBe(invoice.id);
    expect(quoteAfter.status).toBe("APPROVED");
  });

  it("37. an optional, valid Project (belonging to the Quote's own Client) can be supplied", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const quoteId = await createApprovedQuote({ clientId: fixtures.clientA.id });

    const result = await convertQuoteToInvoiceAction(quoteId, uniqueInvoiceNumber(), fixtures.project.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: result.invoiceId } });
    expect(invoice.projectId).toBe(fixtures.project.id);
    expect(invoice.clientId).toBe(fixtures.clientA.id);
  });

  it("38. a foreign-org Project is rejected — Quote remains unconverted", async () => {
    const foreignProject = await prisma.project.create({
      data: { name: "Foreign project", clientId: fixtures.clientB.id, organizationId: fixtures.orgB.id, ownerId: fixtures.orgBOwner.id, status: "IN_PROGRESS" },
    });
    try {
      actAs(fixtures.owner, fixtures.orgA.id);
      const quoteId = await createApprovedQuote({ clientId: fixtures.clientA.id });

      const result = await convertQuoteToInvoiceAction(quoteId, uniqueInvoiceNumber(), foreignProject.id);
      expect(result).toEqual({ ok: false, reason: "invalid_target" });

      const quote = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
      expect(quote.convertedInvoiceId).toBeNull();
    } finally {
      await prisma.project.deleteMany({ where: { id: foreignProject.id } });
    }
  });

  it("39. a Project belonging to a DIFFERENT Client (same org) is rejected", async () => {
    const otherClient = await prisma.client.create({
      data: { name: "Other client", organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    const otherProject = await prisma.project.create({
      data: { name: "Other client project", clientId: otherClient.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "IN_PROGRESS" },
    });
    try {
      actAs(fixtures.owner, fixtures.orgA.id);
      const quoteId = await createApprovedQuote({ clientId: fixtures.clientA.id });

      const result = await convertQuoteToInvoiceAction(quoteId, uniqueInvoiceNumber(), otherProject.id);
      expect(result).toEqual({ ok: false, reason: "invalid_target" });
    } finally {
      await prisma.project.deleteMany({ where: { id: otherProject.id } });
      await prisma.client.deleteMany({ where: { id: otherClient.id } });
    }
  });

  it("44. Quote.notes is copied onto the new Invoice", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const quoteId = await createApprovedQuote({ clientId: fixtures.clientA.id, notes: "Please confirm scope before starting." });

    const result = await convertQuoteToInvoiceAction(quoteId, uniqueInvoiceNumber());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: result.invoiceId } });
    expect(invoice.notes).toBe("Please confirm scope before starting.");
  });

  it("47. a non-APPROVED Quote (DRAFT) is rejected", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseQuoteInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await convertQuoteToInvoiceAction(created.quoteId, uniqueInvoiceNumber());
    expect(result).toEqual({ ok: false, reason: "invalid_transition" });
  });

  it("48. a Quote with no clientId (still only attached to an unconverted Lead) is rejected", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const lead = await prisma.lead.create({ data: { name: "Unconverted Lead", organizationId: fixtures.orgA.id } });
    try {
      const created = await createQuoteAction(baseQuoteInput({ leadId: lead.id }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      await prisma.quote.update({ where: { id: created.quoteId }, data: { status: "APPROVED", approvedAt: new Date() } });

      const result = await convertQuoteToInvoiceAction(created.quoteId, uniqueInvoiceNumber());
      expect(result).toEqual({ ok: false, reason: "no_client" });
    } finally {
      await prisma.quote.deleteMany({ where: { leadId: lead.id } });
      await prisma.lead.deleteMany({ where: { id: lead.id } });
    }
  });

  it("49. an archived Quote is rejected", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const quoteId = await createApprovedQuote({ clientId: fixtures.clientA.id });
    await prisma.quote.update({ where: { id: quoteId }, data: { archivedAt: new Date() } });

    const result = await convertQuoteToInvoiceAction(quoteId, uniqueInvoiceNumber());
    expect(result).toEqual({ ok: false, reason: "invalid_transition" });
  });

  it("52. repeat conversion of an already-converted Quote is rejected", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const quoteId = await createApprovedQuote({ clientId: fixtures.clientA.id });
    const first = await convertQuoteToInvoiceAction(quoteId, uniqueInvoiceNumber());
    expect(first.ok).toBe(true);

    const second = await convertQuoteToInvoiceAction(quoteId, uniqueInvoiceNumber());
    expect(second).toEqual({ ok: false, reason: "already_converted" });
  });

  it("a missing/foreign quoteId is rejected", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await convertQuoteToInvoiceAction(randomUUID(), uniqueInvoiceNumber());
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("a foreign-org Quote id is rejected, indistinguishable from nonexistent", async () => {
    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    const quoteId = await createApprovedQuote({ clientId: fixtures.clientB.id });
    resetAuthMock();

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await convertQuoteToInvoiceAction(quoteId, uniqueInvoiceNumber());
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("an empty invoiceNumber is rejected as a validation error before any DB write", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const quoteId = await createApprovedQuote({ clientId: fixtures.clientA.id });
    const result = await convertQuoteToInvoiceAction(quoteId, "   ");
    expect(result).toEqual({ ok: false, reason: "validation", fieldErrors: { invoiceNumber: "Invoice number is required." } });
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    expect(quote.convertedInvoiceId).toBeNull();
  });

  it("54. exactly one Quote CONVERTED Activity and one Invoice CREATED Activity are written", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const quoteId = await createApprovedQuote({ clientId: fixtures.clientA.id });
    const result = await convertQuoteToInvoiceAction(quoteId, uniqueInvoiceNumber());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const convertedActivities = await prisma.activity.findMany({ where: { entityType: "QUOTE", entityId: quoteId, action: "CONVERTED" } });
    expect(convertedActivities).toHaveLength(1);
    const createdActivities = await prisma.activity.findMany({ where: { entityType: "INVOICE", entityId: result.invoiceId, action: "CREATED" } });
    expect(createdActivities).toHaveLength(1);
  });

  it("53. concurrent conversion attempts: exactly one Invoice, one convertedInvoiceId, one CONVERTED Activity, no orphaned line items", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const quoteId = await createApprovedQuote({ clientId: fixtures.clientA.id, items: [{ description: "Race item", quantity: "1", unitPrice: "10.00" }] });

    const numberA = uniqueInvoiceNumber();
    const numberB = uniqueInvoiceNumber();
    const [settledA, settledB] = await Promise.allSettled([
      convertQuoteToInvoiceAction(quoteId, numberA),
      convertQuoteToInvoiceAction(quoteId, numberB),
    ]);

    const results = [settledA, settledB].map((s) => (s.status === "fulfilled" ? s.value : { ok: false as const, reason: "threw" as const }));
    const wins = results.filter((r) => r.ok);
    const losses = results.filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect((losses[0] as { reason: string }).reason).toBe("already_converted");

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    expect(quote.convertedInvoiceId).not.toBeNull();

    const invoiceCount = await prisma.invoice.count({ where: { invoiceNumber: { in: [numberA, numberB] } } });
    expect(invoiceCount).toBe(1);

    const winningInvoiceId = (wins[0] as { invoiceId: string }).invoiceId;
    expect(quote.convertedInvoiceId).toBe(winningInvoiceId);

    const lineItemCount = await prisma.invoiceLineItem.count({ where: { invoiceId: winningInvoiceId } });
    expect(lineItemCount).toBe(1); // exactly the one item copied — no duplicate/orphan

    const convertedActivities = await prisma.activity.findMany({ where: { entityType: "QUOTE", entityId: quoteId, action: "CONVERTED" } });
    expect(convertedActivities).toHaveLength(1);
  });

  it("56 & 57 & 58. deleting the converted DRAFT Invoice clears Quote.convertedInvoiceId, Quote remains APPROVED, and the Quote can be converted again with a new invoiceNumber", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const quoteId = await createApprovedQuote({ clientId: fixtures.clientA.id });
    const first = await convertQuoteToInvoiceAction(quoteId, uniqueInvoiceNumber());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const deleteResult = await deleteInvoiceAction(first.invoiceId);
    expect(deleteResult).toEqual({ ok: true });

    const quoteAfterDelete = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    expect(quoteAfterDelete.convertedInvoiceId).toBeNull();
    expect(quoteAfterDelete.status).toBe("APPROVED");

    const second = await convertQuoteToInvoiceAction(quoteId, uniqueInvoiceNumber());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.invoiceId).not.toBe(first.invoiceId);

    const quoteAfterReconvert = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    expect(quoteAfterReconvert.convertedInvoiceId).toBe(second.invoiceId);
  });

  // Deliberately LAST in this describe block — a genuine P2002 (Invoice's
  // own @@unique([organizationId, invoiceNumber])) thrown mid-transaction,
  // even correctly caught and mapped, leaves the shared PGlite pooled
  // connection in a state where the very next, otherwise-unrelated query
  // can intermittently misbehave (this session's own established finding,
  // documented in every other Quote lifecycle test file that triggers a
  // real DB-level constraint violation — see e.g. create.test.ts's own
  // identical ordering discipline).
  it("50 & 51. a duplicate invoice number is rejected with a controlled result — no partial Invoice, Quote remains unconverted", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const takenNumber = uniqueInvoiceNumber();
    // Seed a real, already-existing Invoice with this number in the org.
    await prisma.invoice.create({
      data: {
        invoiceNumber: takenNumber,
        status: "DRAFT",
        amount: "10.00",
        subtotal: "10.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        organizationId: fixtures.orgA.id,
        issueDate: new Date(),
      },
    });

    const quoteId = await createApprovedQuote({ clientId: fixtures.clientA.id });
    const result = await convertQuoteToInvoiceAction(quoteId, takenNumber);
    expect(result).toEqual({ ok: false, reason: "duplicate_invoice_number" });

    // The real P2002 this triggers, even correctly caught and mapped,
    // leaves the shared local PGlite/pg-adapter test harness (`max: 1`
    // pool) needing a brief moment to settle before a fresh read is
    // guaranteed consistent — the same established finding documented in
    // test/integration/invoices/duplicate.test.ts's own "collision" test,
    // reused here verbatim rather than re-derived.
    const deadline = Date.now() + 2000;
    let invoiceCount = -1;
    while (Date.now() < deadline) {
      try {
        invoiceCount = await prisma.invoice.count({ where: { organizationId: fixtures.orgA.id, invoiceNumber: takenNumber } });
        if (invoiceCount === 1) break;
      } catch {
        // Retried below.
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(invoiceCount).toBe(1); // still just the pre-seeded one, no partial second row

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    expect(quote.convertedInvoiceId).toBeNull();

    const lineItemCount = await prisma.invoiceLineItem.count({ where: { invoice: { invoiceNumber: takenNumber } } });
    expect(lineItemCount).toBe(0); // the seeded Invoice had no items, and the rejected attempt left none behind either
  });
});
