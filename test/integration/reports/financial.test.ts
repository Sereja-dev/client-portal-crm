import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getPaidInvoiceRows, summarizePaidRevenue, getOutstandingNow, getTopClientsByPaidRevenue } from "@/lib/reports/queries/financial";
import { bucketReportsRevenue } from "@/lib/reports/calculations/revenue-trend";
import { getReportsPeriodRange } from "@/lib/reports/period";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { createExtraClient, createExtraInvoice, cleanupExtraReportsData } from "./helpers";

const NOW = new Date("2026-06-15T12:00:00.000Z");

describe("Reports financial queries", () => {
  let fixtures: TestFixtures;
  let invoiceIds: string[];
  let clientIds: string[];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupExtraReportsData({ invoiceIds, clientIds });
    invoiceIds = [];
    clientIds = [];
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  describe("getPaidInvoiceRows / summarizePaidRevenue -- Paid revenue", () => {
    it("uses paidAt, not createdAt or issueDate -- an invoice created in range but paid outside range does not count", async () => {
      const range = getReportsPeriodRange("this_month", NOW); // 2026-06-01T00:00Z .. 2026-07-01T00:00Z
      const invoice = await createExtraInvoice({
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        amount: "100.00",
        currency: "USD",
        status: "PAID",
        createdAt: new Date("2026-06-10T00:00:00.000Z"), // inside range
        paidAt: new Date("2026-07-05T00:00:00.000Z"), // outside range
      });
      invoiceIds = [invoice.id];

      const rows = await getPaidInvoiceRows(fixtures.orgA.id, "USD", range);
      expect(rows).toHaveLength(0);
      expect(summarizePaidRevenue(rows).paidRevenue).toBe(0);
    });

    it("an invoice created outside range but paid inside range DOES count", async () => {
      const range = getReportsPeriodRange("this_month", NOW);
      const invoice = await createExtraInvoice({
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        amount: "150.00",
        currency: "USD",
        status: "PAID",
        createdAt: new Date("2026-01-01T00:00:00.000Z"), // long before range
        paidAt: new Date("2026-06-20T00:00:00.000Z"), // inside range
      });
      invoiceIds = [invoice.id];

      const rows = await getPaidInvoiceRows(fixtures.orgA.id, "USD", range);
      expect(rows).toHaveLength(1);
      expect(summarizePaidRevenue(rows).paidRevenue).toBe(150);
    });

    it.each(["SENT", "DRAFT", "OVERDUE", "CANCELLED"] as const)("a %s invoice, even with a paidAt in range, is never counted (only real PAID rows are)", async (status) => {
      const range = getReportsPeriodRange("this_month", NOW);
      // paidAt is set here purely to prove the STATUS filter, not paidAt,
      // is what excludes these -- a real app would never actually set
      // paidAt on a non-PAID invoice, but the query must not silently
      // trust paidAt alone either way.
      const invoice = await createExtraInvoice({
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        amount: "999.00",
        currency: "USD",
        status,
        paidAt: new Date("2026-06-10T00:00:00.000Z"),
      });
      invoiceIds = [invoice.id];

      const rows = await getPaidInvoiceRows(fixtures.orgA.id, "USD", range);
      expect(rows).toHaveLength(0);
    });

    it("USD and EUR invoices never blend into one total", async () => {
      const range = getReportsPeriodRange("this_month", NOW);
      const usd = await createExtraInvoice({
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        amount: "100.00",
        currency: "USD",
        status: "PAID",
        paidAt: new Date("2026-06-10T00:00:00.000Z"),
      });
      const eur = await createExtraInvoice({
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        amount: "50.00",
        currency: "EUR",
        status: "PAID",
        paidAt: new Date("2026-06-11T00:00:00.000Z"),
      });
      invoiceIds = [usd.id, eur.id];

      const usdRows = await getPaidInvoiceRows(fixtures.orgA.id, "USD", range);
      expect(summarizePaidRevenue(usdRows).paidRevenue).toBe(100);

      const eurRows = await getPaidInvoiceRows(fixtures.orgA.id, "EUR", range);
      expect(summarizePaidRevenue(eurRows).paidRevenue).toBe(50);
    });

    it("Decimal totals remain exact to the cent across multiple rows -- exact, not merely close", async () => {
      const range = getReportsPeriodRange("this_month", NOW);
      const a = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "10.10", currency: "USD", status: "PAID", paidAt: new Date("2026-06-01T00:00:00.000Z") });
      const b = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "0.20", currency: "USD", status: "PAID", paidAt: new Date("2026-06-02T00:00:00.000Z") });
      const c = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "5.05", currency: "USD", status: "PAID", paidAt: new Date("2026-06-03T00:00:00.000Z") });
      invoiceIds = [a.id, b.id, c.id];

      const rows = await getPaidInvoiceRows(fixtures.orgA.id, "USD", range);
      expect(summarizePaidRevenue(rows).paidRevenue).toBe(15.35);
    });

    it("cent-exact against real, DB-round-tripped Decimal rows: 0.10 + 0.20 is exactly 0.3, not 0.30000000000000004", async () => {
      const range = getReportsPeriodRange("this_month", NOW);
      const a = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "0.10", currency: "USD", status: "PAID", paidAt: new Date("2026-06-01T00:00:00.000Z") });
      const b = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "0.20", currency: "USD", status: "PAID", paidAt: new Date("2026-06-02T00:00:00.000Z") });
      invoiceIds = [a.id, b.id];

      const rows = await getPaidInvoiceRows(fixtures.orgA.id, "USD", range);
      expect(summarizePaidRevenue(rows).paidRevenue).toBe(0.3);
    });

    it("sum(revenueTrend buckets) exactly equals paidRevenue at cent precision, for the same currency/range", async () => {
      const range = getReportsPeriodRange("this_month", NOW);
      const a = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "10.01", currency: "USD", status: "PAID", paidAt: new Date("2026-06-01T00:00:00.000Z") });
      const b = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "20.02", currency: "USD", status: "PAID", paidAt: new Date("2026-06-05T00:00:00.000Z") });
      const c = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "30.03", currency: "USD", status: "PAID", paidAt: new Date("2026-06-10T00:00:00.000Z") });
      invoiceIds = [a.id, b.id, c.id];

      const rows = await getPaidInvoiceRows(fixtures.orgA.id, "USD", range);
      const { paidRevenue } = summarizePaidRevenue(rows);
      const trend = bucketReportsRevenue(rows, range);

      const trendTotalCents = trend.points.reduce((sum, p) => sum + Math.round(p.amount * 100), 0);
      const paidRevenueCents = Math.round(paidRevenue * 100);
      expect(trendTotalCents).toBe(paidRevenueCents);
      expect(paidRevenue).toBe(60.06);
    });

    it("never leaks a foreign tenant's PAID invoice into this organization's total", async () => {
      const range = getReportsPeriodRange("this_month", NOW);
      const foreign = await createExtraInvoice({
        organizationId: fixtures.orgB.id,
        clientId: fixtures.clientB.id,
        amount: "5000.00",
        currency: "USD",
        status: "PAID",
        paidAt: new Date("2026-06-10T00:00:00.000Z"),
      });
      invoiceIds = [foreign.id];

      const rows = await getPaidInvoiceRows(fixtures.orgA.id, "USD", range);
      expect(rows.find((r) => Number(r.amount) === 5000)).toBeUndefined();
    });
  });

  describe("getOutstandingNow -- current snapshot", () => {
    it("includes exactly DRAFT + SENT + OVERDUE, never PAID or CANCELLED", async () => {
      const draft = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "10.00", currency: "USD", status: "DRAFT" });
      const sent = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "20.00", currency: "USD", status: "SENT" });
      const overdue = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "30.00", currency: "USD", status: "OVERDUE" });
      const paid = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "9999.00", currency: "USD", status: "PAID", paidAt: new Date() });
      const cancelled = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "9999.00", currency: "USD", status: "CANCELLED" });
      invoiceIds = [draft.id, sent.id, overdue.id, paid.id, cancelled.id];

      // The shared fixture's own DRAFT invoice (500.00 USD, clientA) is
      // also present under org A -- included deliberately, not
      // subtracted around, since it genuinely IS an outstanding DRAFT.
      const outstanding = await getOutstandingNow(fixtures.orgA.id, "USD");
      expect(outstanding).toBe(10 + 20 + 30 + 500);
    });

    it("cent-exact: 0.10 + 0.20 across two outstanding invoices is exactly 0.3 -- DB-side SUM, converted once, was already exact and stays that way", async () => {
      const a = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "0.10", currency: "EUR", status: "SENT" });
      const b = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "0.20", currency: "EUR", status: "DRAFT" });
      invoiceIds = [a.id, b.id];

      const outstanding = await getOutstandingNow(fixtures.orgA.id, "EUR");
      expect(outstanding).toBe(0.3);
    });

    it("is NOT period-scoped -- an old outstanding invoice from long ago still counts, regardless of any date range", async () => {
      const old = await createExtraInvoice({
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        amount: "42.00",
        currency: "USD",
        status: "SENT",
        createdAt: new Date("2020-01-01T00:00:00.000Z"),
        issueDate: new Date("2020-01-01T00:00:00.000Z"),
      });
      invoiceIds = [old.id];

      const outstanding = await getOutstandingNow(fixtures.orgA.id, "USD");
      expect(outstanding).toBeGreaterThanOrEqual(42 + 500); // + the fixture's own 500 DRAFT invoice
    });

    it("never blends currencies", async () => {
      const usd = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "10.00", currency: "USD", status: "SENT" });
      const eur = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "999.00", currency: "EUR", status: "SENT" });
      invoiceIds = [usd.id, eur.id];

      const eurOutstanding = await getOutstandingNow(fixtures.orgA.id, "EUR");
      expect(eurOutstanding).toBe(999);
    });

    it("never leaks a foreign tenant's outstanding invoice", async () => {
      const foreign = await createExtraInvoice({ organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, amount: "7777.00", currency: "USD", status: "SENT" });
      invoiceIds = [foreign.id];

      const outstanding = await getOutstandingNow(fixtures.orgA.id, "USD");
      expect(outstanding).toBeLessThan(7777);
    });
  });

  describe("getTopClientsByPaidRevenue", () => {
    it("ranks Clients by paid revenue, descending, scoped to org/period/currency", async () => {
      const clientHigh = await createExtraClient(fixtures.orgA.id, fixtures.owner.id, "Reports Top Client High");
      const clientLow = await createExtraClient(fixtures.orgA.id, fixtures.owner.id, "Reports Top Client Low");
      clientIds = [clientHigh.id, clientLow.id];

      const range = getReportsPeriodRange("this_month", NOW);
      const invHigh = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: clientHigh.id, amount: "300.00", currency: "USD", status: "PAID", paidAt: new Date("2026-06-05T00:00:00.000Z") });
      const invLow = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: clientLow.id, amount: "100.00", currency: "USD", status: "PAID", paidAt: new Date("2026-06-06T00:00:00.000Z") });
      invoiceIds = [invHigh.id, invLow.id];

      const top = await getTopClientsByPaidRevenue(fixtures.orgA.id, "USD", range);
      const high = top.find((c) => c.clientId === clientHigh.id);
      const low = top.find((c) => c.clientId === clientLow.id);
      expect(high?.paidAmount).toBe(300);
      expect(low?.paidAmount).toBe(100);
      expect(top.indexOf(high!)).toBeLessThan(top.indexOf(low!));
    });

    it("returns at most 5 Clients", async () => {
      const range = getReportsPeriodRange("this_month", NOW);
      const created: string[] = [];
      const invs: string[] = [];
      for (let i = 0; i < 7; i++) {
        const c = await createExtraClient(fixtures.orgA.id, fixtures.owner.id, `Reports Rank Client ${i}`);
        created.push(c.id);
        const inv = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: c.id, amount: `${(i + 1) * 10}.00`, currency: "USD", status: "PAID", paidAt: new Date("2026-06-05T00:00:00.000Z") });
        invs.push(inv.id);
      }
      clientIds = created;
      invoiceIds = invs;

      const top = await getTopClientsByPaidRevenue(fixtures.orgA.id, "USD", range);
      expect(top.length).toBeLessThanOrEqual(5);
    });

    it("aggregates multiple PAID invoices for the same Client, and reports the paid invoice count", async () => {
      const client = await createExtraClient(fixtures.orgA.id, fixtures.owner.id, "Reports Multi-Invoice Client");
      clientIds = [client.id];
      const range = getReportsPeriodRange("this_month", NOW);
      const i1 = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: client.id, amount: "40.00", currency: "USD", status: "PAID", paidAt: new Date("2026-06-02T00:00:00.000Z") });
      const i2 = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: client.id, amount: "60.00", currency: "USD", status: "PAID", paidAt: new Date("2026-06-03T00:00:00.000Z") });
      invoiceIds = [i1.id, i2.id];

      const top = await getTopClientsByPaidRevenue(fixtures.orgA.id, "USD", range);
      const row = top.find((c) => c.clientId === client.id)!;
      expect(row.paidAmount).toBe(100);
      expect(row.paidInvoiceCount).toBe(2);
    });

    it("cent-exact: two PAID invoices of 0.10 and 0.20 for the same Client rank at exactly 0.3, not 0.30000000000000004", async () => {
      const client = await createExtraClient(fixtures.orgA.id, fixtures.owner.id, "Reports Cent-Exact Rank Client");
      clientIds = [client.id];
      const range = getReportsPeriodRange("this_month", NOW);
      const i1 = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: client.id, amount: "0.10", currency: "USD", status: "PAID", paidAt: new Date("2026-06-02T00:00:00.000Z") });
      const i2 = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: client.id, amount: "0.20", currency: "USD", status: "PAID", paidAt: new Date("2026-06-03T00:00:00.000Z") });
      invoiceIds = [i1.id, i2.id];

      const top = await getTopClientsByPaidRevenue(fixtures.orgA.id, "USD", range);
      const row = top.find((c) => c.clientId === client.id)!;
      expect(row.paidAmount).toBe(0.3);
    });

    it("never blends currencies into the ranking", async () => {
      const client = await createExtraClient(fixtures.orgA.id, fixtures.owner.id, "Reports Currency Rank Client");
      clientIds = [client.id];
      const range = getReportsPeriodRange("this_month", NOW);
      const usd = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: client.id, amount: "40.00", currency: "USD", status: "PAID", paidAt: new Date("2026-06-02T00:00:00.000Z") });
      const eur = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: client.id, amount: "9999.00", currency: "EUR", status: "PAID", paidAt: new Date("2026-06-02T00:00:00.000Z") });
      invoiceIds = [usd.id, eur.id];

      const top = await getTopClientsByPaidRevenue(fixtures.orgA.id, "USD", range);
      const row = top.find((c) => c.clientId === client.id)!;
      expect(row.paidAmount).toBe(40);
    });

    it("never ranks by outstanding or invoiced (non-PAID) amount", async () => {
      const client = await createExtraClient(fixtures.orgA.id, fixtures.owner.id, "Reports Unpaid Client");
      clientIds = [client.id];
      const range = getReportsPeriodRange("this_month", NOW);
      const sent = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: client.id, amount: "99999.00", currency: "USD", status: "SENT" });
      invoiceIds = [sent.id];

      const top = await getTopClientsByPaidRevenue(fixtures.orgA.id, "USD", range);
      expect(top.find((c) => c.clientId === client.id)).toBeUndefined();
    });

    it("never leaks a foreign tenant's Client into the ranking", async () => {
      const range = getReportsPeriodRange("this_month", NOW);
      const foreignInvoice = await createExtraInvoice({ organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, amount: "100000.00", currency: "USD", status: "PAID", paidAt: new Date("2026-06-05T00:00:00.000Z") });
      invoiceIds = [foreignInvoice.id];

      const top = await getTopClientsByPaidRevenue(fixtures.orgA.id, "USD", range);
      expect(top.find((c) => c.clientId === fixtures.clientB.id)).toBeUndefined();
    });
  });
});
