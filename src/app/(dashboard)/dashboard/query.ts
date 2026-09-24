import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { formatActivity, type ActivityDisplayModel } from "@/lib/activity/format-activity";
import { InvoiceStatus, TaskStatus, ProjectStatus } from "@/generated/prisma/enums";
import type { DashboardPeriod } from "@/lib/dashboard/period";
import { getDashboardPeriodRange, type DashboardBucketUnit } from "@/lib/dashboard/period";
import { bucketRevenue, type RevenueResult } from "@/lib/dashboard/revenue";
import { resolveSystemStatusDefinition } from "@/lib/custom-statuses/resolution";
import { SYSTEM_STATUS_KEYS } from "@/lib/custom-statuses/constants";
import { resolveReportsCurrency } from "@/lib/reports/currency";
import { getOrganizationTimezone, listCalendarEventsForRange } from "@/lib/calendar-events/queries";
import { formatTimeInTimezone } from "@/lib/calendar-events/timezone";

// PAID and CANCELLED are excluded; everything else (DRAFT, SENT, OVERDUE)
// still represents money the client owes. This module is the one
// authoritative home for this definition — the KPI's own outstandingAmount/
// outstandingCount below.
const UNPAID_INVOICE_STATUSES = ["DRAFT", "SENT", "OVERDUE"] as const;

// Dashboard Redesign — the Needs Attention "overdue invoices" definition is
// deliberately BROADER than the persisted OVERDUE status alone: OVERDUE is
// manually maintained by Staff and cannot alone represent operational
// lateness. This operational definition instead mirrors overdue Tasks
// exactly — derived live from dueDate, never a persisted status — so a
// workspace that never manually flips an invoice to OVERDUE still sees
// real overdue money here. DRAFT is excluded (no real due-date commitment
// yet); PAID/CANCELLED are excluded (nothing outstanding).
const NEEDS_ATTENTION_OVERDUE_INVOICE_STATUSES = ["SENT", "OVERDUE"] as const;

const RECENT_ACTIVITY_TAKE = 5;
const LIST_TAKE = 5;
const NEEDS_ATTENTION_TAKE = 5;
const TODAY_TASKS_TAKE = 5;
const TODAY_EVENTS_TAKE = 5;

export type StatusBreakdownItem<S extends string> = { status: S; count: number };

