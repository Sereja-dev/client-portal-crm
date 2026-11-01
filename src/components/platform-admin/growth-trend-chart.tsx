"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { GrowthTrendPoint } from "@/lib/platform-admin/queries/growth";

/**
 * Platform Admin Growth V1. Two-series line chart built on the same Recharts
 * setup and live CSS-token styling as components/analytics/charts/
 * growth-line-chart.tsx (that component is single-series and withholds
 * itself entirely when its total is zero, so it cannot draw this view). It
 * draws only points it is given — all bucketing happens server-side in
 * buildGrowthTrend().
 *
 * Zero-event days are real 0 points, so the timeline never collapses. Days
 * before signup recording began carry `signups: null`, which Recharts
 * renders as a gap: "no data", not "zero".
 */
export function GrowthTrendChart({ points }: { points: GrowthTrendPoint[] }) {
  const signupTotal = points.reduce((sum, p) => sum + (p.signups ?? 0), 0);
  const accountTotal = points.reduce((sum, p) => sum + p.accounts, 0);

  const data = points.map((p) => ({ label: p.date.slice(5), signups: p.signups, accounts: p.accounts }));

  return (
    <div
      role="img"
      aria-label={`Daily trend over ${points.length} UTC days: ${signupTotal} recorded signup identities and ${accountTotal} activated Staff accounts`}
      className="h-56 w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} accessibilityLayer margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
          <XAxis
            dataKey="label"
            interval="preserveStartEnd"
            minTickGap={24}
            tick={{ fontSize: 12, fill: "var(--text-muted)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border-default)" }}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} width={28} />
          <Tooltip
            cursor={{ stroke: "var(--border-default)" }}
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid var(--border-default)",
              backgroundColor: "var(--surface)",
              color: "var(--text-primary)",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="signups" name="First recorded signup identities" stroke="var(--accent)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} />
          <Line type="monotone" dataKey="accounts" name="Activated Staff accounts" stroke="var(--success)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
