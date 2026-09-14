import { describe, expect, it } from "vitest";
import { bucketReportsRevenue } from "@/lib/reports/calculations/revenue-trend";
import type { ReportsPeriodRange } from "@/lib/reports/period";
import { decimal } from "../support/fixtures";

/** All ranges here use EXCLUSIVE `end`, matching src/lib/reports/period.ts's own half-open [start, end) contract — deliberately different from dashboard/revenue.ts's own inclusive-end test fixtures (test/unit/dashboard-revenue.test.ts), which this file does not reuse. */
function dayRange(start: string, endExclusive: string): ReportsPeriodRange {
  return { period: "30d", start: new Date(start), end: new Date(endExclusive), bucketUnit: "day" };
}

describe("bucketReportsRevenue", () => {
  it("creates zero-filled buckets for empty input", () => {
    const range = dayRange("2026-06-01T00:00:00.000Z", "2026-06-04T00:00:00.000Z"); // covers 06-01..06-03
    const result = bucketReportsRevenue([], range);
    expect(result.unit).toBe("day");
    expect(result.points).toEqual([
      { bucketStart: "2026-06-01", amount: 0 },
      { bucketStart: "2026-06-02", amount: 0 },
      { bucketStart: "2026-06-03", amount: 0 },
    ]);
  });

  it("buckets by day", () => {
    const range = dayRange("2026-06-01T00:00:00.000Z", "2026-06-03T00:00:00.000Z"); // covers 06-01..06-02
    const result = bucketReportsRevenue([{ amount: 100, paidAt: new Date("2026-06-01T15:00:00.000Z") }], range);
    expect(result.points).toEqual([
      { bucketStart: "2026-06-01", amount: 100 },
      { bucketStart: "2026-06-02", amount: 0 },
    ]);
  });

  it("buckets by month", () => {
    const range: ReportsPeriodRange = {
      period: "this_year",
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2026-04-01T00:00:00.000Z"), // exclusive -> covers Jan, Feb, Mar
      bucketUnit: "month",
    };
    const result = bucketReportsRevenue([{ amount: 500, paidAt: new Date("2026-02-14T00:00:00.000Z") }], range);
    expect(result.points).toEqual([
      { bucketStart: "2026-01", amount: 0 },
      { bucketStart: "2026-02", amount: 500 },
      { bucketStart: "2026-03", amount: 0 },
    ]);
  });

  it("buckets by week, aligned to Monday", () => {
    const range: ReportsPeriodRange = {
      period: "this_quarter",
      start: new Date("2026-06-08T00:00:00.000Z"), // a Monday
      end: new Date("2026-06-15T00:00:00.000Z"), // exclusive -> the following Monday, covers exactly one week bucket
      bucketUnit: "week",
    };
    const result = bucketReportsRevenue([], range);
    expect(result.points).toHaveLength(1);
    const bucketDate = new Date(`${result.points[0].bucketStart}T00:00:00.000Z`);
    expect(bucketDate.getUTCDay()).toBe(1); // Monday
  });

  it("assigns a mid-week row to its Monday-aligned week bucket", () => {
    const range: ReportsPeriodRange = {
      period: "this_quarter",
      start: new Date("2026-06-08T00:00:00.000Z"), // Monday
      end: new Date("2026-06-15T00:00:00.000Z"), // exclusive, following Monday
      bucketUnit: "week",
    };
    const result = bucketReportsRevenue([{ amount: 42, paidAt: new Date("2026-06-10T09:00:00.000Z") }], range);
    expect(result.points).toEqual([{ bucketStart: "2026-06-08", amount: 42 }]);
  });

  it("returns points in ascending order regardless of input row order", () => {
    const range = dayRange("2026-06-01T00:00:00.000Z", "2026-06-06T00:00:00.000Z"); // covers 06-01..06-05
    const result = bucketReportsRevenue(
      [
        { amount: 3, paidAt: new Date("2026-06-05T00:00:00.000Z") },
        { amount: 1, paidAt: new Date("2026-06-01T00:00:00.000Z") },
        { amount: 2, paidAt: new Date("2026-06-03T00:00:00.000Z") },
      ],
      range,
    );
    const keys = result.points.map((p) => p.bucketStart);
    expect(keys).toEqual([...keys].sort());
  });

  it("never produces duplicate bucket keys, even with multiple rows in the same bucket", () => {
    const range = dayRange("2026-06-01T00:00:00.000Z", "2026-06-02T00:00:00.000Z"); // covers only 06-01
    const result = bucketReportsRevenue(
      [
        { amount: 10, paidAt: new Date("2026-06-01T01:00:00.000Z") },
        { amount: 20, paidAt: new Date("2026-06-01T23:00:00.000Z") },
      ],
      range,
    );
    expect(result.points).toEqual([{ bucketStart: "2026-06-01", amount: 30 }]);
  });

  it("sums Prisma.Decimal amounts correctly", () => {
    const range = dayRange("2026-06-01T00:00:00.000Z", "2026-06-02T00:00:00.000Z");
    const result = bucketReportsRevenue(
      [
        { amount: decimal("10.50"), paidAt: new Date("2026-06-01T01:00:00.000Z") },
        { amount: decimal("5.25"), paidAt: new Date("2026-06-01T02:00:00.000Z") },
      ],
      range,
    );
    expect(result.points[0].amount).toBe(15.75);
  });

  it("cent-exact: multiple rows in the same bucket accumulate via exact integer cents, never repeated JS float addition", () => {
    // Classic floating-point failure case: 0.10 + 0.20 !== 0.3 under
    // plain JS addition. Proves the bucket accumulator itself (not just
    // summarizePaidRevenue) is hardened.
    const range = dayRange("2026-06-01T00:00:00.000Z", "2026-06-02T00:00:00.000Z");
    const result = bucketReportsRevenue(
      [
        { amount: decimal("0.10"), paidAt: new Date("2026-06-01T01:00:00.000Z") },
        { amount: decimal("0.20"), paidAt: new Date("2026-06-01T02:00:00.000Z") },
      ],
      range,
    );
    expect(result.points[0].amount).toBe(0.3);
  });

  it("cent-exact: one hundred 0.01 rows in the same bucket sum to exactly 1, not 1.0000000000000007", () => {
    const range = dayRange("2026-06-01T00:00:00.000Z", "2026-06-02T00:00:00.000Z");
    const rows = Array.from({ length: 100 }, () => ({ amount: decimal("0.01"), paidAt: new Date("2026-06-01T01:00:00.000Z") }));
    const result = bucketReportsRevenue(rows, range);
    expect(result.points[0].amount).toBe(1);
  });

  it("still ignores a row entirely outside the range rather than growing a spurious bucket for it", () => {
    const range = dayRange("2026-06-01T00:00:00.000Z", "2026-06-03T00:00:00.000Z"); // covers 06-01..06-02
    const result = bucketReportsRevenue(
      [
        { amount: 100, paidAt: new Date("2026-06-01T00:00:00.000Z") },
        { amount: 999, paidAt: new Date("2099-01-01T00:00:00.000Z") }, // far outside the range
      ],
      range,
    );
    expect(result.points).toEqual([
      { bucketStart: "2026-06-01", amount: 100 },
      { bucketStart: "2026-06-02", amount: 0 },
    ]);
    expect(result.points.some((p) => p.bucketStart.startsWith("2099"))).toBe(false);
  });

  it("half-open contract: a row landing exactly on `start` is included; a row landing exactly on `end` is excluded and produces no trailing bucket", () => {
    const range = dayRange("2026-06-01T00:00:00.000Z", "2026-06-03T00:00:00.000Z"); // covers 06-01..06-02, excludes 06-03
    const result = bucketReportsRevenue(
      [
        { amount: 1, paidAt: new Date("2026-06-01T00:00:00.000Z") }, // == start, included
        { amount: 999, paidAt: new Date("2026-06-03T00:00:00.000Z") }, // == end, excluded
      ],
      range,
    );
    expect(result.points).toEqual([
      { bucketStart: "2026-06-01", amount: 1 },
      { bucketStart: "2026-06-02", amount: 0 },
    ]);
    expect(result.points.some((p) => p.bucketStart === "2026-06-03")).toBe(false);
  });

  it("a period whose end lands exactly on a month boundary never grows a spurious trailing month bucket", () => {
    // this_month-shaped range: end is exactly midnight on the 1st of the next month.
    const range: ReportsPeriodRange = {
      period: "this_month",
      start: new Date("2026-06-01T00:00:00.000Z"),
      end: new Date("2026-07-01T00:00:00.000Z"),
      bucketUnit: "day",
    };
    const result = bucketReportsRevenue([{ amount: 50, paidAt: new Date("2026-06-30T23:59:59.999Z") }], range);
    expect(result.points[result.points.length - 1]).toEqual({ bucketStart: "2026-06-30", amount: 50 });
    expect(result.points.some((p) => p.bucketStart.startsWith("2026-07"))).toBe(false);
  });

  it("handles a leap-year month boundary (Feb 29) without error", () => {
    const range: ReportsPeriodRange = {
      period: "this_year",
      start: new Date("2028-01-15T00:00:00.000Z"),
      end: new Date("2028-04-01T00:00:00.000Z"), // exclusive -> covers Jan, Feb, Mar
      bucketUnit: "month",
    };
    const result = bucketReportsRevenue([{ amount: 77, paidAt: new Date("2028-02-29T00:00:00.000Z") }], range);
    expect(result.points).toEqual([
      { bucketStart: "2028-01", amount: 0 },
      { bucketStart: "2028-02", amount: 77 },
      { bucketStart: "2028-03", amount: 0 },
    ]);
  });
});
