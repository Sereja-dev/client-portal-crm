import type { ReportsPeriodKey } from "@/lib/reports/period";
import type { ReportsCurrencySelection } from "@/lib/reports/currency";
import { ReportsPeriodSelector } from "./reports-period-selector";
import { ReportsCurrencySelector } from "./reports-currency-selector";

export function ReportsHeader({ period, currency }: { period: ReportsPeriodKey; currency: ReportsCurrencySelection }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-text-muted mt-1 text-sm">Organization-level business reports, derived entirely from your own data.</p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <ReportsPeriodSelector period={period} currency={currency.selectedCurrency} />
        <ReportsCurrencySelector period={period} currency={currency} />
      </div>
    </div>
  );
}
