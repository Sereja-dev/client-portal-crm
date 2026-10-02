import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getFinanceOverview } from "@/app/(dashboard)/finance/query";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { createExtraInvoice, cleanupExtraReportsData } from "../reports/helpers";

/**
 * Finance Overview V1 (Sub-block A) — the query-boundary regression
 * suite for getFinanceOverview(). Deliberately exercises the real
 * exported function this app's /finance page actually calls, not only
 * the primitives it reuses (getOutstandingNow/getPaidInvoiceRows/
 * resolveReportsCurrency already have their own dedicated Reports
 * regression coverage — see test/integration/reports/financial.test.ts
 * and test/unit/reports-money.test.ts, both still run unchanged
 * elsewhere in this suite).
 */

const PREFIX = "FinanceOverview";
const NOW = new Date("2026-06-15T12:00:00.000Z"); // Inside the UTC window [2026-06-01T00:00Z, 2026-07-01T00:00Z).

function uniqueQuoteNumber(): string {
  return `${PREFIX}-Q-${randomUUID().slice(0, 8)}`;
}

async function createQuote(
  organizationId: string,
  clientId: string,
  createdByUserId: string,
  overrides: { status?: "DRAFT" | "SENT" | "APPROVED" | "DECLINED"; validUntil?: Date | null; archivedAt?: Date | null },
) {
  return prisma.quote.create({
    data: {
      number: uniqueQuoteNumber(),
      organizationId,
      clientId,
      subtotal: "100.00",
      total: "100.00",
      createdByUserId,
      status: overrides.status ?? "DRAFT",
      validUntil: overrides.validUntil ?? null,
      archivedAt: overrides.archivedAt ?? null,
    },
  });
}

