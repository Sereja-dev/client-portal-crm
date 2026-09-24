import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { formatCurrency } from "@/lib/format";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { BreakdownCard } from "@/components/dashboard/breakdown-card";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { StatusBadge } from "@/components/ui/status-badge";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { formatInvoiceStatusLabel } from "@/lib/invoices/status-label";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { OnboardingCard, ONBOARDING_DISMISS_RETURN_FOCUS_ID } from "@/components/onboarding/onboarding-card";
import { StartWithSampleData } from "@/components/onboarding/start-with-sample-data";
import { parseDashboardPeriod, formatDashboardPeriodLabel } from "@/lib/dashboard/period";
import { getOrganizationOnboardingSignals } from "@/lib/onboarding/progress";
import { buildVisibleOnboardingProgress } from "@/lib/onboarding/visible-progress";
import { isEligibleForSampleData } from "@/lib/onboarding/sample-data";
import { getDashboardAnalytics } from "./query";
import type { RawSearchParams } from "@/lib/list-params";

const linkClass = ACTION_LINK_CLASSES;
const itemLinkClass =
  "text-text-primary focus-visible:ring-focus-ring rounded text-sm font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  // organizationId always comes from the session/cookie, never from
  // searchParams — only `period` is ever read from the query string, and
  // it's validated (with a safe fallback) before being used for anything.
  // Onboarding Redesign — membership.role is threaded into the new
  // visible-progress model below (never accepted from the client) so a
  // MEMBER/ADMIN never receives a Company Profile/Invite CTA they'd be
  // rejected from.
  const { organizationId, membership } = await getCurrentMembership();
  const resolvedSearchParams = await searchParams;
  const period = parseDashboardPeriod(resolvedSearchParams.period);
  const now = new Date();

  const [analytics, onboardingSignals, sampleDataEligible] = await Promise.all([
    getDashboardAnalytics({ organizationId, period, now }),
    // One shared raw-signal query backs both the new 5-step visible model
    // and the dismiss check below — never a second, duplicate query, and
    // never the legacy 11-step buildOnboardingProgress() at all here (that
    // full computation still exists, unchanged, for Platform Admin/
    // Analytics — just not needed on this page anymore).
    getOrganizationOnboardingSignals(organizationId),
    // Demo Vs Real Workspace Separation §9 — server-resolved only; the
    // component itself never guesses its own eligibility.
    isEligibleForSampleData(organizationId),
  ]);

  const onboardingProgress = buildVisibleOnboardingProgress(onboardingSignals, membership.role);
  // The legacy FINISH row remains the one dismiss signal (locked spec §6/
  // §10) — unchanged mechanism, just read directly off the same raw
  // signals rather than the full legacy summary.
  const isOnboardingDismissed = onboardingSignals.actedStepKeys.has("FINISH");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {/* Stage 6 audit fix: focus-return target for
              DismissOnboardingButton — see that component's own comment on
              why this uses plain `focus:` rather than `focus-visible:`
              (never in the tab order, only ever programmatically focused). */}
          <h1
            id={ONBOARDING_DISMISS_RETURN_FOCUS_ID}
            tabIndex={-1}
            className="text-text-primary focus:ring-focus-ring rounded text-2xl font-semibold tracking-tight focus:outline-none focus:ring-2 focus:ring-offset-2"
          >
            Dashboard
          </h1>
          <p className="text-text-secondary mt-1 text-sm">
            An overview of your clients, projects, tasks, and invoices.
          </p>
        </div>
        <PeriodSelector period={period} />
      </div>

      <OnboardingCard progress={onboardingProgress} isDismissed={isOnboardingDismissed} />
      <StartWithSampleData eligible={sampleDataEligible} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Total clients" value={analytics.kpis.totalClients} href="/clients" />
        <MetricCard
          label="Active projects"
          value={analytics.kpis.activeProjects}
          href="/projects"
        />
        <MetricCard label="Open tasks" value={analytics.kpis.openTasks} href="/tasks" />
        <MetricCard
          label="Overdue tasks"
          value={analytics.kpis.overdueTasksCount}
          href="/tasks"
        />
        <MetricCard
          label="Outstanding amount"
          value={formatCurrency(analytics.kpis.outstandingAmount)}
          href="/invoices"
        />
        <MetricCard
          label="Paid revenue"
          value={formatCurrency(analytics.kpis.paidRevenue)}
          href="/invoices"
          hint={formatDashboardPeriodLabel(period)}
        />
      </div>

      <RevenueChart
        buckets={analytics.revenue.buckets}
        bucketUnit={analytics.periodRange.bucketUnit}
        total={analytics.revenue.total}
        period={period}
      />

      <div>
        <h2 className="text-text-primary text-lg font-semibold tracking-tight">Breakdowns</h2>
        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <BreakdownCard title="Invoice status" items={analytics.breakdowns.invoiceStatus} labelFormatter={formatInvoiceStatusLabel} />
          <BreakdownCard title="Task status" items={analytics.breakdowns.taskStatus} />
          <BreakdownCard title="Project status" items={analytics.breakdowns.projectStatus} />
        </div>
      </div>

      <RecentActivity items={analytics.recentActivity} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className={`p-6 ${CARD_SURFACE_CLASSES}`}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-text-primary text-sm font-semibold">Upcoming tasks</h3>
            <Link href="/tasks" className={linkClass}>
              View all
            </Link>
          </div>
          {analytics.upcomingTasks.length === 0 ? (
            <p className="text-text-muted text-sm">No upcoming tasks.</p>
          ) : (
            <ul className="divide-border-default divide-y">
              {analytics.upcomingTasks.map((task) => (
                <li key={task.id} className="py-3 first:pt-0 last:pb-0">
                  <Link href={`/tasks/${task.id}/edit`} className={itemLinkClass}>
                    {task.title}
                  </Link>
                  <p className="text-text-muted text-sm">{task.projectName}</p>
                  <p className="text-text-muted mt-1 text-xs">
                    Due {formatDateOnlyForDisplay(task.dueDate)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`p-6 ${CARD_SURFACE_CLASSES}`}>
          <h3 className="text-text-primary mb-4 text-sm font-semibold">Overdue items</h3>
          {analytics.overdueItems.length === 0 ? (
            <p className="text-text-muted text-sm">Nothing overdue.</p>
          ) : (
            <ul className="divide-border-default divide-y">
              {analytics.overdueItems.map((item) => (
                <li key={`${item.kind}-${item.id}`} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-2">
                    <span className="bg-surface-muted text-text-secondary inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
                      {item.kind === "task" ? "Task" : "Invoice"}
                    </span>
                    <Link
                      href={item.kind === "task" ? `/tasks/${item.id}/edit` : `/invoices/${item.id}/edit`}
                      className={itemLinkClass}
                    >
                      {item.kind === "task" ? item.title : item.invoiceNumber}
                    </Link>
                  </div>
                  <p className="text-text-muted mt-1 text-sm">
                    {item.kind === "task" ? item.projectName : item.clientName}
                    {item.kind === "invoice" && ` · ${formatCurrency(item.amount, item.currency)}`}
                  </p>
                  <p className="text-danger mt-0.5 text-xs">
                    Due {formatDateOnlyForDisplay(item.dueDate)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`p-6 ${CARD_SURFACE_CLASSES}`}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-text-primary text-sm font-semibold">Recent invoices</h3>
            <Link href="/invoices" className={linkClass}>
              View all
            </Link>
          </div>
          {analytics.recentInvoices.length === 0 ? (
            <p className="text-text-muted text-sm">No invoices yet.</p>
          ) : (
            <ul className="divide-border-default divide-y">
              {analytics.recentInvoices.map((invoice) => (
                <li key={invoice.id} className="py-3 first:pt-0 last:pb-0">
                  <Link href={`/invoices/${invoice.id}/edit`} className={itemLinkClass}>
                    {invoice.invoiceNumber}
                  </Link>
                  <p className="text-text-muted text-sm">
                    <Link href={`/clients/${invoice.clientId}/edit`} className={ACTION_LINK_CLASSES}>
                      {invoice.clientName}
                    </Link>
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusBadge status={invoice.status} label={formatInvoiceStatusLabel(invoice.status)} />
                    <span className="text-text-muted text-xs">
                      {formatCurrency(invoice.amount, invoice.currency)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
