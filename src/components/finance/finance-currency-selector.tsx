import Link from "next/link";
import type { ReportsCurrencySelection } from "@/lib/reports/currency";

/**
 * Finance Overview V1 (Sub-block A) — a narrow mirror of
 * src/components/reports/reports-currency-selector.tsx's own exact shape
 * and behavior, not a direct reuse: that component's own `<Link>` href is
 * hardcoded to `/reports` and bundled with a `period` query param Finance
 * Overview has no equivalent of, so reusing it as-is would either point
 * Finance's own selector at the wrong route or require threading a fake
 * period value through just to satisfy its props. The underlying logic
 * this wraps — `resolveReportsCurrency()` — is reused completely
 * unmodified (see finance/query.ts); only this thin, `/finance`-specific
 * presentational shell is new.
 *
 * Same three cases as Reports' own selector: zero selectable currency
 * (nothing rendered), exactly one (a compact non-interactive badge, no
 * selector with nothing meaningful to choose between), two or more (a
 * real `<Link>`-per-currency selector — never client-only state, so every
 * currency choice stays shareable/bookmarkable).
 */
export function FinanceCurrencySelector({ currency }: { currency: ReportsCurrencySelection }) {
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
      <span id="finance-currency-label" className="text-text-muted block text-xs font-medium">
        Currency
      </span>
      <div
        role="group"
        aria-labelledby="finance-currency-label"
        className="border-border-default bg-surface mt-1 flex flex-wrap gap-1 rounded-lg border p-1"
      >
        {currency.availableCurrencies.map((code) => {
          const isActive = code === currency.selectedCurrency;
          return (
            <Link
              key={code}
              href={`/finance?currency=${code}`}
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
