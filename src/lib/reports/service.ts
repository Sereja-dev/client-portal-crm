import "server-only";
import { getCurrentMembership } from "@/lib/current-user";
import { assertCanViewReports } from "./authorization";
import { getReportsPeriodRange, parseReportsPeriod } from "./period";
import { resolveReportsCurrency } from "./currency";
import { getPaidInvoiceRows, summarizePaidRevenue, getOutstandingNow, getTopClientsByPaidRevenue } from "./queries/financial";
import { bucketReportsRevenue } from "./calculations/revenue-trend";
import { getNewLeadsCount, getConvertedLeadsCount, getLeadPipelineSnapshot } from "./queries/leads";
import { getNewClientsCount } from "./queries/clients";
import { getTrackedMinutes, getTimeByClient } from "./queries/time";
import type { ReportsOverviewViewModel } from "./types";
import type { ReportsTopClient } from "./queries/financial";
import type { ReportsPaidInvoiceRow } from "./calculations/revenue-trend";

/**
 * Reports Phase 1 — the one public entry point for the whole domain.
 * Every future Reports page/action calls this, never a query file
 * directly, so the OWNER/ADMIN authorization check can never be
 * forgotten at a call site — mirrors
 * src/lib/analytics/services/analytics-service.ts's own
 * getOrganizationAnalytics() "one guarded entry point per read"
 * discipline exactly.
 *
 * Resolves membership/organizationId itself (via getCurrentMembership())
 * rather than accepting it as a parameter — deliberately different from
 * dashboard/query.ts's getDashboardAnalytics(), which accepts an
 * already-resolved organizationId because its own caller (the Dashboard
 * page) resolves it first. Reports Phase 1 has no page yet, so this
 * function IS the whole server boundary for now: organizationId is never
 * accepted from a caller/searchParams anywhere in this module, and
 * authorization is enforced HERE, not left for a future page to enforce
 * by hiding a link.
 *
 * `now` defaults to `new Date()` but is always accepted as a parameter so
 * tests get one deterministic instant shared by the period range and
 * every query derived from it.
 *
 * Query count for one call (all independent, no query depends on
 * another's result, no per-row follow-up query, matching
 * dashboard/query.ts's own established shape): getCurrentMembership (2:
 * user/org resolution + membership lookup) + resolveReportsCurrency (2:
 * distinct currencies + company profile) + getPaidInvoiceRows (1) +
 * getOutstandingNow (1) + getTopClientsByPaidRevenue (2: groupBy +
 * findMany) + getNewLeadsCount (1) + getConvertedLeadsCount (1) +
 * getLeadPipelineSnapshot (2: groupBy + aggregate) + getNewClientsCount
 * (1) + getTrackedMinutes (1) + getTimeByClient (2: groupBy + findMany)
 * — roughly 16 bounded aggregate/groupBy/findMany queries, zero of which
 * scale with row count beyond their own indexed WHERE clause, zero raw
 * SQL, zero N+1.
 */
export async function getReportsOverview({
  requestedPeriod,
  requestedCurrency,
  now = new Date(),
}: {
  requestedPeriod?: string | string[];
  requestedCurrency?: string | string[];
  now?: Date;
} = {}): Promise<ReportsOverviewViewModel> {
  const { organizationId, membership } = await getCurrentMembership();
  assertCanViewReports(membership.role);

  const period = parseReportsPeriod(requestedPeriod);
  const range = getReportsPeriodRange(period, now);
  const currencySelection = await resolveReportsCurrency(organizationId, requestedCurrency);
  const currency = currencySelection.selectedCurrency;

  // No invoice of any currency exists yet for this organization —
  // every currency-scoped financial query below would just be an
  // expensive way to compute zero/empty, so they're skipped outright.
  // Lead/Client/Time metrics are completely currency-independent and
  // still run normally regardless.
  const financialPromise: Promise<[ReportsPaidInvoiceRow[], number, ReportsTopClient[]]> = currency
    ? Promise.all([
        getPaidInvoiceRows(organizationId, currency, range),
        getOutstandingNow(organizationId, currency),
        getTopClientsByPaidRevenue(organizationId, currency, range),
      ])
    : Promise.resolve([[], 0, []]);

  const [[paidInvoiceRows, outstandingNow, topClients], newLeads, convertedLeads, leadPipeline, newClients, trackedMinutes, timeByClient] =
    await Promise.all([
      financialPromise,
      getNewLeadsCount(organizationId, range),
      getConvertedLeadsCount(organizationId, range),
      getLeadPipelineSnapshot(organizationId),
      getNewClientsCount(organizationId, range),
      getTrackedMinutes(organizationId, range),
      getTimeByClient(organizationId, range),
    ]);

  const { paidRevenue } = summarizePaidRevenue(paidInvoiceRows);
  const revenueTrend = bucketReportsRevenue(paidInvoiceRows, range);

  return {
    organizationId,
    period,
    range: { start: range.start, end: range.end },
    currency: currencySelection,
    overview: {
      paidRevenue,
      outstandingNow,
      newLeads,
      convertedLeads,
      newClients,
      trackedMinutes,
    },
    sections: {
      revenueTrend,
      leadPipeline,
      topClients,
      timeByClient,
    },
  };
}