describe("Finance Overview — getFinanceOverview", () => {
  let fixtures: TestFixtures;
  let invoiceIds: string[];
  let quoteIds: string[];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupExtraReportsData({ invoiceIds });
    if (quoteIds.length > 0) {
      await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
    }
    invoiceIds = [];
    quoteIds = [];
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  // A. Tenant isolation
  it("A. Org A's overview never includes Org B's invoices, quotes, or currencies", async () => {
    const orgBInvoice = await createExtraInvoice({
      organizationId: fixtures.orgB.id,
      clientId: fixtures.clientB.id,
      amount: "999.00",
      currency: "AED",
      status: "SENT",
    });
    const orgBQuote = await createQuote(fixtures.orgB.id, fixtures.clientB.id, fixtures.orgBOwner.id, { status: "SENT" });
    invoiceIds = [orgBInvoice.id];
    quoteIds = [orgBQuote.id];

    const overview = await getFinanceOverview(fixtures.orgA.id, undefined, NOW);

    expect(overview.currency.availableCurrencies).not.toContain("AED");
    // The shared fixture's own DRAFT invoice (500.00 USD, clientA — see
    // test/fixtures/seed.ts) is org A's own, not org B's — it is expected
    // here, same accounting convention test/integration/reports/
    // financial.test.ts's own getOutstandingNow tests already use.
    expect(overview.draftInvoiceCount).toBe(1);
    expect(overview.quotesAwaitingApprovalCount).toBe(0);
  });

  // B. Outstanding status semantics
  it("B. Outstanding includes only DRAFT/SENT/OVERDUE, never PAID/CANCELLED", async () => {
    const draft = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "10.00", currency: "USD", status: "DRAFT" });
    const sent = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "20.00", currency: "USD", status: "SENT" });
    const overdue = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "30.00", currency: "USD", status: "OVERDUE" });
    const paid = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "40.00", currency: "USD", status: "PAID", paidAt: NOW });
    const cancelled = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "50.00", currency: "USD", status: "CANCELLED" });
    invoiceIds = [draft.id, sent.id, overdue.id, paid.id, cancelled.id];

    const overview = await getFinanceOverview(fixtures.orgA.id, "USD", NOW);
    // + 500 for the shared fixture's own DRAFT invoice (500.00 USD) — see
    // the same accounting convention in reports/financial.test.ts.
    expect(overview.outstanding).toBe(60 + 500); // 10 + 20 + 30 + 500
  });

  // C. Currency isolation
  it("C. USD overview sums only USD invoices; AED overview sums only AED invoices — never blended", async () => {
    const usd = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "100.00", currency: "USD", status: "SENT" });
    const aed = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "200.00", currency: "AED", status: "SENT" });
    invoiceIds = [usd.id, aed.id];

    const usdOverview = await getFinanceOverview(fixtures.orgA.id, "USD", NOW);
    // + 500 for the shared fixture's own DRAFT invoice (500.00 USD).
    expect(usdOverview.outstanding).toBe(100 + 500);
    expect(usdOverview.currency.selectedCurrency).toBe("USD");

    const aedOverview = await getFinanceOverview(fixtures.orgA.id, "AED", NOW);
    expect(aedOverview.outstanding).toBe(200);
    expect(aedOverview.currency.selectedCurrency).toBe("AED");

    expect(usdOverview.currency.availableCurrencies).toEqual(["AED", "USD"]);
  });

  // D. Overdue semantics
  it("D. Overdue is operational: SENT/OVERDUE past due only, never DRAFT/PAID/CANCELLED or future-due", async () => {
    const sentPastDue = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "10.00", currency: "USD", status: "SENT" });
    const overduePastDue = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "20.00", currency: "USD", status: "OVERDUE" });
    const sentFutureDue = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "30.00", currency: "USD", status: "SENT" });
    const draftPastDue = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "40.00", currency: "USD", status: "DRAFT" });
    const paidPastDue = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "50.00", currency: "USD", status: "PAID", paidAt: NOW });
    const cancelledPastDue = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "60.00", currency: "USD", status: "CANCELLED" });
    invoiceIds = [sentPastDue.id, overduePastDue.id, sentFutureDue.id, draftPastDue.id, paidPastDue.id, cancelledPastDue.id];

    const pastDue = new Date("2026-06-01T00:00:00.000Z");
    const futureDue = new Date("2026-12-01T00:00:00.000Z");
    await prisma.invoice.update({ where: { id: sentPastDue.id }, data: { dueDate: pastDue } });
    await prisma.invoice.update({ where: { id: overduePastDue.id }, data: { dueDate: pastDue } });
    await prisma.invoice.update({ where: { id: sentFutureDue.id }, data: { dueDate: futureDue } });
    await prisma.invoice.update({ where: { id: draftPastDue.id }, data: { dueDate: pastDue } });
    await prisma.invoice.update({ where: { id: paidPastDue.id }, data: { dueDate: pastDue } });
    await prisma.invoice.update({ where: { id: cancelledPastDue.id }, data: { dueDate: pastDue } });

    const overview = await getFinanceOverview(fixtures.orgA.id, "USD", NOW);
    expect(overview.overdue).toBe(30); // 10 (sentPastDue) + 20 (overduePastDue)
  });

  // E. Paid this month
  it("E. Paid this month uses paidAt against UTC month boundaries: start inclusive, end exclusive", async () => {
    const atMonthStart = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "1.00", currency: "USD", status: "PAID", paidAt: new Date("2026-06-01T00:00:00.000Z") });
    const insideMonth = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "2.00", currency: "USD", status: "PAID", paidAt: new Date("2026-06-15T12:00:00.000Z") });
    const beforeMonthStart = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "4.00", currency: "USD", status: "PAID", paidAt: new Date("2026-05-31T23:59:59.999Z") });
    const atNextMonthBoundary = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "8.00", currency: "USD", status: "PAID", paidAt: new Date("2026-07-01T00:00:00.000Z") });
    const createdInsideMonthPaidOutside = await createExtraInvoice({
      organizationId: fixtures.orgA.id,
      clientId: fixtures.clientA.id,
      amount: "16.00",
      currency: "USD",
      status: "PAID",
      createdAt: new Date("2026-06-10T00:00:00.000Z"),
      paidAt: new Date("2026-07-10T00:00:00.000Z"),
    });
    invoiceIds = [atMonthStart.id, insideMonth.id, beforeMonthStart.id, atNextMonthBoundary.id, createdInsideMonthPaidOutside.id];

    const overview = await getFinanceOverview(fixtures.orgA.id, "USD", NOW);
    expect(overview.paidThisMonth).toBe(3); // 1 (atMonthStart) + 2 (insideMonth)
  });

  // F. Draft count
  it("F. Draft invoice count is organization-wide, independent of the selected currency", async () => {
    const draftUsd = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "10.00", currency: "USD", status: "DRAFT" });
    const draftAed = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "20.00", currency: "AED", status: "DRAFT" });
    invoiceIds = [draftUsd.id, draftAed.id];

    const usdOverview = await getFinanceOverview(fixtures.orgA.id, "USD", NOW);
    const aedOverview = await getFinanceOverview(fixtures.orgA.id, "AED", NOW);
    // + 1 for the shared fixture's own DRAFT invoice — the count is
    // identical regardless of which currency is selected, proving it is
    // genuinely organization-wide, not currency-scoped.
    expect(usdOverview.draftInvoiceCount).toBe(2 + 1);
    expect(aedOverview.draftInvoiceCount).toBe(2 + 1);
  });

  // G. Quotes awaiting approval
  it("G. Quotes awaiting approval: only current, non-expired, non-archived SENT quotes", async () => {
    const sentNoExpiry = await createQuote(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id, { status: "SENT", validUntil: null });
    const sentFutureValid = await createQuote(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id, {
      status: "SENT",
      validUntil: new Date("2026-12-01T00:00:00.000Z"),
    });
    const sentAtNonExpiredBoundary = await createQuote(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id, {
      status: "SENT",
      validUntil: NOW, // exactly `now` — isQuoteExpired requires strictly `<`, so this is not-yet-expired.
    });
    const sentExpired = await createQuote(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id, {
      status: "SENT",
      validUntil: new Date("2026-01-01T00:00:00.000Z"),
    });
    const draft = await createQuote(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id, { status: "DRAFT" });
    const approved = await createQuote(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id, { status: "APPROVED" });
    const declined = await createQuote(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id, { status: "DECLINED" });
    const archivedSent = await createQuote(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id, { status: "SENT", archivedAt: NOW });
    quoteIds = [
      sentNoExpiry.id,
      sentFutureValid.id,
      sentAtNonExpiredBoundary.id,
      sentExpired.id,
      draft.id,
      approved.id,
      declined.id,
      archivedSent.id,
    ];

    const overview = await getFinanceOverview(fixtures.orgA.id, undefined, NOW);
    expect(overview.quotesAwaitingApprovalCount).toBe(3); // sentNoExpiry, sentFutureValid, sentAtNonExpiredBoundary
  });

  // §21 — currency resolution regression at the Finance integration boundary
  // (the resolver itself, resolveReportsCurrency, already has its own full
  // test suite — this only proves getFinanceOverview wires it correctly).
  it("currency resolution: a valid requested currency is honored; an unavailable one falls back without leaking cross-org data", async () => {
    const usd = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "100.00", currency: "USD", status: "SENT" });
    invoiceIds = [usd.id];

    const valid = await getFinanceOverview(fixtures.orgA.id, "USD", NOW);
    expect(valid.currency.selectedCurrency).toBe("USD");

    // "EUR" is a real, globally-valid ISO code this organization has never
    // invoiced in — must never be selectable merely because Intl supports
    // it; must fall back to this org's own available/default currency.
    const invalid = await getFinanceOverview(fixtures.orgA.id, "EUR", NOW);
    expect(invalid.currency.selectedCurrency).not.toBe("EUR");
    expect(invalid.currency.availableCurrencies).not.toContain("EUR");
  });
});
