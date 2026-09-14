import type { ReportsPeriodKey } from "./period";
import type { ReportsCurrencySelection } from "./currency";
import type { ReportsRevenueTrend } from "./calculations/revenue-trend";
import type { ReportsLeadPipelineSnapshot } from "./queries/leads";
import type { ReportsTopClient } from "./queries/financial";
import type { ReportsClientTime } from "./queries/time";

/**
 * Reports Phase 1 — the one typed view model getReportsOverview() (see
 * service.ts) returns. Every field here is a plain, already-shaped value
 * — no raw Prisma row (Client/Lead/Invoice/TimeEntry instances, Decimal
 * values) ever appears in this type, so a future Phase 2 UI can consume
 * it directly with no reshaping of its own. Deliberately does not
 * include any deferred-metric field (Quotes, Requests, Recurring
 * Invoices, Workflow runs, previous-period comparison, Clients-by-Tag,
 * historical Lead-stage trend) — see the approved Phase 1 scope.
 */
export type ReportsOverviewViewModel = {
  organizationId: string;
  period: ReportsPeriodKey;
  /** The exact half-open [start, end) window every period-scoped metric below was computed against — see period.ts. */
  range: { start: Date; end: Date };
  currency: ReportsCurrencySelection;

  overview: {
    /** Paid revenue: SUM(Invoice.amount), status=PAID, paidAt in range, selected currency only. PERIOD-SCOPED. Never call this generic "Revenue" — it is specifically the collected/paid figure, not invoiced or outstanding. */
    paidRevenue: number;
    /** Outstanding receivables: SUM(Invoice.amount), status IN (DRAFT,SENT,OVERDUE), selected currency only. CURRENT SNAPSHOT — deliberately NOT scoped to `range`; it always reflects what is owed right now, regardless of the selected period. */
    outstandingNow: number;
    /** COUNT(Lead) created in range — a historical creation-event count, not affected by current stage or later archiving. */
    newLeads: number;
    /** COUNT(Lead) with convertedAt in range — a historical conversion-event count. Not a rate, and not derived from stage=WON. */
    convertedLeads: number;
    /** COUNT(Client) created in range, exact organizationId match only (legacy null-organizationId rows never counted). */
    newClients: number;
    /** SUM(TimeEntry.durationMinutes), non-archived, workDate in range — every entry counts regardless of Project link. Integer minutes is the canonical value; a Phase 2 UI derives an hours display from this, not the other way around. */
    trackedMinutes: number;
  };

  sections: {
    /** PAID invoices only, bucketed by paidAt, selected currency only. See period.ts's own bucketUnit-per-preset mapping. */
    revenueTrend: ReportsRevenueTrend;
    /** CURRENT SNAPSHOT of Lead.stage right now — never a historical trend. Every canonical stage is present, zero-filled. */
    leadPipeline: ReportsLeadPipelineSnapshot;
    /** Top 5 Clients by paid revenue in range, selected currency only. */
    topClients: readonly ReportsTopClient[];
    /** Clients with tracked, non-archived time in range (TimeEntry -> Project -> Client). Excludes entries with no Project link — see queries/time.ts's own doc comment for why that's a deliberate difference from the Tracked hours KPI above. */
    timeByClient: readonly ReportsClientTime[];
  };
};
