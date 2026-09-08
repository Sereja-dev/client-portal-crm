import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createQuoteAction } from "@/app/(dashboard)/quotes/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Quotes / Estimates Phase 2 — createQuoteAction. Same fixtures/auth-mock
 * convention as every other integration test in this repo (see
 * test/integration/leads/create.test.ts). Quote.organizationId is
 * onDelete: Restrict (unlike Lead's own Cascade — see Quote's own schema
 * comment), so every test here explicitly deletes its own Quote rows
 * before cleanupTestData() removes the fixture Organizations/Clients/
 * Leads/Users those Quotes reference.
 *
 * Covers RETURN FORMAT §T CREATE items 1-11 (item 12, the create rate
 * limit, is covered separately in create-rate-limit.test.ts, matching
 * this repo's own established "don't exhaust the real in-memory bucket in
 * every other test file" convention).
 */

const NAME_PREFIX = "Quote-Create";

function uniqueNumber(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    number: uniqueNumber(),
    title: "Website redesign",
    issueDate: "2026-06-01",
    currency: "USD",
    items: [{ description: "Design", quantity: "10", unitPrice: "50.00" }],
    ...overrides,
  };
}

describe("createQuoteAction", () => {
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

  it("1. creates a valid Client-target Quote", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: result.quoteId } });
    expect(quote.clientId).toBe(fixtures.clientA.id);
    expect(quote.leadId).toBeNull();
    expect(quote.status).toBe("DRAFT");
    expect(quote.organizationId).toBe(fixtures.orgA.id);
    expect(quote.createdByUserId).toBe(fixtures.owner.id);
    expect(quote.sentAt).toBeNull();
    expect(quote.approvedAt).toBeNull();
    expect(quote.declinedAt).toBeNull();
    expect(quote.recipientName).toBeNull();
    expect(quote.recipientEmail).toBeNull();
    expect(quote.archivedAt).toBeNull();
    expect(quote.convertedInvoiceId).toBeNull();

    const activity = await prisma.activity.findFirst({
      where: { organizationId: fixtures.orgA.id, entityType: "QUOTE", entityId: result.quoteId, action: "CREATED" },
    });
    expect(activity).not.toBeNull();
  });

  it("2. creates a valid unconverted-Lead Quote", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const lead = await prisma.lead.create({ data: { name: `${NAME_PREFIX}-Lead`, organizationId: fixtures.orgA.id } });
    try {
      const result = await createQuoteAction(baseInput({ leadId: lead.id }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const quote = await prisma.quote.findUniqueOrThrow({ where: { id: result.quoteId } });
      expect(quote.leadId).toBe(lead.id);
      expect(quote.clientId).toBeNull();
    } finally {
      await prisma.quote.deleteMany({ where: { leadId: lead.id } });
      await prisma.lead.deleteMany({ where: { id: lead.id } });
    }
  });

  it("3. an already-converted Lead creates a Quote with both leadId and clientId", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const convertedClient = await prisma.client.create({
      data: { name: `${NAME_PREFIX}-Converted-Client`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    const lead = await prisma.lead.create({
      data: {
        name: `${NAME_PREFIX}-Converted-Lead`,
        organizationId: fixtures.orgA.id,
        convertedClientId: convertedClient.id,
        convertedAt: new Date(),
        stage: "WON",
      },
    });
    try {
      const result = await createQuoteAction(baseInput({ leadId: lead.id }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const quote = await prisma.quote.findUniqueOrThrow({ where: { id: result.quoteId } });
      expect(quote.leadId).toBe(lead.id);
      expect(quote.clientId).toBe(convertedClient.id);
    } finally {
      await prisma.quote.deleteMany({ where: { leadId: lead.id } });
      await prisma.lead.deleteMany({ where: { id: lead.id } });
      await prisma.client.deleteMany({ where: { id: convertedClient.id } });
    }
  });

  it("4. neither target (leadId nor clientId) is rejected as a validation error", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createQuoteAction(baseInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("validation");
    if (result.reason === "validation") {
      expect(result.fieldErrors.target).toBeTruthy();
    }
  });

  it("5. both target inputs (leadId AND clientId) are rejected at creation", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id, leadId: randomUUID() }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("validation");
    if (result.reason === "validation") {
      expect(result.fieldErrors.target).toBeTruthy();
    }
  });

  it("6. a foreign-org Lead is rejected", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const foreignLead = await prisma.lead.create({ data: { name: `${NAME_PREFIX}-Foreign-Lead`, organizationId: fixtures.orgB.id } });
    try {
      const result = await createQuoteAction(baseInput({ leadId: foreignLead.id }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("invalid_target");
    } finally {
      await prisma.lead.deleteMany({ where: { id: foreignLead.id } });
    }
  });

  it("7. a foreign-org Client is rejected", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createQuoteAction(baseInput({ clientId: fixtures.clientB.id }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_target");
  });

  it("a nonexistent Lead id and a foreign-org Lead id produce the identical result (no existence oracle)", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const foreignLead = await prisma.lead.create({ data: { name: `${NAME_PREFIX}-Foreign-Lead-2`, organizationId: fixtures.orgB.id } });
    try {
      const nonexistentResult = await createQuoteAction(baseInput({ leadId: randomUUID() }));
      const foreignResult = await createQuoteAction(baseInput({ leadId: foreignLead.id }));
      expect(nonexistentResult.ok).toBe(false);
      expect(foreignResult.ok).toBe(false);
      if (nonexistentResult.ok || foreignResult.ok) return;
      expect(nonexistentResult.reason).toBe(foreignResult.reason);
      expect(nonexistentResult.reason).toBe("invalid_target");
    } finally {
      await prisma.lead.deleteMany({ where: { id: foreignLead.id } });
    }
  });

  it("8. organizationId cannot be caller-controlled — QuoteWritableInput has no such field, and any smuggled-in value is simply ignored", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createQuoteAction({
      ...baseInput({ clientId: fixtures.clientA.id }),
      ...({ organizationId: fixtures.orgB.id } as object),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: result.quoteId } });
    expect(quote.organizationId).toBe(fixtures.orgA.id);
  });

  it("9. totals are recalculated server-side, never trusting a submitted total", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createQuoteAction({
      ...baseInput({
        clientId: fixtures.clientA.id,
        items: [{ description: "Consulting", quantity: "3", unitPrice: "100.00" }],
        discountType: "PERCENTAGE",
        discountValue: "10",
        taxRatePercent: "8",
      }),
      ...({ total: "999999.99", subtotal: "999999.99" } as object),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: result.quoteId } });
    // subtotal 300, 10% discount -> 30, taxable base 270, 8% tax -> 21.60, total 291.60
    expect(quote.subtotal.toString()).toBe("300");
    expect(quote.discountAmount.toString()).toBe("30");
    expect(quote.taxAmount.toString()).toBe("21.6");
    expect(quote.total.toString()).toBe("291.6");
  });

  it("10. line items are stored correctly, with server-assigned contiguous positions", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createQuoteAction(
      baseInput({
        clientId: fixtures.clientA.id,
        items: [
          { description: "Item A", quantity: "1", unitPrice: "10.00" },
          { description: "Item B", quantity: "2", unitPrice: "20.00" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = await prisma.quoteItem.findMany({ where: { quoteId: result.quoteId }, orderBy: { position: "asc" } });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ description: "Item A", position: 0 });
    expect(items[1]).toMatchObject({ description: "Item B", position: 1 });
    expect(items[0].lineTotal.toString()).toBe("10");
    expect(items[1].lineTotal.toString()).toBe("40");
  });

  it("the same number is fine across two different organizations", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const number = uniqueNumber();
    const first = await createQuoteAction(baseInput({ number, clientId: fixtures.clientA.id }));
    expect(first.ok).toBe(true);
    resetAuthMock();

    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    const second = await createQuoteAction(baseInput({ number, clientId: fixtures.clientB.id }));
    expect(second.ok).toBe(true);
  });

  // Deliberately the LAST test in this file: it triggers a genuine
  // Postgres unique-constraint violation mid-transaction (a real P2002,
  // not mocked — matching this repo's own established rule that
  // number-uniqueness must be tested against the real database
  // constraint, see test/integration/invoices/
  // invoice-number-organization-uniqueness.test.ts's own header comment).
  // A prior investigation in this same phase found that the shared local
  // PGlite/pg-adapter test harness can leave its one pooled connection in
  // a state where the very next, otherwise-unrelated query (a plain
  // identity lookup for a different user) intermittently misbehaves
  // immediately after such a rollback — ordering this test last avoids
  // that hazard entirely rather than fighting PGlite's own limitation.
  it("11. a duplicate Quote number within the same organization is controlled, not a raw P2002", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const number = uniqueNumber();
    const first = await createQuoteAction(baseInput({ number, clientId: fixtures.clientA.id }));
    expect(first.ok).toBe(true);

    const second = await createQuoteAction(baseInput({ number, clientId: fixtures.clientA.id }));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("duplicate_quote_number");
  });
});
