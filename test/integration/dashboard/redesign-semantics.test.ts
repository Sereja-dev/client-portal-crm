import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getDashboardAnalytics } from "@/app/(dashboard)/dashboard/query";
import { testEmail, testSlug } from "../../support/run-id";

/**
 * Dashboard Redesign — deterministic semantics coverage for the new KPI
 * row, Needs Attention, Today, and bounded Recent Activity, per the
 * locked spec's own §19 numbered list. Uses one fresh, isolated
 * organization (never the shared fixtures.orgA) with a fixed `now`
 * anchor, so every boundary assertion (today/yesterday/tomorrow, this
 * month/last month, DONE-exclusion) is fully reproducible regardless of
 * which real calendar day the suite happens to run on.
 */

const NOW = new Date("2026-06-15T12:00:00.000Z");
const TODAY_MORNING = new Date("2026-06-15T08:00:00.000Z");
const YESTERDAY = new Date("2026-06-14T12:00:00.000Z");
const TOMORROW = new Date("2026-06-16T12:00:00.000Z");
const LAST_MONTH = new Date("2026-05-20T12:00:00.000Z");

describe("getDashboardAnalytics — Dashboard Redesign semantics", () => {
  type OrgContext = { ownerId: string; organization: { id: string }; client: { id: string }; project: { id: string } };

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
    const project = await prisma.project.create({
      data: { organizationId: organization.id, clientId: client.id, ownerId, name: `${label} Project`, status: "IN_PROGRESS" },
    });
    return { ownerId, organization, client, project };
  }

  async function cleanupOrg(ctx: OrgContext): Promise<void> {
    await prisma.calendarEvent.deleteMany({ where: { organizationId: ctx.organization.id } });
    await prisma.contract.deleteMany({ where: { organizationId: ctx.organization.id } });
    await prisma.invoice.deleteMany({ where: { organizationId: ctx.organization.id } });
    await prisma.task.deleteMany({ where: { projectId: ctx.project.id } });
    await prisma.project.deleteMany({ where: { id: ctx.project.id } });
    await prisma.client.deleteMany({ where: { organizationId: ctx.organization.id } });
    await prisma.membership.deleteMany({ where: { organizationId: ctx.organization.id } });
    await prisma.organization.deleteMany({ where: { id: ctx.organization.id } });
    await prisma.user.deleteMany({ where: { id: ctx.ownerId } });
  }

  describe("KPIs", () => {
    let ctx: OrgContext;

    beforeAll(async () => {
      ctx = await makeOrg("redesign-kpis");
      const { organization, client, project, ownerId } = ctx;

      // A second client (for the Clients KPI count) and a second project
      // (PLANNING — must NOT count toward Active projects).
      await prisma.client.create({
        data: { organizationId: organization.id, userId: ownerId, name: "Second Client", status: "LEAD" },
      });
      await prisma.project.create({
        data: { organizationId: organization.id, clientId: client.id, ownerId, name: "Planning Project", status: "PLANNING" },
      });

      // Two open tasks (TODO/IN_PROGRESS), one DONE (must not count).
      await prisma.task.createMany({
        data: [
          { organizationId: organization.id, projectId: project.id, title: "Open A", status: "TODO", priority: "MEDIUM" },
          { organizationId: organization.id, projectId: project.id, title: "Open B", status: "IN_PROGRESS", priority: "MEDIUM" },
          { organizationId: organization.id, projectId: project.id, title: "Done A", status: "DONE", priority: "MEDIUM" },
        ],
      });

      // Paid this month (2 USD invoices), paid last month (excluded),
      // and an unpaid (DRAFT/SENT/OVERDUE) invoice for Outstanding.
      await prisma.invoice.create({
        data: { organizationId: organization.id, clientId: client.id, invoiceNumber: "KPI-PAID-THIS-1", status: "PAID", amount: "100.00", currency: "USD", issueDate: NOW, paidAt: NOW },
      });
      await prisma.invoice.create({
        data: { organizationId: organization.id, clientId: client.id, invoiceNumber: "KPI-PAID-THIS-2", status: "PAID", amount: "50.00", currency: "USD", issueDate: NOW, paidAt: TODAY_MORNING },
      });
      await prisma.invoice.create({
        data: { organizationId: organization.id, clientId: client.id, invoiceNumber: "KPI-PAID-LAST-MONTH", status: "PAID", amount: "9999.00", currency: "USD", issueDate: LAST_MONTH, paidAt: LAST_MONTH },
      });
      await prisma.invoice.create({
        data: { organizationId: organization.id, clientId: client.id, invoiceNumber: "KPI-PAID-EUR", status: "PAID", amount: "8888.00", currency: "EUR", issueDate: NOW, paidAt: NOW },
      });
      await prisma.invoice.create({
        data: { organizationId: organization.id, clientId: client.id, invoiceNumber: "KPI-OUTSTANDING-SENT", status: "SENT", amount: "300.00", currency: "USD", issueDate: NOW, dueDate: TOMORROW },
      });
    });

    afterAll(async () => cleanupOrg(ctx));

    it("1. Clients count includes every client in the organization", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      expect(analytics.kpis.totalClients).toBe(2);
    });

    it("2. Active projects counts only the IN_PROGRESS project, never PLANNING", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      expect(analytics.kpis.activeProjects).toBe(1);
    });

    it("3. Open tasks excludes DONE", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      expect(analytics.kpis.openTasks).toBe(2);
    });

    it("4. Outstanding amount remains single-currency scoped (USD only, never blended with EUR)", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      expect(analytics.currency).toBe("USD");
      expect(analytics.kpis.outstandingAmount).toBe(300);
      expect(analytics.kpis.outstandingCount).toBe(1);
    });

    it("5. Paid-this-month includes PAID this month, excludes PAID last month, excludes other currencies", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      // 100 + 50 (this month, USD) — never the 9999 (last month) or 8888 (EUR).
      expect(analytics.kpis.paidThisMonth).toBe(150);
    });
  });

  describe("Needs Attention", () => {
    let ctx: OrgContext;

    beforeAll(async () => {
      ctx = await makeOrg("redesign-needs-attention");
      const { organization, client, project, ownerId } = ctx;

      // 6. + 7. Overdue task = not DONE and dueDate < now; a DONE task
      // with the same past due date must be excluded.
      await prisma.task.create({
        data: { organizationId: organization.id, projectId: project.id, title: "Overdue Not Done", status: "TODO", priority: "MEDIUM", dueDate: YESTERDAY },
      });
      await prisma.task.create({
        data: { organizationId: organization.id, projectId: project.id, title: "Overdue But Done", status: "DONE", priority: "MEDIUM", dueDate: YESTERDAY, completedAt: NOW },
      });

      // 8. SENT past-due invoice included. 9. OVERDUE past-due invoice
      // included. 10. DRAFT past-due invoice excluded (never a real
      // due-date commitment). 11. PAID and CANCELLED past-due excluded.
      await prisma.invoice.create({
        data: { organizationId: organization.id, clientId: client.id, invoiceNumber: "NA-SENT-PASTDUE", status: "SENT", amount: "10.00", currency: "USD", issueDate: LAST_MONTH, dueDate: YESTERDAY },
      });
      await prisma.invoice.create({
        data: { organizationId: organization.id, clientId: client.id, invoiceNumber: "NA-OVERDUE-PASTDUE", status: "OVERDUE", amount: "20.00", currency: "USD", issueDate: LAST_MONTH, dueDate: YESTERDAY },
      });
      await prisma.invoice.create({
        data: { organizationId: organization.id, clientId: client.id, invoiceNumber: "NA-DRAFT-PASTDUE", status: "DRAFT", amount: "30.00", currency: "USD", issueDate: LAST_MONTH, dueDate: YESTERDAY },
      });
      await prisma.invoice.create({
        data: { organizationId: organization.id, clientId: client.id, invoiceNumber: "NA-PAID-PASTDUE", status: "PAID", amount: "40.00", currency: "USD", issueDate: LAST_MONTH, dueDate: YESTERDAY, paidAt: NOW },
      });
      await prisma.invoice.create({
        data: { organizationId: organization.id, clientId: client.id, invoiceNumber: "NA-CANCELLED-PASTDUE", status: "CANCELLED", amount: "50.00", currency: "USD", issueDate: LAST_MONTH, dueDate: YESTERDAY },
      });

      // 12. Contract SENT included. 13. Contract DRAFT excluded.
      await prisma.contract.create({
        data: {
          organization: { connect: { id: organization.id } },
          client: { connect: { id: client.id } },
          createdByUser: { connect: { id: ownerId } },
          contractNumber: "NA-CONTRACT-SENT",
          title: "Sent Contract",
          body: "Body",
          status: "SENT",
          sentAt: YESTERDAY,
        },
      });
      await prisma.contract.create({
        data: {
          organization: { connect: { id: organization.id } },
          client: { connect: { id: client.id } },
          createdByUser: { connect: { id: ownerId } },
          contractNumber: "NA-CONTRACT-DRAFT",
          title: "Draft Contract",
          body: "Body",
          status: "DRAFT",
        },
      });
    });

    afterAll(async () => cleanupOrg(ctx));

    it("6. overdue tasks = not DONE and dueDate < now", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      expect(analytics.kpis.overdueTasksCount).toBe(1);
      expect(analytics.overdueTasks.map((t) => t.title)).toContain("Overdue Not Done");
    });

    it("7. a DONE task past its own due date is excluded from overdue tasks", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      expect(analytics.overdueTasks.map((t) => t.title)).not.toContain("Overdue But Done");
    });

    it("8. a SENT past-due invoice is included in Needs Attention overdue invoices", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      expect(analytics.needsAttention.overdueInvoices.map((i) => i.invoiceNumber)).toContain("NA-SENT-PASTDUE");
    });

    it("9. an OVERDUE past-due invoice is included in Needs Attention overdue invoices", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      expect(analytics.needsAttention.overdueInvoices.map((i) => i.invoiceNumber)).toContain("NA-OVERDUE-PASTDUE");
    });

    it("10. a DRAFT past-due invoice is excluded from Needs Attention overdue invoices", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      expect(analytics.needsAttention.overdueInvoices.map((i) => i.invoiceNumber)).not.toContain("NA-DRAFT-PASTDUE");
    });

    it("11. PAID and CANCELLED past-due invoices are excluded from Needs Attention overdue invoices", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      const numbers = analytics.needsAttention.overdueInvoices.map((i) => i.invoiceNumber);
      expect(numbers).not.toContain("NA-PAID-PASTDUE");
      expect(numbers).not.toContain("NA-CANCELLED-PASTDUE");
      expect(analytics.needsAttention.overdueInvoicesCount).toBe(2);
    });

    it("12. a SENT contract is included in unsigned contracts", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      expect(analytics.needsAttention.unsignedContracts.map((c) => c.contractNumber)).toContain("NA-CONTRACT-SENT");
    });

    it("13. a DRAFT contract is excluded from unsigned contracts", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      const numbers = analytics.needsAttention.unsignedContracts.map((c) => c.contractNumber);
      expect(numbers).not.toContain("NA-CONTRACT-DRAFT");
      expect(analytics.needsAttention.unsignedContractsCount).toBe(1);
    });
  });

  describe("Today", () => {
    let ctx: OrgContext;

    beforeAll(async () => {
      ctx = await makeOrg("redesign-today");
      const { organization, project, ownerId } = ctx;

      // 14. + 15. + 16. Task due today (not DONE) included; a DONE task
      // due today excluded; yesterday/tomorrow tasks excluded.
      await prisma.task.create({
        data: { organizationId: organization.id, projectId: project.id, title: "Due Today Open", status: "TODO", priority: "MEDIUM", dueDate: new Date(Date.UTC(2026, 5, 15)) },
      });
      await prisma.task.create({
        data: { organizationId: organization.id, projectId: project.id, title: "Due Today Done", status: "DONE", priority: "MEDIUM", dueDate: new Date(Date.UTC(2026, 5, 15)), completedAt: NOW },
      });
      await prisma.task.create({
        data: { organizationId: organization.id, projectId: project.id, title: "Due Yesterday", status: "TODO", priority: "MEDIUM", dueDate: new Date(Date.UTC(2026, 5, 14)) },
      });
      await prisma.task.create({
        data: { organizationId: organization.id, projectId: project.id, title: "Due Tomorrow", status: "TODO", priority: "MEDIUM", dueDate: new Date(Date.UTC(2026, 5, 16)) },
      });

      // 17. Timed event today (organization has no OrganizationProfile,
      // so its own resolved timezone is the documented "UTC" default —
      // a timed event at 10:00 UTC is unambiguously "today" under UTC).
      await prisma.calendarEvent.create({
        data: {
          organizationId: organization.id,
          title: "Timed Event Today",
          allDay: false,
          startsAt: new Date("2026-06-15T10:00:00.000Z"),
          createdByUserId: ownerId,
        },
      });
      // 18. All-day event today (date-only, UTC midnight on the named day).
      await prisma.calendarEvent.create({
        data: {
          organizationId: organization.id,
          title: "All Day Event Today",
          allDay: true,
          startsAt: new Date(Date.UTC(2026, 5, 15)),
          createdByUserId: ownerId,
        },
      });
      // 19. Archived event today — must be excluded.
      await prisma.calendarEvent.create({
        data: {
          organizationId: organization.id,
          title: "Archived Event Today",
          allDay: true,
          startsAt: new Date(Date.UTC(2026, 5, 15)),
          createdByUserId: ownerId,
          archivedAt: NOW,
        },
      });
      // An event tomorrow — must be excluded.
      await prisma.calendarEvent.create({
        data: {
          organizationId: organization.id,
          title: "Timed Event Tomorrow",
          allDay: false,
          startsAt: new Date("2026-06-16T10:00:00.000Z"),
          createdByUserId: ownerId,
        },
      });
    });

    afterAll(async () => cleanupOrg(ctx));

    it("14. a not-DONE task due today is included", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      expect(analytics.today.tasks.map((t) => t.title)).toContain("Due Today Open");
    });

    it("15. a DONE task due today is excluded", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      expect(analytics.today.tasks.map((t) => t.title)).not.toContain("Due Today Done");
    });

    it("16. tasks due yesterday or tomorrow are excluded from Today", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      const titles = analytics.today.tasks.map((t) => t.title);
      expect(titles).not.toContain("Due Yesterday");
      expect(titles).not.toContain("Due Tomorrow");
      expect(analytics.today.tasksCount).toBe(1);
    });

    it("17. a timed calendar event today (organization-local, UTC default) is included", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      const titles = analytics.today.events.map((e) => e.title);
      expect(titles).toContain("Timed Event Today");
      expect(titles).not.toContain("Timed Event Tomorrow");
    });

    it("18. an all-day calendar event today is included", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      expect(analytics.today.events.map((e) => e.title)).toContain("All Day Event Today");
    });

    it("19. an archived calendar event today is excluded", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      expect(analytics.today.events.map((e) => e.title)).not.toContain("Archived Event Today");
    });
  });

  describe("Recent activity", () => {
    let ctx: OrgContext;

    beforeAll(async () => {
      ctx = await makeOrg("redesign-activity");
      // 20. bounded to intended count (5) — seed more than 5 raw Activity
      // rows directly (mirrors this app's own established "direct write,
      // never createActivity()" precedent for non-product test seeding).
      const rows = Array.from({ length: 8 }, (_, i) => ({
        organizationId: ctx.organization.id,
        actorId: ctx.ownerId,
        entityType: "CLIENT" as const,
        entityId: randomUUID(),
        action: "CREATED" as const,
        metadata: { name: `Activity ${i}` },
      }));
      await prisma.activity.createMany({ data: rows });
    });

    afterAll(async () => cleanupOrg(ctx));

    it("20. Recent activity is bounded to exactly 5 items even when more exist", async () => {
      const analytics = await getDashboardAnalytics({ organizationId: ctx.organization.id, period: "30d", now: NOW });
      expect(analytics.recentActivity.length).toBe(5);
    });
  });
});
