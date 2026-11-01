"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WebsiteTrafficPoint } from "@/lib/platform-admin/queries/website-traffic";

/**
 * Website Traffic V1. Same Recharts setup and token styling as
 * growth-trend-chart.tsx. Draws only the points it is given. Days before
 * collection started carry null and render as a gap (no data), never as a
 * zero. "Daily visitors" is a per-UTC-day figure, not unique people.
 */
export function TrafficTrendChart({ points }: { points: WebsiteTrafficPoint[] }) {
  const pageViews = points.reduce((sum, p) => sum + (p.pageViews ?? 0), 0);
  const data = points.map((p) => ({ label: p.date.slice(5), visitors: p.visitors, pageViews: p.pageViews }));

  return (
    <div
      role="img"
      aria-label={`Daily website traffic over ${points.length} UTC days: ${pageViews} page views in total, with daily visitor counts per day`}
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
          <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} width={32} />
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
          <Line type="monotone" dataKey="visitors" name="Daily visitors" stroke="var(--accent)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} />
          <Line type="monotone" dataKey="pageViews" name="Page views" stroke="var(--success)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
