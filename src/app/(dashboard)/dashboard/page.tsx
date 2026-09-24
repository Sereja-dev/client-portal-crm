import { getCurrentMembership } from "@/lib/current-user";
import { formatCurrency } from "@/lib/format";
import { MetricCard } from "@/components/dashboard/metric-card";
import { DashboardActions } from "@/components/dashboard/dashboard-actions";
import { NeedsAttention } from "@/components/dashboard/needs-attention";
import { TodaySection } from "@/components/dashboard/today-section";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { OnboardingCard, ONBOARDING_DISMISS_RETURN_FOCUS_ID } from "@/components/onboarding/onboarding-card";
import { StartWithSampleData } from "@/components/onboarding/start-with-sample-data";
import { DEFAULT_DASHBOARD_PERIOD } from "@/lib/dashboard/period";
import { getOrganizationOnboardingSignals } from "@/lib/onboarding/progress";
import { buildVisibleOnboardingProgress } from "@/lib/onboarding/visible-progress";
import { isEligibleForSampleData } from "@/lib/onboarding/sample-data";
import { getDashboardAnalytics } from "./query";

/**
 * Dashboard Redesign — an operational work center, not a reporting page.
 * Final structure: header + quick actions, conditional Onboarding/
 * sample-data (preserved exactly), a five-card KPI row, Needs Attention,
 * Today, and a bounded Recent Activity preview. The old page-level period
 * selector, Revenue-over-time chart, three status-breakdown cards, and
 * the Upcoming-tasks/Overdue-items/Recent-invoices bottom trio are all
 * removed from THIS page — none of their underlying data/queries were
 * deleted (getDashboardAnalytics still computes and returns every one of
 * them unchanged, since getOrganizationSummary's own AI-tool contract
 * still reads several of those exact fields) — only this page's own
 * rendering of them.
 *
 * `getDashboardAnalytics` still takes a `period` argument (never removed
 * — see its own doc comment) purely because getOrganizationSummary's own
 * existing call site still passes DEFAULT_DASHBOARD_PERIOD; this page no
 * longer has a period selector, so it passes that exact same fixed
 * constant rather than reading anything from searchParams. No `period`/
 * `?period=` value is ever read from the URL here anymore.
 */
export default async function DashboardPage() {
  // organizationId always comes from the session/cookie. Onboarding
  // Redesign — membership.role is threaded into the visible-progress
  // model below (never accepted from the client) so a MEMBER/ADMIN never
  // receives a Company Profile/Invite CTA they'd be rejected from.
  const { organizationId, membership } = await getCurrentMembership();
  const now = new Date();

  const [analytics, onboardingSignals, sampleDataEligible] = await Promise.all([
    getDashboardAnalytics({ organizationId, period: DEFAULT_DASHBOARD_PERIOD, now }),
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
        <DashboardActions />
      </div>

      <OnboardingCard progress={onboardingProgress} isDismissed={isOnboardingDismissed} />
      <StartWithSampleData eligible={sampleDataEligible} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Clients" value={analytics.kpis.totalClients} href="/clients" />
        <MetricCard label="Active projects" value={analytics.kpis.activeProjects} href="/projects" />
        <MetricCard label="Open tasks" value={analytics.kpis.openTasks} href="/tasks" />
        <MetricCard
          label="Outstanding invoices"
          value={analytics.currency ? formatCurrency(analytics.kpis.outstandingAmount, analytics.currency) : "—"}
          href="/invoices"
          hint={`${analytics.kpis.outstandingCount} ${analytics.kpis.outstandingCount === 1 ? "invoice" : "invoices"}`}
        />
        <MetricCard
          label="Revenue"
          value={analytics.currency ? formatCurrency(analytics.kpis.paidThisMonth, analytics.currency) : "—"}
          href="/invoices"
          hint="Paid this month"
        />
      </div>

      <NeedsAttention
        overdueTasksCount={analytics.kpis.overdueTasksCount}
        overdueTasks={analytics.overdueTasks}
        overdueInvoicesCount={analytics.needsAttention.overdueInvoicesCount}
        overdueInvoices={analytics.needsAttention.overdueInvoices}
        unsignedContractsCount={analytics.needsAttention.unsignedContractsCount}
        unsignedContracts={analytics.needsAttention.unsignedContracts}
      />

      <TodaySection tasks={analytics.today.tasks} events={analytics.today.events} />

      <RecentActivity items={analytics.recentActivity} />
    </div>
  );
}
