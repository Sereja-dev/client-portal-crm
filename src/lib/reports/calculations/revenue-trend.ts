import type { ReportsBucketUnit, ReportsPeriodRange } from "../period";
import { toExactCents, centsToAmount } from "./money";

/**
 * Reports Phase 1 — pure bucketing for the Paid revenue trend section.
 * Deliberately independent of src/lib/dashboard/revenue.ts's own
 * bucketRevenue(): that function's bucket-generation loop is built around
 * an INCLUSIVE `range.end` (`ms <= endMs`); this module's own
 * ReportsPeriodRange has an EXCLUSIVE `end` (see period.ts's own header
 * comment for why), so the loop boundary itself has to be different, not
 * just the types. Small enough (day/week/month bucketing math) that a
 * second, independently-testable copy is safer and clearer than trying
 * to parameterize one shared function over two different range
 * contracts. Dashboard's own bucketRevenue/RevenueChart are completely
 * untouched.
 *
 * Pure function — no Prisma import, no I/O — takes exactly the rows the
 * caller already fetched for the Paid revenue KPI (see
 * queries/financial.ts's own getPaidInvoiceRows), so the KPI total and
 * this trend always come from one query, never two.
 */

export type ReportsPaidInvoiceRow = {
  /** Prisma.Decimal in production; a plain number is also accepted (tests). */
  amount: unknown;
  paidAt: Date;
};

export type ReportsRevenueTrendPoint = {
  /** UTC "YYYY-MM-DD" (day/week bucket) or "YYYY-MM" (month bucket). */
  bucketStart: string;
  amount: number;
};

export type ReportsRevenueTrend = {
  unit: ReportsBucketUnit;
  /** Ascending by bucketStart, including zero-amount buckets — a chart never silently collapses a quiet day/week/month. */
  points: ReportsRevenueTrendPoint[];
};

function utcDayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Monday-start week, computed from the UTC calendar day. */
function utcWeekStart(date: Date): number {
  const dayStart = utcDayStart(date);
  const dow = new Date(dayStart).getUTCDay(); // 0 = Sunday
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  return dayStart - daysSinceMonday * 24 * 60 * 60 * 1000;
}

function utcMonthStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function formatDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function formatMonthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

type BucketStrategy = {
  bucketStartMs: (date: Date) => number;
  nextMs: (ms: number) => number;
  formatKey: (ms: number) => string;
};

const BUCKET_STRATEGIES: Record<ReportsBucketUnit, BucketStrategy> = {
  day: { bucketStartMs: utcDayStart, nextMs: (ms) => ms + 24 * 60 * 60 * 1000, formatKey: formatDayKey },
  week: { bucketStartMs: utcWeekStart, nextMs: (ms) => ms + 7 * 24 * 60 * 60 * 1000, formatKey: formatDayKey },
  month: {
    bucketStartMs: utcMonthStart,
    nextMs: (ms) => {
      const d = new Date(ms);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    },
    formatKey: formatMonthKey,
  },
};

/**
 * Buckets already-fetched PAID/paidAt-not-null Invoice rows (single
 * currency — the caller's query is already currency-scoped, this
 * function never groups or filters by currency itself) into a time
 * series matching `range.bucketUnit`. Every bucket between `range.start`
 * and the last bucket actually inside `range.end` is present, even when
 * its amount is 0.
 *
 * `range.end` is exclusive (see period.ts) — the loop below stops at the
 * bucket containing `end - 1ms` (the last real instant inside the
 * period), never at the bucket containing `end` itself, so a period
 * whose `end` lands exactly on a bucket boundary (e.g. `this_month`'s
 * `end` is the 1st of next month) never grows a spurious trailing
 * bucket for an instant the period doesn't actually include.
 *
 * Cent-exactness (Phase 1 hardening audit): accumulates in exact integer
 * cents per bucket (see ./money.ts) — never repeated JS float addition of
 * Decimal amounts. Every row belongs to exactly one bucket (proved by
 * `range.start`/`range.end` already bounding every row, combined with
 * `bucketStartMs` being a monotonic floor function — see this function's
 * own `buckets.has(key)` guard below), so summing every bucket's own
 * exact cents total always equals the same grand total
 * queries/financial.ts's own summarizePaidRevenue() computes from the
 * identical row set — the KPI and this trend can never silently disagree.
 */
export function bucketReportsRevenue(rows: ReportsPaidInvoiceRow[], range: ReportsPeriodRange): ReportsRevenueTrend {
  const strategy = BUCKET_STRATEGIES[range.bucketUnit];

  const bucketCents = new Map<string, number>();
  const startMs = strategy.bucketStartMs(range.start);
  const lastIncludedInstant = new Date(range.end.getTime() - 1);
  const endMs = strategy.bucketStartMs(lastIncludedInstant);
  for (let ms = startMs; ms <= endMs; ms = strategy.nextMs(ms)) {
    bucketCents.set(strategy.formatKey(ms), 0);
  }

  for (const row of rows) {
    const cents = toExactCents(row.amount);
    const key = strategy.formatKey(strategy.bucketStartMs(row.paidAt));
    // A row's own bucket key is always within [startMs, endMs] since the
    // caller already filtered paidAt to [range.start, range.end) — but
    // guard against ever creating an extra bucket if that invariant is
    // ever violated by a future caller.
    if (bucketCents.has(key)) {
      bucketCents.set(key, (bucketCents.get(key) ?? 0) + cents);
    }
  }

  const points = Array.from(bucketCents.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bucketStart, cents]) => ({ bucketStart, amount: centsToAmount(cents) }));

  return { unit: range.bucketUnit, points };
}
