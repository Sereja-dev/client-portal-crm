import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getPortalQuotes, getPortalQuote } from "@/lib/client-portal/queries";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Quotes / Estimates Phase 4 (Client Portal approval/decline) §D/§L/§M —
 * getPortalQuotes/getPortalQuote, the query layer both Portal Quote pages
 * call. Covers RETURN FORMAT §U LIST items 1-10 and DETAIL items 11-15.
 */
describe("Portal Quote visibility (§D/§L/§M)", () => {
  let fixtures: TestFixtures;
  const quoteIds: string[] = [];
  let draftQuote: { id: string };
  let sentQuote: { id: string };
  let approvedQuote: { id: string };
  let declinedQuote: { id: string };
  let expiredQuote: { id: string };
  let convertedQuote: { id: string };
  let convertedInvoiceId: string;
  let archivedQuote: { id: string };
  let otherClientSameOrg: { id: string };
  let otherClientQuote: { id: string };
  let otherOrgQuote: { id: string };
  let leadOnlyQuote: { id: string };
  let leadId: string;

  const suffix = randomUUID().slice(0, 8);

  async function createQuote(overrides: Record<string, unknown>) {
    const quote = await prisma.quote.create({
      data: {
        number: `PQV-${suffix}-${randomUUID().slice(0, 6)}`,
        status: "DRAFT",
        subtotal: "100.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        total: "100.00",
        organizationId: fixtures.orgA.id,
        createdByUserId: fixtures.owner.id,
        clientId: fixtures.clientA.id,
        items: { create: [{ description: "Item", quantity: "1", unitPrice: "100.00", lineTotal: "100.00", position: 0 }] },
        ...overrides,
      },
    });
    quoteIds.push(quote.id);
    return quote;
  }

  beforeAll(async () => {
    fixtures = await seedTestData();

    draftQuote = await createQuote({ status: "DRAFT" });
    sentQuote = await createQuote({ status: "SENT", sentAt: new Date(), validUntil: new Date(Date.now() + 86_400_000) });
    approvedQuote = await createQuote({ status: "APPROVED", approvedAt: new Date() });
    declinedQuote = await createQuote({ status: "DECLINED", declinedAt: new Date() });
    expiredQuote = await createQuote({ status: "SENT", sentAt: new Date(), validUntil: new Date("2020-01-01") });

    const forConversion = await createQuote({ status: "APPROVED", approvedAt: new Date() });
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `PQV-INV-${suffix}`,
        status: "DRAFT",
        amount: "100.00",
        subtotal: "100.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        organizationId: fixtures.orgA.id,
        issueDate: new Date(),
      },
    });
    convertedInvoiceId = invoice.id;
    convertedQuote = await prisma.quote.update({ where: { id: forConversion.id }, data: { convertedInvoiceId: invoice.id } });

    archivedQuote = await createQuote({ status: "SENT", sentAt: new Date(), archivedAt: new Date() });

    // A genuine second Client within org A — fixtures.clientB belongs to
    // org B (the cross-org fixture), not a same-org sibling of clientA,
    // so item 8 ("other Client same org") needs its own real Client.
    otherClientSameOrg = await prisma.client.create({
      data: { name: `PQV Other Client ${suffix}`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    otherClientQuote = await createQuote({ status: "SENT", sentAt: new Date(), clientId: otherClientSameOrg.id });

    const lead = await prisma.lead.create({ data: { name: `PQV Lead ${suffix}`, organizationId: fixtures.orgA.id } });
    leadOnlyQuote = await createQuote({ status: "SENT", sentAt: new Date(), clientId: null, leadId: lead.id });
    leadId = lead.id;

    const foreignQuote = await prisma.quote.create({
      data: {
        number: `PQV-${suffix}-FOREIGN`,
        status: "SENT",
        sentAt: new Date(),
        subtotal: "1.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        total: "1.00",
        organizationId: fixtures.orgB.id,
        createdByUserId: fixtures.orgBOwner.id,
        clientId: fixtures.clientB.id,
      },
    });
    otherOrgQuote = foreignQuote;
    quoteIds.push(foreignQuote.id);
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { id: convertedInvoiceId } });
    await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
    await prisma.lead.deleteMany({ where: { id: leadId } });
    await prisma.client.deleteMany({ where: { id: otherClientSameOrg.id } });
    await cleanupTestData(fixtures);
  });

  describe("getPortalQuotes (list)", () => {
    it("1/2/3/4/5. sees own SENT, APPROVED, DECLINED, EXPIRED (derived), and CONVERTED quotes", async () => {
      const results = await getPortalQuotes(fixtures.clientA.id, fixtures.orgA.id);
      const ids = results.map((r) => r.id);
      expect(ids).toContain(sentQuote.id);
      expect(ids).toContain(approvedQuote.id);
      expect(ids).toContain(declinedQuote.id);
      expect(ids).toContain(expiredQuote.id);
      expect(ids).toContain(convertedQuote.id);
    });

    it("6. DRAFT is excluded", async () => {
      const results = await getPortalQuotes(fixtures.clientA.id, fixtures.orgA.id);
      expect(results.map((r) => r.id)).not.toContain(draftQuote.id);
    });

    it("7. archived is excluded", async () => {
      const results = await getPortalQuotes(fixtures.clientA.id, fixtures.orgA.id);
      expect(results.map((r) => r.id)).not.toContain(archivedQuote.id);
    });

    it("8. another Client in the same org is excluded", async () => {
      const results = await getPortalQuotes(fixtures.clientA.id, fixtures.orgA.id);
      expect(results.map((r) => r.id)).not.toContain(otherClientQuote.id);
    });

    it("9. another organization is excluded", async () => {
      const results = await getPortalQuotes(fixtures.clientA.id, fixtures.orgA.id);
      expect(results.map((r) => r.id)).not.toContain(otherOrgQuote.id);
    });

    it("10. a Lead-only Quote (clientId null) is excluded", async () => {
      const results = await getPortalQuotes(fixtures.clientA.id, fixtures.orgA.id);
      expect(results.map((r) => r.id)).not.toContain(leadOnlyQuote.id);
    });
  });

  describe("getPortalQuote (detail)", () => {
    it("11. own SENT quote opens, with its line items", async () => {
      const result = await getPortalQuote(fixtures.clientA.id, fixtures.orgA.id, sentQuote.id);
      expect(result).not.toBeNull();
      expect(result?.items).toHaveLength(1);
    });

    it("12. a foreign Client's Quote (same org) is not found — generic denial", async () => {
      const result = await getPortalQuote(fixtures.clientA.id, fixtures.orgA.id, otherClientQuote.id);
      expect(result).toBeNull();
    });

    it("13. a foreign org's Quote is not found — generic denial", async () => {
      const result = await getPortalQuote(fixtures.clientA.id, fixtures.orgA.id, otherOrgQuote.id);
      expect(result).toBeNull();
    });

    it("14. a DRAFT Quote's direct id is not found — blocked, indistinguishable from nonexistent", async () => {
      const result = await getPortalQuote(fixtures.clientA.id, fixtures.orgA.id, draftQuote.id);
      expect(result).toBeNull();
    });

    it("15. an archived Quote's direct id is not found — matches the list's own hidden-by-default policy", async () => {
      const result = await getPortalQuote(fixtures.clientA.id, fixtures.orgA.id, archivedQuote.id);
      expect(result).toBeNull();
    });

    it("a Lead-only Quote's direct id is not found", async () => {
      const result = await getPortalQuote(fixtures.clientA.id, fixtures.orgA.id, leadOnlyQuote.id);
      expect(result).toBeNull();
    });

    it("39/40/41. a converted quote's detail includes a same-client convertedInvoice for the Portal Invoice link", async () => {
      const result = await getPortalQuote(fixtures.clientA.id, fixtures.orgA.id, convertedQuote.id);
      expect(result).not.toBeNull();
      expect(result?.convertedInvoiceId).toBe(convertedInvoiceId);
      expect(result?.convertedInvoice).toEqual({ id: convertedInvoiceId, invoiceNumber: `PQV-INV-${suffix}` });
    });

    it("§K — if the converted Invoice's own clientId later diverges from this Quote's Client, convertedInvoice is withheld (no unsafe link) even though the Quote itself still shows Converted", async () => {
      await prisma.invoice.update({ where: { id: convertedInvoiceId }, data: { clientId: fixtures.clientB.id } });
      try {
        const result = await getPortalQuote(fixtures.clientA.id, fixtures.orgA.id, convertedQuote.id);
        expect(result).not.toBeNull();
        expect(result?.convertedInvoiceId).toBe(convertedInvoiceId); // still "converted" for status derivation
        expect(result?.convertedInvoice).toBeNull(); // but no longer safe to link to
      } finally {
        await prisma.invoice.update({ where: { id: convertedInvoiceId }, data: { clientId: fixtures.clientA.id } });
      }
    });
  });
});
