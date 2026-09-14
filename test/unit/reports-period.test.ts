import { describe, expect, it } from "vitest";
import { parseReportsPeriod, getReportsPeriodRange, DEFAULT_REPORTS_PERIOD } from "@/lib/reports/period";
import { FIXED_NOW } from "../support/fixtures";

describe("parseReportsPeriod", () => {
  it.each(["7d", "30d", "this_month", "last_month", "this_quarter", "this_year"] as const)("accepts %s", (period) => {
    expect(parseReportsPeriod(period)).toBe(period);
  });

  it("falls back to 30d for an invalid value", () => {
    expect(parseReportsPeriod("bogus")).toBe("30d");
    expect(parseReportsPeriod("bogus")).toBe(DEFAULT_REPORTS_PERIOD);
  });

  it("falls back to 30d for undefined", () => {
    expect(parseReportsPeriod(undefined)).toBe("30d");
  });

  it("falls back to 30d for an empty string", () => {
    expect(parseReportsPeriod("")).toBe("30d");
  });

  it("takes the first element of an array value", () => {
    expect(parseReportsPeriod(["this_year", "7d"])).toBe("this_year");
  });

  it("falls back to 30d for an empty array", () => {
    expect(parseReportsPeriod([])).toBe("30d");
  });

  it("rejects a Dashboard-only preset (90d/year are not valid Reports presets)", () => {
    expect(parseReportsPeriod("90d")).toBe("30d");
    expect(parseReportsPeriod("year")).toBe("30d");
  });
});

describe("getReportsPeriodRange — rolling windows", () => {
  it("7d: half-open window ending exactly at now", () => {
    const range = getReportsPeriodRange("7d", FIXED_NOW);
    expect(range.end).toBe(FIXED_NOW);
    expect(range.start.getTime()).toBe(FIXED_NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(range.bucketUnit).toBe("day");
  });

  it("30d: half-open window ending exactly at now", () => {
    const range = getReportsPeriodRange("30d", FIXED_NOW);
    expect(range.end).toBe(FIXED_NOW);
    expect(range.start.getTime()).toBe(FIXED_NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(range.bucketUnit).toBe("day");
  });

  it("always uses the caller-supplied now, never the real current time", () => {
    const arbitraryNow = new Date("2019-03-03T00:00:00.000Z");
    const range = getReportsPeriodRange("30d", arbitraryNow);
    expect(range.end).toBe(arbitraryNow);
    expect(range.start.toISOString()).toBe("2019-02-01T00:00:00.000Z");
  });
});

describe("getReportsPeriodRange — this_month / last_month", () => {
  it("this_month: first of the current UTC month (inclusive) to first of next month (exclusive)", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    const range = getReportsPeriodRange("this_month", now);
    expect(range.start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(range.bucketUnit).toBe("day");
  });

  it("last_month: first of the previous UTC month (inclusive) to first of this month (exclusive)", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    const range = getReportsPeriodRange("last_month", now);
    expect(range.start.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(range.bucketUnit).toBe("day");
  });

  it("last_month crosses a year boundary correctly when now is in January", () => {
    const now = new Date("2027-01-10T00:00:00.000Z");
    const range = getReportsPeriodRange("last_month", now);
    expect(range.start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("this_month at the very last instant of the month still resolves to that same month", () => {
    const now = new Date("2026-06-30T23:59:59.999Z");
    const range = getReportsPeriodRange("this_month", now);
    expect(range.start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("this_month/last_month handle a leap-year February correctly (end is always day 1 of the next month, never a hardcoded day count)", () => {
    const now = new Date("2028-02-20T00:00:00.000Z"); // 2028 is a leap year
    const thisMonth = getReportsPeriodRange("this_month", now);
    expect(thisMonth.start.toISOString()).toBe("2028-02-01T00:00:00.000Z");
    expect(thisMonth.end.toISOString()).toBe("2028-03-01T00:00:00.000Z");

    const lastMonthFromMarch = getReportsPeriodRange("last_month", new Date("2028-03-05T00:00:00.000Z"));
    expect(lastMonthFromMarch.start.toISOString()).toBe("2028-02-01T00:00:00.000Z");
    expect(lastMonthFromMarch.end.toISOString()).toBe("2028-03-01T00:00:00.000Z");
  });
});

describe("getReportsPeriodRange — this_quarter", () => {
  it.each([
    ["2026-01-15T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z"], // Q1
    ["2026-04-15T00:00:00.000Z", "2026-04-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z"], // Q2
    ["2026-08-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"], // Q3
    ["2026-11-30T00:00:00.000Z", "2026-10-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"], // Q4 -> crosses into next year
  ])("now=%s resolves to [%s, %s)", (nowIso, startIso, endIso) => {
    const range = getReportsPeriodRange("this_quarter", new Date(nowIso));
    expect(range.start.toISOString()).toBe(startIso);
    expect(range.end.toISOString()).toBe(endIso);
    expect(range.bucketUnit).toBe("week");
  });
});

describe("getReportsPeriodRange — this_year", () => {
  it("resolves to January 1st (inclusive) through January 1st of next year (exclusive), UTC", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    const range = getReportsPeriodRange("this_year", now);
    expect(range.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(range.bucketUnit).toBe("month");
  });

  it("still resolves to the current year even when now is Dec 31st", () => {
    const now = new Date("2026-12-31T23:59:59.999Z");
    const range = getReportsPeriodRange("this_year", now);
    expect(range.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("getReportsPeriodRange — half-open contract", () => {
  it("start is always strictly before end for every preset", () => {
    for (const period of ["7d", "30d", "this_month", "last_month", "this_quarter", "this_year"] as const) {
      const range = getReportsPeriodRange(period, FIXED_NOW);
      expect(range.start.getTime()).toBeLessThan(range.end.getTime());
    }
  });
});
