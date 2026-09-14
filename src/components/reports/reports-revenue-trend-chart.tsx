"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { formatCurrency } from "@/lib/format";
import { formatRevenueTrendBucketLabel, hasRevenueTrendActivity } from "@/lib/reports/format";
import type { ReportsRevenueTrend } from "@/lib/reports/calculations/revenue-trend";

/**
 * Reports Phase 2 — Client Component (Recharts needs the DOM/canvas, same
 * reasoning as every chart in src/components/analytics/charts/), fed
 * data this page already fetched server-side (getReportsOverview) — this
 * component only ever formats and draws points it's given; it never
 * fetches, sums, or buckets anything itself, and never mixes currencies
 * (the whole `trend` it receives was already computed for exactly one
 * selected currency by Phase 1). No previous-period overlay, no fake
 * growth-percentage badge — the approved Phase 2 scope explicitly
 * excludes both.
 */
export function ReportsRevenueTrendChart({ trend, currency }: { trend: ReportsRevenueTrend; currency: string | null }) {
  if (!currency || !hasRevenueTrendActivity(trend.points)) {
    return (
      <div className="border-border-default bg-surface flex h-56 w-full flex-col items-center justify-center rounded-md border border-dashed text-center">
        <p className="text-text-muted text-sm">No paid invoices in this period.</p>
      </div>
    );
  }

  const data = trend.points.map((point) => ({ label: formatRevenueTrendBucketLabel(point.bucketStart, trend.unit), amount: point.amount }));
  const total = trend.points.reduce((sum, point) => sum + point.amount, 0);

  return (
    <div role="img" aria-label={`Paid revenue trend, total ${formatCurrency(total, currency)}`} className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} accessibilityLayer margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--text-muted)" }} tickLine={false} axisLine={{ stroke: "var(--border-default)" }} />
          <YAxis
            tickFormatter={(value: number) => formatCurrency(value, currency)}
            tick={{ fontSize: 12, fill: "var(--text-muted)" }}
            tickLine={false}
            axisLine={false}
            width={72}
          />
          <Tooltip
            formatter={(value) => [formatCurrency(Number(value), currency), "Paid revenue"]}
            cursor={{ stroke: "var(--border-default)" }}
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid var(--border-default)",
              backgroundColor: "var(--surface)",
              color: "var(--text-primary)",
            }}
          />
          <Line type="monotone" dataKey="amount" name="Paid revenue" stroke="var(--accent)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
