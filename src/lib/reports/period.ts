/**
 * Reports Phase 1 — the shared Reports date-range model. Deliberately a
 * new, independent module rather than a reuse of
 * src/lib/dashboard/period.ts: Dashboard's own `DashboardPeriodRange` has
 * an INCLUSIVE `end` boundary (documented there as "always the `now`
 * passed in"), while this module uses a half-open `[start, end)` range —
 * `start` inclusive, `end` exclusive — per the approved Reports Phase 1
 * design (avoids end-of-day-millisecond hacks at every query call site).
 * These are two genuinely different contracts; silently reusing
 * Dashboard's inclusive-end type here would either subtly change
 * Dashboard's own tested behavior or produce a Reports module whose
 * boundary semantics quietly depend on a type it doesn't actually match.
 * Dashboard's own module and its existing tests are completely untouched
 * by this file.
 */

export const REPORTS_PERIODS = ["7d", "30d", "this_month", "last_month", "this_quarter", "this_year"] as const;
export type ReportsPeriodKey = (typeof REPORTS_PERIODS)[number];

export const DEFAULT_REPORTS_PERIOD: ReportsPeriodKey = "30d";

export const REPORTS_PERIOD_OPTIONS: readonly { value: ReportsPeriodKey; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "this_year", label: "This year" },
];

/**
 * Any value that isn't exactly one of the six known presets silently
 * falls back to `DEFAULT_REPORTS_PERIOD` — never an error, matching this
 * app's existing convention for a query-string-sourced enum-ish value
 * (e.g. dashboard/period.ts's own identical-shaped parseDashboardPeriod,
 * analytics/constants.ts's own parseTimeRangeParam). Untrusted input in,
 * a known-safe value out — this is the one place Reports code should
 * ever read a raw period string.
 */
export function parseReportsPeriod(value: string | string[] | undefined): ReportsPeriodKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return (REPORTS_PERIODS as readonly string[]).includes(raw ?? "")
    ? (raw as ReportsPeriodKey)
    : DEFAULT_REPORTS_PERIOD;
}

export type ReportsBucketUnit = "day" | "week" | "month";

export type ReportsPeriodRange = {
  period: ReportsPeriodKey;
  /** Inclusive lower bound, UTC. */
  start: Date;
  /**
   * EXCLUSIVE upper bound, UTC — half-open `[start, end)`. A row whose
   * timestamp equals `end` exactly is NOT included. See this module's
   * own header comment for why this deliberately differs from Dashboard's
   * own inclusive-end `DashboardPeriodRange`.
   */
  end: Date;
  bucketUnit: ReportsBucketUnit;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `Date.UTC` itself normalizes an out-of-range month index (negative or
 * >= 12) by rolling the year forward/back — e.g. `Date.UTC(2027, -1, 1)`
 * resolves to December 1, 2026, and `Date.UTC(2026, 12, 1)` resolves to
 * January 1, 2027. This is exactly what every calendar-aligned preset
 * below relies on for a December/January or Q4/Q1 transition: no
 * separate "did we cross a year boundary" branch is ever needed. Always
 * day 1, 00:00:00.000 UTC of the target month — jumping directly to the
 * first of a month (never adding "days in this month") is also what
 * makes leap-year February a non-issue: nothing here ever counts 28 vs.
 * 29 days, it only ever asks JS's own calendar math for "day 1 of month
 * N", which is unambiguous regardless of February's length.
 */
function utcMonthStart(year: number, monthIndex0: number): Date {
  return new Date(Date.UTC(year, monthIndex0, 1, 0, 0, 0, 0));
}

/**
 * Resolves the half-open `[start, end)` UTC window for a Reports period,
 * plus the bucket size its revenue trend should use. `now` is always a
 * caller-supplied parameter — this never calls `new Date()` itself — so
 * every query and every bucket boundary derived from one request (or one
 * test) uses exactly the same instant.
 *
 * `7d`/`30d` are rolling windows ending at `now` (`end` is exclusive and
 * equal to `now` itself — for a request-time rolling window this is
 * indistinguishable in practice from an inclusive `now`, since no real
 * row's timestamp can equal the exact instant this function ran; keeping
 * `end` exclusive here too means every preset shares one boundary
 * contract instead of two). `this_month`/`last_month`/`this_quarter`/
 * `this_year` are calendar-aligned to `now`'s own UTC calendar date —
 * this app does no per-user timezone handling anywhere today (see
 * dashboard/period.ts's own identical precedent), and this doesn't
 * introduce any: every boundary here is UTC.
 */
export function getReportsPeriodRange(period: ReportsPeriodKey, now: Date): ReportsPeriodRange {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based

  switch (period) {
    case "7d": {
      const start = new Date(now.getTime() - 7 * DAY_MS);
      return { period, start, end: now, bucketUnit: "day" };
    }
    case "30d": {
      const start = new Date(now.getTime() - 30 * DAY_MS);
      return { period, start, end: now, bucketUnit: "day" };
    }
    case "this_month": {
      const start = utcMonthStart(year, month);
      const end = utcMonthStart(year, month + 1);
      return { period, start, end, bucketUnit: "day" };
    }
    case "last_month": {
      const start = utcMonthStart(year, month - 1);
      const end = utcMonthStart(year, month);
      return { period, start, end, bucketUnit: "day" };
    }
    case "this_quarter": {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      const start = utcMonthStart(year, quarterStartMonth);
      const end = utcMonthStart(year, quarterStartMonth + 3);
      return { period, start, end, bucketUnit: "week" };
    }
    case "this_year": {
      const start = utcMonthStart(year, 0);
      const end = utcMonthStart(year + 1, 0);
      return { period, start, end, bucketUnit: "month" };
    }
  }
}
