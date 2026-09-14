import Link from "next/link";
import type { ReportsPeriodKey } from "@/lib/reports/period";
import type { ReportsCurrencySelection } from "@/lib/reports/currency";

/**
 * Reports Phase 2 — same plain `<Link>`-based, no-client-state pattern as
 * ReportsPeriodSelector. Three cases, per the approved Phase 2 scope:
 *
 * - Zero or one currency: rendering a selector with nothing meaningful to
 *   choose between is visual noise for no benefit — shows the resolved
 *   currency as a compact, non-interactive badge instead (or nothing at
 *   all when there is truly no currency to show). This never invents a
 *   selectable list, and never exposes any currency beyond what the
 *   already-tenant-scoped `availableCurrencies` (or the organization's
 *   own resolved default, for the zero-invoice case) already contains —
 *   there is structurally no way for another tenant's currency to reach
 *   this component, since it only ever renders what
 *   resolveReportsCurrency() (Phase 1) already computed.
 * - Two or more currencies: a real selector, one link per currency.
 *   Selecting a currency preserves the current period.
 */
export function ReportsCurrencySelector({ period, currency }: { period: ReportsPeriodKey; currency: ReportsCurrencySelection }) {
  if (currency.availableCurrencies.length < 2) {
    if (!currency.selectedCurrency) return null;
    return (
      <div>
        <span className="text-text-muted block text-xs font-medium">Currency</span>
        <span className="border-border-default bg-surface text-text-secondary mt-1 inline-flex items-center rounded-lg border px-3 py-1.5 text-sm font-medium">
          {currency.selectedCurrency}
        </span>
      </div>
    );
  }

  return (
    <div>
      <span id="reports-currency-label" className="text-text-muted block text-xs font-medium">
        Currency
      </span>
      <div
        role="group"
        aria-labelledby="reports-currency-label"
        className="border-border-default bg-surface mt-1 flex flex-wrap gap-1 rounded-lg border p-1"
      >
        {currency.availableCurrencies.map((code) => {
          const isActive = code === currency.selectedCurrency;
          const params = new URLSearchParams({ period, currency: code });
          return (
            <Link
              key={code}
              href={`/reports?${params.toString()}`}
              aria-current={isActive ? "true" : undefined}
              className={`focus-visible:ring-focus-ring rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                isActive ? "bg-accent text-white" : "text-text-secondary hover:bg-[var(--hover)]"
              }`}
            >
              {code}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