/** Every known status is present, including ones with zero rows. */
function normalizeStatusBreakdown<S extends string>(
  allStatuses: readonly S[],
  grouped: { status: S; _count: number }[],
): StatusBreakdownItem<S>[] {
  const counts = new Map(grouped.map((g) => [g.status, g._count]));
  return allStatuses.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

export type UpcomingOrOverdueTask = {
  id: string;
  title: string;
  dueDate: Date;
  projectName: string;
};

export type RecentInvoice = {
  id: string;
  invoiceNumber: string;
  status: string;
  amount: number;
  currency: string;
  clientId: string;
  clientName: string;
  createdAt: Date;
};

/** Needs Attention — one overdue invoice row. Never currency-filtered (unlike the KPI aggregates): each row keeps and formats its own invoice's own currency, exactly like recentInvoices above. */
export type NeedsAttentionInvoice = {
  id: string;
  invoiceNumber: string;
  dueDate: Date;
  clientName: string;
  amount: number;
  currency: string;
};

/** Needs Attention — one unsigned (SENT, not yet ACCEPTED) contract row. */
export type NeedsAttentionContract = {
  id: string;
  contractNumber: string;
  title: string;
  clientName: string;
  sentAt: Date | null;
};

/** Today — one calendar event row. Bounded to today's organization-local calendar day by the caller (listCalendarEventsForRange). `displayTime` is pre-formatted server-side (organization timezone is already resolved here, never threaded raw into the UI layer) — `null` for an all-day event. */
export type TodayCalendarEvent = {
  id: string;
  title: string;
  allDay: boolean;
  startsAt: Date;
  displayTime: string | null;
};

export type DashboardAnalytics = {
  period: DashboardPeriod;
  periodRange: { start: Date; end: Date; bucketUnit: DashboardBucketUnit };
  /**
   * Dashboard Multi-Currency KPI Defect fix — the one currency every
   * financial aggregate below (outstandingAmount, paidRevenue, and the
   * revenue buckets derived from the same rows) is scoped to, resolved
   * via the same canonical, no-explicit-request policy Reports V1 already
   * established (resolveReportsCurrency, currency.ts). `null` only in the
   * type-level, practically unreachable case documented on
   * ReportsCurrencySelection itself (an organization with zero invoices
   * whose own resolved default currency is somehow also empty). Never a
   * Dashboard currency selector — there is exactly one resolved value,
   * never a user-chosen one.
   */
  currency: string | null;
  kpis: {
    totalClients: number;
    activeProjects: number;
    openTasks: number;
    overdueTasksCount: number;
    outstandingAmount: number;
    /** Dashboard Redesign — count of the same DRAFT/SENT/OVERDUE invoices outstandingAmount sums, for the KPI card's own optional secondary metadata. Same query, same currency scope, zero extra round trip (Prisma's own aggregate _count). */
    outstandingCount: number;
    paidRevenue: number;
    /** Dashboard Redesign — the new "Revenue" KPI's own value: PAID invoices whose paidAt falls within the current UTC calendar month, scoped to the same canonical currency as every other financial aggregate here. Deliberately additive, never replacing paidRevenue above (getOrganizationSummary's own existing contract still reads that field, computed exactly as before). */
    paidThisMonth: number;
  };
  revenue: RevenueResult;
  breakdowns: {
    invoiceStatus: StatusBreakdownItem<string>[];
    taskStatus: StatusBreakdownItem<string>[];
    projectStatus: StatusBreakdownItem<string>[];
  };
  recentActivity: { id: string; display: ActivityDisplayModel }[];
  upcomingTasks: UpcomingOrOverdueTask[];
  overdueTasks: UpcomingOrOverdueTask[];
  recentInvoices: RecentInvoice[];
  /** Dashboard Redesign — the operational Needs Attention section's own two new categories (overdue tasks reuses overdueTasks/kpis.overdueTasksCount above directly — no duplication). */
  needsAttention: {
    overdueInvoicesCount: number;
    overdueInvoices: NeedsAttentionInvoice[];
    unsignedContractsCount: number;
    unsignedContracts: NeedsAttentionContract[];
  };
  /** Dashboard Redesign — the operational Today section. */
  today: {
    tasksCount: number;
    tasks: UpcomingOrOverdueTask[];
    events: TodayCalendarEvent[];
  };
};

/** UTC calendar-day start for `date` — mirrors src/lib/dashboard/revenue.ts's own private utcDayStart() exactly (same technique, kept as its own small local copy rather than exported/imported, since that module's own "no I/O, self-contained" discipline is unrelated to this one extra call site). */
function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Single entry point for all Dashboard Analytics data. `organizationId` must
 * already be resolved by the caller from the current session/cookie (via
 * getCurrentUserOrganization) — this function never reads it from
 * searchParams or any other client-controlled input, and never resolves it
 * itself. `now` is likewise always caller-supplied (never `new Date()`
 * inside here), so every query in this call — and the bucketing derived
 * from them — is evaluated against exactly one consistent instant.
 *
 * Every Prisma call below is independent of every other, so they all run
 * concurrently in one Promise.all — no query here depends on another's
 * result, and no list query triggers per-row follow-up queries (all
 * relation data is pulled via select/include up front). Nothing here is
 * cached: the active organization lives in a cookie and can change from one
 * request to the next, so a shared cache keyed on anything less specific
 * than (organizationId, period, now) would risk leaking one organization's
 * numbers into another's view.
 */
export async function getDashboardAnalytics({
  organizationId,
  period,
  now,
}: {
  organizationId: string;
  period: DashboardPeriod;
  now: Date;
}): Promise<DashboardAnalytics> {
  const periodRange = getDashboardPeriodRange(period, now);
  const todayStart = utcDayStart(now);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  // Custom Statuses Phase 2A (Section K) — the "active projects" KPI is
  // specifically the built-in IN_PROGRESS semantic status, not "any
  // project a Staff member might informally consider active" (Phase 1's
  // own audit confirmed this is the one real Project semantic
  // dependency). Resolved once per dashboard load (never per-row —
  // Section S), then filtered by statusDefinitionId, falling back to the
  // legacy `status` enum only for a still-unbackfilled row (Section D).
  // A custom Project status can never satisfy this count, even if its
  // own legacy compatibility value happens to still read IN_PROGRESS
  // from before a hypothetical reassignment (Section J).
  const [inProgressDefinition, currencySelection, organizationTimezone] = await Promise.all([
    resolveSystemStatusDefinition(organizationId, "PROJECT", SYSTEM_STATUS_KEYS.PROJECT_IN_PROGRESS),
    // Dashboard Multi-Currency KPI Defect fix — reuses Reports V1's own
    // canonical "no explicit requested currency" resolution verbatim,
    // never a second currency-selection policy: the organization's own
    // default invoice currency when it's actually in use among this
    // org's own invoices, else the first currency (alphabetically) this
    // org's invoices actually use. No Dashboard currency selector exists
    // or is introduced by this fix — `requestedCurrency` is always
    // undefined here.
    resolveReportsCurrency(organizationId, undefined),
    // Dashboard Redesign — Today's calendar events need the organization's
    // own IANA timezone (Calendar V1 locked architecture §8), resolved
    // once here rather than inline, mirroring the existing
    // inProgressDefinition/currencySelection pre-resolution shape exactly.
    getOrganizationTimezone(organizationId),
  ]);
  const activeProjectsWhere: Prisma.ProjectWhereInput = inProgressDefinition
    ? {
        organizationId,
        OR: [{ statusDefinitionId: inProgressDefinition.id }, { statusDefinitionId: null, status: "IN_PROGRESS" }],
      }
    : { organizationId, status: "IN_PROGRESS" };
  // Every Dashboard financial aggregate below (Outstanding amount, Paid
  // revenue, and the revenue-over-time buckets derived from the very same
  // paidInvoicesInPeriod rows) is scoped to exactly this one currency —
  // never summed across currencies, mirroring src/lib/reports/queries/
  // financial.ts's own identical discipline. `dashboardCurrency` is `null`
  // only in the practically-unreachable case documented on
  // ReportsCurrencySelection itself, and only when this organization has
  // zero invoices at all — omitting the currency filter in that branch is
  // still safe, since there is nothing for it to match either way.
  const dashboardCurrency = currencySelection.selectedCurrency;
  const currencyWhere: Prisma.InvoiceWhereInput = dashboardCurrency ? { currency: dashboardCurrency } : {};

  const [
    totalClients,
    activeProjects,
    openTasks,
    overdueTasksCount,
    outstandingAgg,
    paidInvoicesInPeriod,
    paidThisMonthRows,
    invoiceStatusGrouped,
    taskStatusGrouped,
    projectStatusGrouped,
    activityRows,
    upcomingTasksRows,
    overdueTasksRows,
    recentInvoicesRows,
    needsAttentionOverdueInvoicesCount,
    needsAttentionOverdueInvoicesRows,
    unsignedContractsCount,
    unsignedContractsRows,
    todayTasksCount,
    todayTasksRows,
    todayEventsRows,
  ] = await Promise.all([
    prisma.client.count({ where: { organizationId } }),
    prisma.project.count({ where: activeProjectsWhere }),
    prisma.task.count({ where: { project: { organizationId }, status: { not: "DONE" } } }),
    prisma.task.count({
      where: { project: { organizationId }, status: { not: "DONE" }, dueDate: { lt: now } },
    }),
    prisma.invoice.aggregate({
      where: { organizationId, status: { in: [...UNPAID_INVOICE_STATUSES] }, ...currencyWhere },
      _sum: { amount: true },
      _count: true,
    }),
    // Selected once, used for both the paidRevenue KPI (sum) and the
    // revenue time series (bucketing) below — never queried twice.
    prisma.invoice.findMany({
      where: {
        organizationId,
        status: "PAID",
        paidAt: { not: null, gte: periodRange.start, lte: periodRange.end },
        ...currencyWhere,
      },
      select: { amount: true, paidAt: true },
    }),
    // Dashboard Redesign — "Revenue" KPI: PAID, paidAt within the current
    // UTC calendar month, same canonical currency. Deliberately a
    // separate query from paidInvoicesInPeriod above: that one is scoped
    // to the caller-supplied `period` (still required by
    // getOrganizationSummary's own unchanged contract, which always
    // passes DEFAULT_DASHBOARD_PERIOD), never a fixed calendar month.
    prisma.invoice.findMany({
      where: {
        organizationId,
        status: "PAID",
        paidAt: { gte: monthStart, lt: nextMonthStart },
        ...currencyWhere,
      },
      select: { amount: true },
    }),
    prisma.invoice.groupBy({
      by: ["status"],
      where: { organizationId },
      _count: true,
    }),
    prisma.task.groupBy({
      by: ["status"],
      where: { project: { organizationId } },
      _count: true,
    }),
    prisma.project.groupBy({
      by: ["status"],
      where: { organizationId },
      _count: true,
    }),
    prisma.activity.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT_ACTIVITY_TAKE,
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.task.findMany({
      where: { project: { organizationId }, status: { not: "DONE" }, dueDate: { not: null, gte: now } },
      orderBy: { dueDate: "asc" },
      take: LIST_TAKE,
      include: { project: { select: { name: true } } },
    }),
    prisma.task.findMany({
      where: { project: { organizationId }, status: { not: "DONE" }, dueDate: { lt: now } },
      orderBy: { dueDate: "asc" },
      take: LIST_TAKE,
      include: { project: { select: { name: true } } },
    }),
    prisma.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: LIST_TAKE,
      include: { client: { select: { name: true } } },
    }),
    // Needs Attention — overdue invoices: SENT or OVERDUE, dueDate < now.
    // Deliberately broader than the OVERDUE-only query above — see this
    // constant's own doc comment (NEEDS_ATTENTION_OVERDUE_INVOICE_STATUSES).
    prisma.invoice.count({
      where: { organizationId, status: { in: [...NEEDS_ATTENTION_OVERDUE_INVOICE_STATUSES] }, dueDate: { lt: now } },
    }),
    prisma.invoice.findMany({
      where: { organizationId, status: { in: [...NEEDS_ATTENTION_OVERDUE_INVOICE_STATUSES] }, dueDate: { lt: now } },
      orderBy: { dueDate: "asc" },
      take: NEEDS_ATTENTION_TAKE,
      include: { client: { select: { name: true } } },
    }),
    // Needs Attention — unsigned contracts: SENT only (approved
    // definition — sent to the client, not yet accepted; DRAFT was never
    // sent, so there is nothing outstanding to sign yet). Archived
    // contracts are excluded, matching this app's own established
    // archivedAt-aware convention elsewhere.
    prisma.contract.count({ where: { organizationId, status: "SENT", archivedAt: null } }),
    prisma.contract.findMany({
      where: { organizationId, status: "SENT", archivedAt: null },
      orderBy: { sentAt: "asc" },
      take: NEEDS_ATTENTION_TAKE,
      include: { client: { select: { name: true } } },
    }),
    // Today — tasks due today (date-only boundary, same convention as
    // every other Task.dueDate comparison in this file).
    prisma.task.count({
      where: { project: { organizationId }, status: { not: "DONE" }, dueDate: { gte: todayStart, lt: todayEnd } },
    }),
    prisma.task.findMany({
      where: { project: { organizationId }, status: { not: "DONE" }, dueDate: { gte: todayStart, lt: todayEnd } },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      take: TODAY_TASKS_TAKE,
      include: { project: { select: { name: true } } },
    }),
    // Today — calendar events. Reuses the canonical, already-correct
    // range query (organization-local timezone, all-day/timed
    // distinction, archived exclusion) rather than re-deriving any of
    // that here — see listCalendarEventsForRange's own doc comment.
    listCalendarEventsForRange(organizationId, { from: todayStart, to: todayEnd }, organizationTimezone),
  ]);

  // paidInvoicesInPeriod rows are already scoped to `paidAt not null AND in
  // range` by the query above, so bucketRevenue's total and buckets both
  // come from this one fetch.
  const revenue = bucketRevenue(
    paidInvoicesInPeriod.map((row) => ({ amount: row.amount, paidAt: row.paidAt as Date })),
    periodRange,
  );

  // Same plain-float summation technique bucketRevenue itself already
  // uses (Number(row.amount), reduced) — this Dashboard module's own
  // existing precision convention, not a new one introduced here.
  const paidThisMonth = paidThisMonthRows.reduce((sum, row) => sum + Number(row.amount), 0);

  return {
    period,
    periodRange: { start: periodRange.start, end: periodRange.end, bucketUnit: periodRange.bucketUnit },
    currency: dashboardCurrency,
    kpis: {
      totalClients,
      activeProjects,
      openTasks,
      overdueTasksCount,
      outstandingAmount: Number(outstandingAgg._sum.amount ?? 0),
      outstandingCount: outstandingAgg._count,
      paidRevenue: revenue.total,
      paidThisMonth,
    },
    revenue,
    breakdowns: {
      invoiceStatus: normalizeStatusBreakdown(Object.values(InvoiceStatus), invoiceStatusGrouped),
      taskStatus: normalizeStatusBreakdown(Object.values(TaskStatus), taskStatusGrouped),
      projectStatus: normalizeStatusBreakdown(Object.values(ProjectStatus), projectStatusGrouped),
    },
    recentActivity: activityRows.map((row) => ({
      id: row.id,
      display: formatActivity({
        entityType: row.entityType,
        action: row.action,
        metadata: row.metadata,
        actor: row.actor,
        createdAt: row.createdAt,
      }),
    })),
    upcomingTasks: upcomingTasksRows.map((task) => ({
      id: task.id,
      title: task.title,
      dueDate: task.dueDate as Date,
      projectName: task.project.name,
    })),
    overdueTasks: overdueTasksRows.map((task) => ({
      id: task.id,
      title: task.title,
      dueDate: task.dueDate as Date,
      projectName: task.project.name,
    })),
    recentInvoices: recentInvoicesRows.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      amount: Number(invoice.amount),
      currency: invoice.currency,
      clientId: invoice.clientId,
      clientName: invoice.client.name,
      createdAt: invoice.createdAt,
    })),
    needsAttention: {
      overdueInvoicesCount: needsAttentionOverdueInvoicesCount,
      overdueInvoices: needsAttentionOverdueInvoicesRows.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        dueDate: invoice.dueDate as Date,
        clientName: invoice.client.name,
        amount: Number(invoice.amount),
        currency: invoice.currency,
      })),
      unsignedContractsCount,
      unsignedContracts: unsignedContractsRows.map((contract) => ({
        id: contract.id,
        contractNumber: contract.contractNumber,
        title: contract.title,
        clientName: contract.client.name,
        sentAt: contract.sentAt,
      })),
    },
    today: {
      tasksCount: todayTasksCount,
      tasks: todayTasksRows.map((task) => ({
        id: task.id,
        title: task.title,
        dueDate: task.dueDate as Date,
        projectName: task.project.name,
      })),
      events: todayEventsRows.slice(0, TODAY_EVENTS_TAKE).map((event) => ({
        id: event.id,
        title: event.title,
        allDay: event.allDay,
        startsAt: event.startsAt,
        displayTime: event.allDay ? null : formatTimeInTimezone(event.startsAt, organizationTimezone),
      })),
    },
  };
}
