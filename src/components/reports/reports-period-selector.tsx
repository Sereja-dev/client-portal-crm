import Link from "next/link";
import { REPORTS_PERIOD_OPTIONS, type ReportsPeriodKey } from "@/lib/reports/period";

/**
 * Reports Phase 2 — plain server-rendered `<Link>` elements to
 * `/reports?period=<value>&currency=<current>`, exactly like
 * src/components/analytics/analytics-range-selector.tsx's own precedent:
 * no client-side state, no `"use client"`, keyboard/screen-reader
 * reachable for free, survives a refresh (the URL is the whole state),
 * and degrades to a normal navigation with JS disabled. Changing the
 * period preserves whatever currency is currently selected (the task's
 * own explicit requirement) — the currently-selected currency, not
 * merely whatever was last in the URL, since this always reflects the
 * value the server just resolved (including a fallback from an invalid/
 * forged request).
 */
export function ReportsPeriodSelector({ period, currency }: { period: ReportsPeriodKey; currency: string | null }) {
  return (
    <div>
      <span id="reports-period-label" className="text-text-muted block text-xs font-medium">
        Period
      </span>
      <div
        role="group"
        aria-labelledby="reports-period-label"
        className="border-border-default bg-surface mt-1 flex flex-wrap gap-1 rounded-lg border p-1"
      >
        {REPORTS_PERIOD_OPTIONS.map((option) => {
          const isActive = option.value === period;
          const params = new URLSearchParams({ period: option.value });
          if (currency) params.set("currency", currency);
          return (
            <Link
              key={option.value}
              href={`/reports?${params.toString()}`}
              aria-current={isActive ? "true" : undefined}
              className={`focus-visible:ring-focus-ring rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                isActive ? "bg-accent text-white" : "text-text-secondary hover:bg-[var(--hover)]"
              }`}
            >
              {option.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
