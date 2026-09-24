import { formatCurrency } from "@/lib/format";
import { formatDashboardPeriodLabel, type DashboardBucketUnit, type DashboardPeriod } from "@/lib/dashboard/period";
import type { RevenueBucket } from "@/lib/dashboard/revenue";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";

const BAR_MAX_HEIGHT_PX = 160;

function formatBucketLabel(bucketStart: string, unit: DashboardBucketUnit): string {
  const iso = unit === "month" ? `${bucketStart}-01T00:00:00Z` : `${bucketStart}T00:00:00Z`;
  const date = new Date(iso);
  return unit === "month"
    ? date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Plain CSS bars — no chart library. Every bucket the query layer produced
 * (including zero-amount ones) gets a bar, so a quiet stretch never
 * collapses the series into something that looks broken. Labels below bars
 * are thinned out past ~14 buckets purely to avoid overlapping text; every
 * bar still carries its exact value via a screen-reader-only span and a
 * native `title` (hover), regardless of whether its label is visible.
 */
export function RevenueChart({
  buckets,
  bucketUnit,
  total,
  period,
  currency,
}: {
  buckets: RevenueBucket[];
  bucketUnit: DashboardBucketUnit;
  total: number;
  period: DashboardPeriod;
  /**
   * Dashboard Multi-Currency KPI Defect fix — the one currency `buckets`/
   * `total` were already scoped to by the query layer (never mixed), same
   * `string | null` contract src/components/reports/reports-revenue-trend-
   * chart.tsx already uses for its own identical `currency` prop. `null`
   * folds into the same empty state as `total === 0` below — there is
   * nothing to mislabel either way.
   */
  currency: string | null;
}) {
  const max = Math.max(...buckets.map((b) => b.amount), 1);
  const labelEvery = buckets.length <= 14 ? 1 : Math.ceil(buckets.length / 8);
  const isEmpty = total === 0 || currency === null;
  // Only ever read inside the `!isEmpty` branch below, where `currency` is
  // guaranteed non-null by the check above — this local avoids repeating a
  // non-null assertion at every formatCurrency call site.
  const resolvedCurrency = currency ?? "USD";

  return (
    <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-text-primary text-sm font-semibold">Revenue over time</h3>
        <p className="text-text-muted text-xs">{formatDashboardPeriodLabel(period)}</p>
      </div>
      <p className="text-text-primary mt-1 text-2xl font-semibold tracking-tight">
        {currency ? formatCurrency(total, currency) : "—"}
      </p>

      {isEmpty ? (
        <p className="text-text-muted mt-6 text-sm">No paid invoices in this period.</p>
      ) : (
        <div
          role="img"
          aria-label={`Paid revenue over ${formatDashboardPeriodLabel(period).toLowerCase()}, total ${formatCurrency(total, resolvedCurrency)}`}
          className="mt-6 flex items-end gap-0.5"
          style={{ height: BAR_MAX_HEIGHT_PX }}
        >
          {buckets.map((bucket, index) => {
            const heightPx = Math.max((bucket.amount / max) * BAR_MAX_HEIGHT_PX, bucket.amount > 0 ? 3 : 1);
            const showLabel = index % labelEvery === 0 || index === buckets.length - 1;
            const label = formatBucketLabel(bucket.bucketStart, bucketUnit);
            return (
              <div key={bucket.bucketStart} className="flex flex-1 flex-col items-center justify-end gap-1">
                <div
                  title={`${label}: ${formatCurrency(bucket.amount, resolvedCurrency)}`}
                  className={`w-full rounded-t ${bucket.amount > 0 ? "bg-accent" : "bg-border-default"}`}
                  style={{ height: heightPx }}
                >
                  <span className="sr-only">
                    {label}: {formatCurrency(bucket.amount, resolvedCurrency)}
                  </span>
                </div>
                {showLabel && (
                  <span aria-hidden="true" className="text-text-muted w-full truncate text-center text-[10px]">
                    {label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
