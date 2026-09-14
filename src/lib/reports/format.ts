import type { ReportsBucketUnit } from "./period";

/**
 * Reports Phase 2 — presentational-only formatting helpers. Neither
 * function here affects what data is fetched or how it's aggregated
 * (that's 100% server-side, in Phase 1's own query modules) — these only
 * format numbers/dates this page already has, matching the same
 * separation Analytics' own chart components (e.g. format-bucket-label.ts)
 * already establish.
 */

/**
 * Integer minutes -> a human-readable "Xh Ym" duration. Never converted
 * to money (TimeEntry has no rate field anywhere in this schema — see
 * queries/time.ts's own doc comment). Zero minutes renders as "0h 0m",
 * never blank, so a genuinely empty period still reads as a real,
 * intentional zero rather than missing data.
 */
export function formatTrackedDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

/**
 * A revenue-trend bucket's `bucketStart` ("YYYY-MM-DD" for day/week,
 * "YYYY-MM" for month — see calculations/revenue-trend.ts) -> a concise,
 * UTC-safe chart label. Mirrors src/components/dashboard/revenue-chart.tsx's
 * own local formatBucketLabel exactly (explicit `timeZone: "UTC"` on
 * every `toLocaleDateString` call) — a viewer outside UTC must never see
 * a UTC bucket rendered as if it were the previous calendar day, which is
 * exactly what omitting `timeZone: "UTC"` here would risk.
 */
export function formatRevenueTrendBucketLabel(bucketStart: string, unit: ReportsBucketUnit): string {
  const iso = unit === "month" ? `${bucketStart}-01T00:00:00Z` : `${bucketStart}T00:00:00Z`;
  const date = new Date(iso);
  return unit === "month"
    ? date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * V1's own documented limitation (see the approved Reports Phase 2
 * scope): `revenueTrend.points` is always zero-filled for every bucket
 * in the selected period by design (calculations/revenue-trend.ts), so
 * an all-zero series is structurally indistinguishable from "genuinely
 * zero paid revenue in every bucket" vs. "no PAID invoice rows existed
 * at all" — both produce the identical shape. A `some(point => amount
 * !== 0)` check is the simplest safe proxy for "is there anything to
 * actually chart" without adding a new backend field merely to
 * disambiguate a case that renders identically either way (an all-zero
 * chart) regardless of which one it technically is.
 */
export function hasRevenueTrendActivity(points: readonly { amount: number }[]): boolean {
  return points.some((point) => point.amount !== 0);
}
