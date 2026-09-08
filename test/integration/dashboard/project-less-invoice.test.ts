import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getDashboardAnalytics } from "@/app/(dashboard)/dashboard/query";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Quotes / Estimates Phase 2.3 — the Dashboard's own invoice-derived KPIs
 * must include a project-less Invoice exactly like any other. Before
 * this phase, every one of these queries also required `project: {
 * organizationId }}`, which would have silently excluded these rows
 * entirely (a project-less Invoice has no Project relation to match).
 * §AB DASHBOARD items 31-35.
 */
describe("getDashboardAnalytics — project-less Invoice inclusion (Quotes / Estimates Phase 2.3)", () => {
  let fixtures: TestFixtures;
  let unpaidInvoice: { id: string };
  let paidInvoice: { id: string };
  let overdueInvoice: { id: string };

  beforeAll(async () => {
    fixtures = await seedTestData();
    const prefix = `P23-DASH-${randomUUID().slice(0, 8)}`;

    unpaidInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `${prefix}-UNPAID`,
        status: "SENT",
        amount: "321.00",
        subtotal: "321.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        projectId: null,
        organizationId: fixtures.orgA.id,
        issueDate: new Date(),
      },
    });
    paidInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `${prefix}-PAID`,
        status: "PAID",
        amount: "654.00",
        subtotal: "654.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        projectId: null,
        organizationId: fixtures.orgA.id,
        issueDate: new Date(),
        paidAt: new Date(),
      },
    });
    overdueInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `${prefix}-OVERDUE`,
        status: "OVERDUE",
        amount: "111.00",
        subtotal: "111.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        projectId: null,
        organizationId: fixtures.orgA.id,
        issueDate: new Date(),
        dueDate: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { id: { in: [unpaidInvoice.id, paidInvoice.id, overdueInvoice.id] } } });
    await cleanupTestData(fixtures);
  });

  it("31. outstanding/unpaid total includes a project-less SENT invoice", async () => {
    const analytics = await getDashboardAnalytics({ organizationId: fixtures.orgA.id, period: "30d", now: new Date() });
    expect(analytics.kpis.outstandingAmount).toBeGreaterThanOrEqual(321 + 111);
  });

  it("32. paid revenue includes a project-less PAID invoice", async () => {
    const analytics = await getDashboardAnalytics({ organizationId: fixtures.orgA.id, period: "30d", now: new Date() });
    expect(analytics.kpis.paidRevenue).toBeGreaterThanOrEqual(654);
  });

  it("33. invoice status breakdown counts every project-less status", async () => {
    const analytics = await getDashboardAnalytics({ organizationId: fixtures.orgA.id, period: "30d", now: new Date() });
    const byStatus = new Map(analytics.breakdowns.invoiceStatus.map((s) => [s.status, s.count]));
    expect(byStatus.get("SENT")).toBeGreaterThan(0);
    expect(byStatus.get("PAID")).toBeGreaterThan(0);
    expect(byStatus.get("OVERDUE")).toBeGreaterThan(0);
  });

  it("34. overdue list includes a project-less OVERDUE invoice, with clientName from Invoice.client directly", async () => {
    const analytics = await getDashboardAnalytics({ organizationId: fixtures.orgA.id, period: "30d", now: new Date() });
    const found = analytics.overdueItems.find((item) => item.kind === "invoice" && item.id === overdueInvoice.id);
    expect(found).toBeDefined();
    if (found && found.kind === "invoice") {
      expect(found.clientName).toBe(fixtures.clientA.name);
    }
  });

  it("35. recent invoices list includes a project-less invoice, with clientName from Invoice.client directly", async () => {
    const analytics = await getDashboardAnalytics({ organizationId: fixtures.orgA.id, period: "30d", now: new Date() });
    const found = analytics.recentInvoices.find((r) => r.id === unpaidInvoice.id || r.id === paidInvoice.id || r.id === overdueInvoice.id);
    expect(found).toBeDefined();
    expect(found?.clientName).toBe(fixtures.clientA.name);
  });

  /**
   * Aqenra Invoice UX — Client / Project Links §E. Dashboard "Recent
   * invoices" links each row's Client name to /clients/{clientId}/edit,
   * built directly from this same `recentInvoices[].clientId` field —
   * these two tests prove the id itself is present and correct (what the
   * link's href is actually built from), and that this still holds for a
   * project-less invoice (no Project is ever shown in this section, so
   * there is no separate Project-link case to prove safe here).
   */
  it("7. recent invoices list carries the correct clientId for its Client link target", async () => {
    const analytics = await getDashboardAnalytics({ organizationId: fixtures.orgA.id, period: "30d", now: new Date() });
    const found = analytics.recentInvoices.find((r) => r.id === unpaidInvoice.id || r.id === paidInvoice.id || r.id === overdueInvoice.id);
    expect(found).toBeDefined();
    expect(found?.clientId).toBe(fixtures.clientA.id);
  });

  it("8. the project-less case is safe: clientId is still correct even though this same invoice has no Project", async () => {
    const analytics = await getDashboardAnalytics({ organizationId: fixtures.orgA.id, period: "30d", now: new Date() });
    const found = analytics.recentInvoices.find((r) => r.id === unpaidInvoice.id);
    expect(found).toBeDefined();
    expect(found?.clientId).toBe(fixtures.clientA.id);
  });
});
