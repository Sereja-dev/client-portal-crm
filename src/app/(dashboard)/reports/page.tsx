import { getReportsOverview } from "@/lib/reports/service";
import { ReportsAccessError } from "@/lib/reports/authorization";
import { REPORTS_PERIOD_OPTIONS } from "@/lib/reports/period";
import { formatCurrency } from "@/lib/format";
import { formatTrackedDuration } from "@/lib/reports/format";
import { ReportsHeader } from "@/components/reports/reports-header";
import { ReportsKpiCard } from "@/components/reports/reports-kpi-card";
import { ReportsRevenueTrendChart } from "@/components/reports/reports-revenue-trend-chart";
import { ReportsLeadPipeline } from "@/components/reports/reports-lead-pipeline";
import { ReportsTopClientsTable } from "@/components/reports/reports-top-clients-table";
import { ReportsTimeByClientTable } from "@/components/reports/reports-time-by-client-table";
import { ReportsAccessDenied } from "@/components/reports/reports-access-denied";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import type { RawSearchParams } from "@/lib/list-params";

/**
 * Reports Phase 2 — the Staff `/reports` route. Server Component, real
 * Server Component data flow throughout: reads untrusted `searchParams`,
 * passes only the two raw string(s)-or-undefined values Phase 1's own
 * parser/resolver are built to validate (`period`, `currency`) into
 * `getReportsOverview()`, and renders exactly what that one call
 * returns — no second, parallel client-side data-fetching layer, no
 * reporting logic duplicated here.
 *
 * `organizationId` is never read from `searchParams` (there is no such
 * param at all) — `getReportsOverview()` resolves it itself, from the
 * current session, and enforces OWNER/ADMIN authorization internally
 * before any query runs (see src/lib/reports/service.ts's own doc
 * comment). This page's only responsibility for authorization is
 * deciding how to RENDER the already-server-made decision: catching
 * `ReportsAccessError` here (a real, expected, in-process outcome for a
 * MEMBER — not a bug) and rendering the dedicated Access denied state,
 * exactly mirroring src/app/(dashboard)/analytics/page.tsx's own
 * identical pattern (deliberately not delegated to this route's own
 * error.tsx, since Next.js redacts Server Component error messages in
 * production before they'd reach a client-side error boundary — every
 * OTHER thrown error still propagates there normally).
 *
 * `period`/`currency` are read from the URL, never a cookie, so every
 * filter combination is shareable/bookmarkable — changing either filter
 * is a real navigation (see ReportsPeriodSelector/ReportsCurrencySelector,
 * both plain `<Link>`s), never hidden client-only state.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const resolvedSearchParams = await searchParams;

  let data;
  try {
    data = await getReportsOverview({
      requestedPeriod: resolvedSearchParams.period,
      requestedCurrency: resolvedSearchParams.currency,
    });
  } catch (err) {
    if (err instanceof ReportsAccessError) {
      return <ReportsAccessDenied />;
    }
    throw err;
  }

  const currency = data.currency.selectedCurrency;
  const periodLabel = REPORTS_PERIOD_OPTIONS.find((option) => option.value === data.period)?.label ?? "Last 30 days";

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <ReportsHeader period={data.period} currency={data.currency} />

      <div className="mt-6 space-y-6">
        {/* KPI grid — same 2/3/6-column responsive shape (390/834/1280) Dashboard's own 6-card KPI grid already uses in production. */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <ReportsKpiCard label="Paid revenue" value={currency ? formatCurrency(data.overview.paidRevenue, currency) : "—"} hint={periodLabel} />
          {/* Outstanding is a CURRENT SNAPSHOT, not scoped to the selected period — the hint says so explicitly, never the period label. */}
          <ReportsKpiCard
            label="Outstanding"
            value={currency ? formatCurrency(data.overview.outstandingNow, currency) : "—"}
            hint="Current outstanding receivables"
          />
          <ReportsKpiCard label="New Leads" value={data.overview.newLeads} hint={periodLabel} />
          <ReportsKpiCard label="Converted Leads" value={data.overview.convertedLeads} hint={periodLabel} />
          <ReportsKpiCard label="New Clients" value={data.overview.newClients} hint={periodLabel} />
          <ReportsKpiCard label="Tracked hours" value={formatTrackedDuration(data.overview.trackedMinutes)} hint={periodLabel} />
        </div>

        <section aria-labelledby="reports-revenue-trend-heading" className={`p-6 ${CARD_SURFACE_CLASSES}`}>
          <h2 id="reports-revenue-trend-heading" className="text-text-primary text-base font-semibold">
            Paid revenue trend
          </h2>
          <p className="text-text-muted mt-1 text-sm">{periodLabel}</p>
          <div className="mt-4">
            <ReportsRevenueTrendChart trend={data.sections.revenueTrend} currency={currency} />
          </div>
        </section>

        <ReportsLeadPipeline snapshot={data.sections.leadPipeline} />

        <ReportsTopClientsTable topClients={data.sections.topClients} currency={currency} />

        <ReportsTimeByClientTable timeByClient={data.sections.timeByClient} />
      </div>
    </div>
  );
}
