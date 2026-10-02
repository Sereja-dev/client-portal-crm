import { getCurrentMembership } from "@/lib/current-user";
import { getCachedEffectivePermissionSet } from "@/lib/permissions/resolver";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import { FinanceCurrencySelector } from "@/components/finance/finance-currency-selector";
import { ReportsKpiCard } from "@/components/reports/reports-kpi-card";
import { formatCurrency } from "@/lib/format";
import { getFinanceOverview } from "./query";
import type { RawSearchParams } from "@/lib/list-params";

/**
 * Finance Overview V1 (Sub-block A) — the new canonical `/finance`
 * route: an at-a-glance operational Finance home (read-only audit §N/§34
 * Sub-block A). Access is ordinary organization membership, exactly like
 * every other Finance destination (`/invoices`, `/quotes`) — no new
 * permission is introduced, and this page is never OWNER-only.
 *
 * `currency` is read from the URL, never a cookie, matching Reports' own
 * identical convention — every currency choice stays shareable/
 * bookmarkable, never hidden client-only state. Every monetary KPI below
 * is already scoped to exactly one resolved currency by getFinanceOverview
 * itself (see ./query.ts) — this page never aggregates across currencies
 * and never performs FX.
 *
 * Draft invoices and Quotes awaiting approval are both organization-wide
 * counts, never money totals — their own card copy says so explicitly so
 * switching the currency selector never looks like it should (but
 * doesn't) change either number.
 */
export default async function FinanceOverviewPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const resolvedSearchParams = await searchParams;
  const { organizationId, membership } = await getCurrentMembership();

  const [overview, effectivePermissions] = await Promise.all([
    getFinanceOverview(organizationId, resolvedSearchParams.currency),
    getCachedEffectivePermissionSet(organizationId, membership.role),
  ]);

  const currency = overview.currency.selectedCurrency;
  const money = (amount: number) => (currency ? formatCurrency(amount, currency) : "—");

  return (
    <div>
      <FinanceTabs recurringInvoicesManage={effectivePermissions.RECURRING_INVOICES_MANAGE} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="text-text-secondary mt-1 text-sm">
            Where your money is: what&apos;s outstanding, what&apos;s overdue, what&apos;s been paid this month, and
            which documents still need attention.
          </p>
        </div>
        <FinanceCurrencySelector currency={overview.currency} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ReportsKpiCard label="Outstanding" value={money(overview.outstanding)} hint="Unpaid invoices, current snapshot" />
        <ReportsKpiCard label="Overdue" value={money(overview.overdue)} hint="Unpaid invoices past their due date" />
        <ReportsKpiCard label="Paid this month" value={money(overview.paidThisMonth)} hint="Invoices paid since the start of this month" />
        <ReportsKpiCard label="Draft invoices" value={overview.draftInvoiceCount} hint="Not yet sent — count, every currency" />
        <ReportsKpiCard
          label="Quotes awaiting approval"
          value={overview.quotesAwaitingApprovalCount}
          hint="Sent, not yet expired — count, every currency"
        />
      </div>
    </div>
  );
}
