import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildQuoteWhere, buildQuoteOrderBy, parseQuoteListParams } from "@/app/(dashboard)/quotes/query";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Aqenra Quotes Phase 3 (Staff UI) §C/§T LIST — buildQuoteWhere/
 * buildQuoteOrderBy/parseQuoteListParams, the query layer the /quotes
 * list page itself calls. Covers org scoping, search, the four stored
 * statuses plus the two derived pseudo-filters (EXPIRED/CONVERTED),
 * target-type, and archived.
 */
describe("Quotes list query (§C/§T)", () => {
  let fixtures: TestFixtures;
  const quoteIds: string[] = [];
  let draftQuote: { id: string; number: string };
  let sentQuote: { id: string };
  let expiredQuote: { id: string };
  let approvedQuote: { id: string };
  let declinedQuote: { id: string };
  let convertedQuote: { id: string };
  let convertedInvoiceId: string;
  let leadOnlyQuote: { id: string };
  let clientOnlyQuote: { id: string };
  let archivedQuote: { id: string };
  let foreignOrgQuote: { id: string };

  const suffix = randomUUID().slice(0, 8);

  async function createQuote(overrides: Record<string, unknown>) {
    const quote = await prisma.quote.create({
      data: {
        number: `QLQ-${suffix}-${randomUUID().slice(0, 6)}`,
        status: "DRAFT",
        subtotal: "100.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        total: "100.00",
        organizationId: fixtures.orgA.id,
        createdByUserId: fixtures.owner.id,
        clientId: fixtures.clientA.id,
        ...overrides,
      },
    });
    quoteIds.push(quote.id);
    return quote;
  }

  beforeAll(async () => {
    fixtures = await seedTestData();

    draftQuote = await createQuote({ number: `QLQ-${suffix}-DRAFT`, title: "Findable Title" });
    sentQuote = await createQuote({ status: "SENT", sentAt: new Date(), validUntil: new Date(Date.now() + 86_400_000) });
    expiredQuote = await createQuote({ status: "SENT", sentAt: new Date(), validUntil: new Date("2020-01-01") });
    approvedQuote = await createQuote({ status: "APPROVED", approvedAt: new Date() });
    declinedQuote = await createQuote({ status: "DECLINED", declinedAt: new Date() });

    const forConversion = await createQuote({ status: "APPROVED", approvedAt: new Date() });
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `QLQ-INV-${suffix}`,
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
    convertedQuote = await prisma.quote.update({
      where: { id: forConversion.id },
      data: { convertedInvoiceId: invoice.id },
    });

    const lead = await prisma.lead.create({
      data: { name: `QLQ Lead ${suffix}`, organizationId: fixtures.orgA.id },
    });
    leadOnlyQuote = await createQuote({ clientId: null, leadId: lead.id });
    clientOnlyQuote = await createQuote({ clientId: fixtures.clientA.id });
    archivedQuote = await createQuote({ archivedAt: new Date() });

    foreignOrgQuote = await prisma.quote.create({
      data: {
        number: `QLQ-${suffix}-FOREIGN`,
        status: "DRAFT",
        subtotal: "1.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        total: "1.00",
        organizationId: fixtures.orgB.id,
        createdByUserId: fixtures.orgBOwner.id,
        clientId: fixtures.clientB.id,
      },
    });
    quoteIds.push(foreignOrgQuote.id);
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { id: convertedInvoiceId } });
    await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
    await prisma.lead.deleteMany({ where: { name: { startsWith: "QLQ Lead" } } });
    await cleanupTestData(fixtures);
  });

  async function idsFor(paramsInput: Record<string, string | undefined> = {}) {
    const params = parseQuoteListParams(paramsInput);
    const where = buildQuoteWhere(fixtures.orgA.id, params);
    const orderBy = buildQuoteOrderBy(params);
    const rows = await prisma.quote.findMany({ where, orderBy, select: { id: true } });
    return rows.map((r) => r.id);
  }

  it("2. org scoping — org A's own query never includes org B's quote", async () => {
    const ids = await idsFor();
    expect(ids).toContain(draftQuote.id);
    expect(ids).not.toContain(foreignOrgQuote.id);
  });

  it("search matches by quote number, title, and client name", async () => {
    expect(await idsFor({ q: draftQuote.number })).toEqual([draftQuote.id]);
    expect(await idsFor({ q: "Findable Title" })).toContain(draftQuote.id);
    expect(await idsFor({ q: fixtures.clientA.name })).toEqual(expect.arrayContaining([draftQuote.id, clientOnlyQuote.id]));
  });

  it("status filter — the four stored values each match only their own quote", async () => {
    expect(await idsFor({ status: "DRAFT" })).toEqual(expect.arrayContaining([draftQuote.id]));
    expect(await idsFor({ status: "SENT" })).toEqual(expect.arrayContaining([sentQuote.id]));
    expect(await idsFor({ status: "APPROVED" })).toEqual(expect.arrayContaining([approvedQuote.id, convertedQuote.id]));
    expect(await idsFor({ status: "DECLINED" })).toEqual(expect.arrayContaining([declinedQuote.id]));
  });

  it("9a. status filter EXPIRED matches only the derived-expired SENT quote, never a still-open SENT one", async () => {
    const ids = await idsFor({ status: "EXPIRED" });
    expect(ids).toContain(expiredQuote.id);
    expect(ids).not.toContain(sentQuote.id);
  });

  it("9b. status filter CONVERTED matches only the quote with convertedInvoiceId set", async () => {
    const ids = await idsFor({ status: "CONVERTED" });
    expect(ids).toEqual(expect.arrayContaining([convertedQuote.id]));
    expect(ids).not.toContain(approvedQuote.id);
  });

  it("targetType filter — LEAD matches only clientId-null quotes, CLIENT matches only clientId-set quotes", async () => {
    const leadIds = await idsFor({ targetType: "LEAD" });
    expect(leadIds).toContain(leadOnlyQuote.id);
    expect(leadIds).not.toContain(clientOnlyQuote.id);

    const clientIds = await idsFor({ targetType: "CLIENT" });
    expect(clientIds).toContain(clientOnlyQuote.id);
    expect(clientIds).not.toContain(leadOnlyQuote.id);
  });

  it("archived filter — default (archived unset) excludes archived quotes; archived=1 shows only archived ones", async () => {
    const activeIds = await idsFor();
    expect(activeIds).not.toContain(archivedQuote.id);
    expect(activeIds).toContain(draftQuote.id);

    const archivedIds = await idsFor({ archived: "1" });
    expect(archivedIds).toEqual(expect.arrayContaining([archivedQuote.id]));
    expect(archivedIds).not.toContain(draftQuote.id);
  });
});
