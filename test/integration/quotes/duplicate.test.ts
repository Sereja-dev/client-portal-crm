import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createQuoteAction } from "@/app/(dashboard)/quotes/actions";
import { getDuplicateSourceQuote } from "@/lib/quotes/duplicate-source";
import { buildDuplicateQuoteDefaults } from "@/lib/quotes/duplicate";
import { suggestNextQuoteNumber } from "@/lib/quotes/suggest-next-quote-number";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Quote Duplicate-as-new-DRAFT. Exercises the real, end-to-end path the
 * duplicate page itself drives: getDuplicateSourceQuote() (real,
 * organization-scoped Prisma read) -> buildDuplicateQuoteDefaults() (pure
 * mapping) -> the ordinary, completely unmodified createQuoteAction() —
 * never a dedicated "duplicate create" implementation, matching this
 * slice's own explicit "reuse the existing create action" instruction.
 * The React Server Component page itself is covered separately by E2E.
 */

const NAME_PREFIX = "Quote-Dup";

function uniqueNumber(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
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

/** Loads the source, builds defaults, and submits through the ordinary create action — the exact sequence the real duplicate page performs. */
async function duplicateQuote(sourceId: string, organizationId: string, today = new Date("2026-08-17T12:00:00.000Z")) {
  const source = await getDuplicateSourceQuote(sourceId, organizationId);
  if (!source) return { ok: false as const, reason: "not_found" as const };

  const suggestedNumber = await suggestNextQuoteNumber(organizationId);
  const defaults = buildDuplicateQuoteDefaults(
    {
      leadId: source.leadId,
      clientId: source.clientId,
      title: source.title,
      currency: source.currency,
      notes: source.notes,
      discountType: source.discountType,
      discountValue: source.discountValue?.toString() ?? null,
      taxRatePercent: source.taxRatePercent?.toString() ?? null,
      taxLabel: source.taxLabel,
      items: source.items.map((item) => ({
        description: item.description,
        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice.toString(),
      })),
    },
    suggestedNumber,
    today,
  );

  const result = await createQuoteAction({
    number: defaults.number,
    title: defaults.title,
    leadId: defaults.leadId,
    clientId: defaults.clientId,
    issueDate: defaults.issueDate,
    validUntil: defaults.validUntil,
    currency: defaults.currency,
    notes: defaults.notes,
    discountType: defaults.discountType,
    discountValue: defaults.discountValue,
    taxRatePercent: defaults.taxRatePercent,
    taxLabel: defaults.taxLabel,
    items: defaults.items,
  });

  return { ok: true as const, result, source, defaults };
}

async function captureQuoteState(quoteId: string) {
  const [quote, items] = await Promise.all([
    prisma.quote.findUniqueOrThrow({ where: { id: quoteId } }),
    prisma.quoteItem.findMany({ where: { quoteId }, orderBy: { position: "asc" } }),
  ]);
  return {
    quote: { ...quote, updatedAt: quote.updatedAt.toISOString(), createdAt: quote.createdAt.toISOString() },
    items: items.map((i) => ({ ...i, updatedAt: i.updatedAt.toISOString(), createdAt: i.createdAt.toISOString() })),
  };
}

describe("Quote Duplicate-as-new-DRAFT", () => {
  let fixtures: TestFixtures;
  let leadA: { id: string };

  beforeAll(async () => {
    fixtures = await seedTestData();
    leadA = await prisma.lead.create({
      data: { name: "Dup Test Lead", organizationId: fixtures.orgA.id, email: "duplead@example.test" },
    });
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    // Scoped by organizationId, not by number prefix — a duplicated
    // Quote's own number comes from the real suggestNextQuoteNumber()
    // scheme (e.g. "Q-0001"), never this test file's own NAME_PREFIX, so
    // a prefix-based delete would silently leave every duplicate behind.
    // Matches test/integration/quotes/convert-to-invoice.test.ts's own
    // identical org-scoped cleanup precedent.
    await prisma.quote.deleteMany({ where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    await prisma.lead.deleteMany({ where: { id: leadA.id } });
    await cleanupTestData(fixtures);
  });

  // --- Eligibility: every source status produces a new DRAFT -----------------

  const statusScenarios: Array<{ name: string; setup: (quoteId: string) => Promise<void> }> = [
    { name: "DRAFT", setup: async () => {} },
    { name: "SENT", setup: async (id) => void (await prisma.quote.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } })) },
    {
      name: "APPROVED",
      setup: async (id) => void (await prisma.quote.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date() } })),
    },
    {
      name: "DECLINED",
      setup: async (id) => void (await prisma.quote.update({ where: { id }, data: { status: "DECLINED", declinedAt: new Date() } })),
    },
    {
      name: "expired SENT",
      setup: async (id) =>
        void (await prisma.quote.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), validUntil: new Date("2020-01-01") } })),
    },
    { name: "archived DRAFT", setup: async (id) => void (await prisma.quote.update({ where: { id }, data: { archivedAt: new Date() } })) },
  ];

  for (const scenario of statusScenarios) {
    it(`source at ${scenario.name} duplicates into a new, unarchived DRAFT — with its own fresh id/number/createdAt`, async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const created = await createQuoteAction(baseQuoteInput({ clientId: fixtures.clientA.id }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      await scenario.setup(created.quoteId);

      const outcome = await duplicateQuote(created.quoteId, fixtures.orgA.id);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.ok).toBe(true);
      if (!outcome.result.ok) return;

      const duplicated = await prisma.quote.findUniqueOrThrow({ where: { id: outcome.result.quoteId } });
      expect(duplicated.id).not.toBe(created.quoteId);
      expect(duplicated.status).toBe("DRAFT");
      expect(duplicated.archivedAt).toBeNull();
      expect(duplicated.number).not.toBe(outcome.source.number);
    });
  }

  // --- A converted source: new Quote never inherits convertedInvoiceId ------

  it("a converted source duplicates into a new DRAFT with convertedInvoiceId NOT copied — source remains converted", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseQuoteInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await prisma.quote.update({ where: { id: created.quoteId }, data: { status: "APPROVED", approvedAt: new Date() } });

    const fakeInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `${NAME_PREFIX}-CONV-${randomUUID().slice(0, 8)}`,
        status: "DRAFT",
        amount: "100.00",
        subtotal: "100.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        organizationId: fixtures.orgA.id,
      },
    });
    await prisma.quote.update({ where: { id: created.quoteId }, data: { convertedInvoiceId: fakeInvoice.id } });

    const outcome = await duplicateQuote(created.quoteId, fixtures.orgA.id);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok) return;

    const duplicated = await prisma.quote.findUniqueOrThrow({ where: { id: outcome.result.quoteId } });
    expect(duplicated.convertedInvoiceId).toBeNull();
    expect(duplicated.status).toBe("DRAFT");

    const sourceAfter = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
    expect(sourceAfter.convertedInvoiceId).toBe(fakeInvoice.id);
    expect(sourceAfter.status).toBe("APPROVED");

    await prisma.invoice.deleteMany({ where: { id: fakeInvoice.id } });
  });

  // --- Field-level copy/reset matrix ------------------------------------------

  it("copies target (Client), currency, items, discount/tax/notes; resets lifecycle/send/approval/archive fields; issueDate is today, validUntil blank, number is a fresh suggestion", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(
      baseQuoteInput({
        clientId: fixtures.clientA.id,
        currency: "EUR",
        title: "Website redesign",
        notes: "Client-visible note",
        discountType: "PERCENTAGE",
        discountValue: "10",
        taxRatePercent: "8.25",
        taxLabel: "VAT",
        items: [
          { description: "Design", quantity: "2", unitPrice: "50.00" },
          { description: "Hosting", quantity: "1", unitPrice: "29.99" },
        ],
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await prisma.quote.update({
      where: { id: created.quoteId },
      data: { status: "SENT", sentAt: new Date(), recipientName: "Someone", recipientEmail: "someone@example.test" },
    });

    const outcome = await duplicateQuote(created.quoteId, fixtures.orgA.id, new Date("2026-08-17T12:00:00.000Z"));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok) return;

    const duplicated = await prisma.quote.findUniqueOrThrow({
      where: { id: outcome.result.quoteId },
      include: { items: { orderBy: { position: "asc" } } },
    });

    // Copied.
    expect(duplicated.clientId).toBe(fixtures.clientA.id);
    expect(duplicated.currency).toBe("EUR");
    expect(duplicated.title).toBe("Website redesign");
    expect(duplicated.notes).toBe("Client-visible note");
    expect(duplicated.discountType).toBe("PERCENTAGE");
    expect(duplicated.discountValue?.toString()).toBe("10");
    expect(duplicated.taxRatePercent?.toString()).toBe("8.25");
    expect(duplicated.taxLabel).toBe("VAT");
    expect(duplicated.items).toHaveLength(2);
    expect(duplicated.items[0].description).toBe("Design");
    expect(duplicated.items[1].description).toBe("Hosting");

    // Reset.
    expect(duplicated.status).toBe("DRAFT");
    expect(duplicated.sentAt).toBeNull();
    expect(duplicated.recipientName).toBeNull();
    expect(duplicated.recipientEmail).toBeNull();
    expect(duplicated.approvedAt).toBeNull();
    expect(duplicated.declinedAt).toBeNull();
    expect(duplicated.convertedInvoiceId).toBeNull();
    expect(duplicated.archivedAt).toBeNull();
    expect(duplicated.issueDate.toISOString().slice(0, 10)).toBe("2026-08-17");
    expect(duplicated.validUntil).toBeNull();
    expect(duplicated.number).not.toBe(outcome.source.number);
  });

  it("a Lead-target source duplicates with the Lead preserved (never silently switched to Client)", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseQuoteInput({ leadId: leadA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const outcome = await duplicateQuote(created.quoteId, fixtures.orgA.id);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok) return;

    const duplicated = await prisma.quote.findUniqueOrThrow({ where: { id: outcome.result.quoteId } });
    expect(duplicated.leadId).toBe(leadA.id);
    expect(duplicated.clientId).toBeNull();
  });

  // --- Source immutability -----------------------------------------------------

  it("source Quote remains byte-for-byte unchanged in every lifecycle-relevant field after a duplicate is created", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseQuoteInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await prisma.quote.update({ where: { id: created.quoteId }, data: { status: "APPROVED", approvedAt: new Date() } });

    const before = await captureQuoteState(created.quoteId);

    const outcome = await duplicateQuote(created.quoteId, fixtures.orgA.id);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const after = await captureQuoteState(created.quoteId);
    expect(after).toEqual(before);
  });

  // --- Tenant isolation / invalid target protection ---------------------------

  it("a cross-organization source id is not found — indistinguishable from a nonexistent id", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const createdInOrgB = await (async () => {
      actAs(fixtures.orgBOwner, fixtures.orgB.id);
      const result = await createQuoteAction(baseQuoteInput({ clientId: fixtures.clientB.id }));
      actAs(fixtures.owner, fixtures.orgA.id);
      return result;
    })();
    expect(createdInOrgB.ok).toBe(true);
    if (!createdInOrgB.ok) return;

    const [crossOrg, nonexistent] = await Promise.all([
      getDuplicateSourceQuote(createdInOrgB.quoteId, fixtures.orgA.id),
      getDuplicateSourceQuote(randomUUID(), fixtures.orgA.id),
    ]);
    expect(crossOrg).toBeNull();
    expect(nonexistent).toBeNull();
  });

  it("a missing source id is not found", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getDuplicateSourceQuote(randomUUID(), fixtures.orgA.id);
    expect(result).toBeNull();
  });

  it("a foreign-organization client cannot be injected into the duplicated create payload — createQuoteAction's own target resolution still rejects it", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseQuoteInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const source = await getDuplicateSourceQuote(created.quoteId, fixtures.orgA.id);
    expect(source).not.toBeNull();
    if (!source) return;

    // Simulate a forged payload that swaps in a foreign-org clientId —
    // the real duplicate page never does this (it only ever reads
    // source.clientId unchanged), but createQuoteAction's own
    // resolveQuoteTarget() must reject it regardless of what any caller
    // supplies.
    const result = await createQuoteAction({
      number: uniqueNumber(),
      clientId: fixtures.clientB.id,
      issueDate: "2026-06-01",
      currency: "USD",
      items: [{ description: "Design", quantity: "1", unitPrice: "1.00" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_target");
  });
});
