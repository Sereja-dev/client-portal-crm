import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getDashboardAnalytics } from "@/app/(dashboard)/dashboard/query";
import { testEmail, testSlug } from "../../support/run-id";

/**
 * Dashboard Multi-Currency KPI Defect fix. Proves the defect is closed:
 * outstandingAmount/paidRevenue/the revenue-over-time buckets are scoped
 * to exactly one resolved currency (the same canonical, no-explicit-
 * request resolution Reports V1 already established — resolveReportsCurrency,
 * src/lib/reports/currency.ts), never blended across an organization's own
 * multiple invoice currencies (Invoice.currency is a genuine per-invoice
 * field, never organization-locked — see currency.ts's own header
 * comment). Each scenario uses a fresh, isolated organization (never the
 * shared fixtures.orgA) so no other parallel test's own invoice
 * currencies can ever influence these assertions — mirrors
 * test/integration/onboarding/visible-progress.test.ts's own established
 * "direct Prisma rows for a standalone org" technique.
 */
describe("getDashboardAnalytics — currency isolation (Dashboard Multi-Currency KPI Defect fix)", () => {
  type OrgContext = { ownerId: string; organization: { id: string }; client: { id: string } };

  async function makeOrg(label: string): Promise<OrgContext> {
    const ownerId = randomUUID();
    await prisma.user.create({
      data: { id: ownerId, email: testEmail(label, "test.local"), name: `${label} Owner` },
    });
    const organization = await prisma.organization.create({
      data: { name: `${label} Org`, slug: testSlug(label) },
    });
    await prisma.membership.create({ data: { userId: ownerId, organizationId: organization.id, role: "OWNER" } });
    const client = await prisma.client.create({
      data: { organizationId: organization.id, userId: ownerId, name: `${label} Client`, status: "ACTIVE" },
    });
    return { ownerId, organization, client };
  }

  async function cleanupOrg(ctx: OrgContext): Promise<void> {
    await prisma.invoice.deleteMany({ where: { organizationId: ctx.organization.id } });
    await prisma.client.deleteMany({ where: { organizationId: ctx.organization.id } });
    await prisma.membership.deleteMany({ where: { organizationId: ctx.organization.id } });
    await prisma.organization.deleteMany({ where: { id: ctx.organization.id } });
    await prisma.user.deleteMany({ where: { id: ctx.ownerId } });
  }

  describe("a mixed USD + AED organization", () => {
    let ctx: OrgContext;
    const now = new Date();

    beforeAll(async () => {
      ctx = await makeOrg("curr-mixed");
      const { organization, client } = ctx;

      // Outstanding (unpaid) invoices: one USD, one AED. No FX conversion
      // anywhere in this fixture or in the code under test — the two
      // amounts are deliberately chosen so a wrongly-blended sum (600)
      // is trivially distinguishable from the correct, currency-scoped
      // one (100).
      await prisma.invoice.create({
        data: {
          organizationId: organization.id,
          clientId: client.id,
          invoiceNumber: "USD-SENT-1",
          status: "SENT",
          amount: "100.00",
          currency: "USD",
          issueDate: now,
        },
      });
      await prisma.invoice.create({
        data: {
          organizationId: organization.id,
          clientId: client.id,
          invoiceNumber: "AED-SENT-1",
          status: "SENT",
          amount: "500.00",
          currency: "AED",
          issueDate: now,
        },
      });

      // Paid invoices, both with `paidAt` inside the default 30d period:
      // one USD, one AED.
      await prisma.invoice.create({
        data: {
          organizationId: organization.id,
          clientId: client.id,
          invoiceNumber: "USD-PAID-1",
          status: "PAID",
          amount: "200.00",
          currency: "USD",
          issueDate: now,
          paidAt: now,
        },
      });
      await prisma.invoice.create({
        data: {
          organizationId: organization.id,
          clientId: client.id,
          invoiceNumber: "AED-PAID-1",
          status: "PAID",
          amount: "300.00",
          currency: "AED",
          issueDate: now,
          paidAt: now,
        },
      });
    });

    afterAll(async () => cleanupOrg(ctx));

    it("resolves the organization's own canonical default (USD — no OrganizationProfile, so resolveInvoiceCurrencyDefault's own USD fallback, which IS present among this org's invoices) as the one Dashboard currency", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now });
      expect(analytics.currency).toBe("USD");
    });

    it("1. outstandingAmount includes only the resolved currency's SENT invoice (100), never the AED one (500)", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now });
      expect(analytics.kpis.outstandingAmount).toBe(100);
    });

    it("2. paidRevenue includes only the resolved currency's PAID invoice in the current period (200), never the AED one (300)", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now });
      expect(analytics.kpis.paidRevenue).toBe(200);
    });

    it("3. revenue buckets/trend total matches the resolved-currency-only sum (200), never a blended 500", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now });
      expect(analytics.revenue.total).toBe(200);
      const bucketSum = analytics.revenue.buckets.reduce((sum, bucket) => sum + bucket.amount, 0);
      expect(bucketSum).toBe(200);
    });

    it("4. the AED invoices never affect either aggregate — the blended values (600, 500) are never produced", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now });
      expect(analytics.kpis.outstandingAmount).not.toBe(600);
      expect(analytics.kpis.paidRevenue).not.toBe(500);
    });

    it("5. the returned currency matches the scoped sums, and non-aggregated per-row data stays multi-currency-capable", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now });
      expect(analytics.currency).toBe("USD");
      // §6 (locked spec) — recentInvoices/overdueItems are deliberately
      // NOT currency-filtered: both currencies' rows remain present, each
      // correctly carrying its own currency for its own per-row format.
      const recentCurrencies = new Set(analytics.recentInvoices.map((invoice) => invoice.currency));
      expect(recentCurrencies.has("USD")).toBe(true);
      expect(recentCurrencies.has("AED")).toBe(true);
    });
  });

  describe("a single-currency (USD-only) organization — existing behavior unchanged", () => {
    let ctx: OrgContext;
    const now = new Date();

    beforeAll(async () => {
      ctx = await makeOrg("curr-single");
      const { organization, client } = ctx;
      await prisma.invoice.create({
        data: {
          organizationId: organization.id,
          clientId: client.id,
          invoiceNumber: "USD-ONLY-SENT",
          status: "SENT",
          amount: "150.00",
          currency: "USD",
          issueDate: now,
        },
      });
      await prisma.invoice.create({
        data: {
          organizationId: organization.id,
          clientId: client.id,
          invoiceNumber: "USD-ONLY-PAID",
          status: "PAID",
          amount: "75.00",
          currency: "USD",
          issueDate: now,
          paidAt: now,
        },
      });
    });

    afterAll(async () => cleanupOrg(ctx));

    it("6. a single-currency organization resolves that one currency and produces the exact same sums it always did", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now });
      expect(analytics.currency).toBe("USD");
      expect(analytics.kpis.outstandingAmount).toBe(150);
      expect(analytics.kpis.paidRevenue).toBe(75);
    });
  });
});
