import "server-only";
import { prisma } from "@/lib/prisma";
import { resolveReportsCurrency, type ReportsCurrencySelection } from "@/lib/reports/currency";
import { getOutstandingNow, getPaidInvoiceRows, summarizePaidRevenue } from "@/lib/reports/queries/financial";
import { getReportsPeriodRange } from "@/lib/reports/period";

/**
 * Finance Overview V1 (read-only audit §N/§P, Sub-block A). The one query
 * module behind `/finance` — every monetary figure here is scoped to
 * exactly one resolved currency, reusing the same already-tested
 * primitives Reports V1 already ships (`resolveReportsCurrency`,
 * `getOutstandingNow`, `getPaidInvoiceRows`/`summarizePaidRevenue`,
 * `getReportsPeriodRange`), never a second, parallel currency-resolution
 * or money-math implementation. No function here ever aggregates
 * `Invoice.amount` across more than one `currency` value at once, and no
 * FX conversion exists or is ever performed.
 *
 * Draft invoice count and Quotes-awaiting-approval count are deliberately
 * NOT currency-scoped — both are organization-wide operational workload
 * counts, never a money total, so the page's own currency selector must
 * never appear to affect them (see financeOverviewPage's own doc comment
 * for how that's communicated in the UI).
 */

/**
 * The operational "needs attention" overdue definition, identical to
 * dashboard/query.ts's own `NEEDS_ATTENTION_OVERDUE_INVOICE_STATUSES`:
 * deliberately broader than the persisted OVERDUE status alone — OVERDUE
 * is manually maintained by Staff and cannot alone represent operational
 * lateness. SENT or OVERDUE, past due. DRAFT is excluded (no real due-date
 * commitment yet); PAID/CANCELLED are excluded (nothing outstanding).
 */
const OPERATIONALLY_OVERDUE_INVOICE_STATUSES = ["SENT", "OVERDUE"] as const;

export type FinanceOverview = {
  currency: ReportsCurrencySelection;
  /** Money amount, in `currency.selectedCurrency`, or 0 when there is no selected currency (a brand-new organization with zero invoices). */
  outstanding: number;
  /** Money amount, in `currency.selectedCurrency`, or 0 when there is no selected currency. */
  overdue: number;
  /** Money amount, in `currency.selectedCurrency`, or 0 when there is no selected currency. */
  paidThisMonth: number;
  /** Organization-wide count, independent of the selected currency. */
  draftInvoiceCount: number;
  /** Organization-wide count, independent of the selected currency. */
  quotesAwaitingApprovalCount: number;
};

/**
 * No existing Reports helper sums Invoice.amount under the operational
 * overdue predicate (dashboard/query.ts's own identical predicate only
 * ever COUNTS/lists overdue invoices for its "Needs Attention" widget,
 * never sums a money total) — mirrors getOutstandingNow's own exact
 * shape (DB-side Decimal SUM, converted to a JS number exactly once) for
 * the one genuinely new query this sub-block needs, per the read-only
 * audit's own §9 instruction to mirror the predicate locally rather than
 * expand Reports' own scope.
 */
async function getOverdueNow(organizationId: string, currency: string, now: Date): Promise<number> {
  const result = await prisma.invoice.aggregate({
    where: {
      organizationId,
      currency,
      status: { in: [...OPERATIONALLY_OVERDUE_INVOICE_STATUSES] },
      dueDate: { lt: now },
    },
    _sum: { amount: true },
  });
  return Number(result._sum.amount ?? 0);
}

async function getDraftInvoiceCount(organizationId: string): Promise<number> {
  return prisma.invoice.count({ where: { organizationId, status: "DRAFT" } });
}

/**
 * "Awaiting approval" is derived, mirroring src/lib/quotes/status.ts's
 * own isQuoteExpired() predicate exactly (never re-invented): a Quote
 * counts only while it is SENT, not archived, and not expired
 * (validUntil is either unset or still in the future). DRAFT/APPROVED/
 * DECLINED never qualify; neither does an expired or archived SENT Quote.
 */
async function getQuotesAwaitingApprovalCount(organizationId: string, now: Date): Promise<number> {
  return prisma.quote.count({
    where: {
      organizationId,
      status: "SENT",
      archivedAt: null,
      OR: [{ validUntil: null }, { validUntil: { gte: now } }],
    },
  });
}

/**
 * `now` is an explicit, optional, injected parameter — defaulting to a
 * fresh `new Date()` only here, at this one outer boundary — never read
 * from module state inside any helper above. Matches this codebase's own
 * established determinism/testability discipline (e.g. src/lib/invoices/
 * lifecycle.ts's own computePaidAtUpdate(), src/lib/quotes/status.ts's
 * own isQuoteExpired()): every date-sensitive boundary (Overdue's
 * `dueDate < now`, Paid-this-month's UTC month window, Quotes-awaiting-
 * approval's `validUntil >= now`) is exercised deterministically in
 * tests by passing a fixed `now`, never the wall clock.
 */
export async function getFinanceOverview(
  organizationId: string,
  requestedCurrency: string | string[] | undefined,
  now: Date = new Date(),
): Promise<FinanceOverview> {
  const currency = await resolveReportsCurrency(organizationId, requestedCurrency);
  const selected = currency.selectedCurrency;

  const [outstanding, overdue, paidRows, draftInvoiceCount, quotesAwaitingApprovalCount] = await Promise.all([
    selected ? getOutstandingNow(organizationId, selected) : Promise.resolve(0),
    selected ? getOverdueNow(organizationId, selected, now) : Promise.resolve(0),
    selected ? getPaidInvoiceRows(organizationId, selected, getReportsPeriodRange("this_month", now)) : Promise.resolve([]),
    getDraftInvoiceCount(organizationId),
    getQuotesAwaitingApprovalCount(organizationId, now),
  ]);

  const { paidRevenue } = summarizePaidRevenue(paidRows);

  return {
    currency,
    outstanding,
    overdue,
    paidThisMonth: paidRevenue,
    draftInvoiceCount,
    quotesAwaitingApprovalCount,
  };
}
