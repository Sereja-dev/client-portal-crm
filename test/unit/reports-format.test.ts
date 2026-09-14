import { describe, expect, it } from "vitest";
import { formatTrackedDuration, formatRevenueTrendBucketLabel, hasRevenueTrendActivity } from "@/lib/reports/format";

describe("formatTrackedDuration", () => {
  it("formats a mixed hours+minutes duration", () => {
    expect(formatTrackedDuration(32 * 60 + 15)).toBe("32h 15m");
  });

  it("formats exactly zero as a real, explicit zero", () => {
    expect(formatTrackedDuration(0)).toBe("0h 0m");
  });

  it("formats under an hour", () => {
    expect(formatTrackedDuration(45)).toBe("0h 45m");
  });

  it("formats an exact number of hours", () => {
    expect(formatTrackedDuration(120)).toBe("2h 0m");
  });
});

describe("formatRevenueTrendBucketLabel — UTC-safe", () => {
  it("formats a day bucket without shifting to the previous calendar date outside UTC", () => {
    // The classic failure mode: a bucket labeled "2026-06-01" must never
    // render as "May 31" just because the reader's system timezone is
    // behind UTC. Explicit timeZone: "UTC" in the implementation is what
    // this test actually proves held.
    expect(formatRevenueTrendBucketLabel("2026-06-01", "day")).toBe("Jun 1");
  });

  it("formats a week bucket the same way as a day bucket (both are 'YYYY-MM-DD' shaped)", () => {
    expect(formatRevenueTrendBucketLabel("2026-06-08", "week")).toBe("Jun 8");
  });

  it("formats a month bucket", () => {
    expect(formatRevenueTrendBucketLabel("2026-06", "month")).toBe("Jun 2026");
  });

  it("does not shift a month-start day bucket at the year boundary", () => {
    expect(formatRevenueTrendBucketLabel("2027-01-01", "day")).toBe("Jan 1");
  });
});

describe("hasRevenueTrendActivity", () => {
  it("is false for an all-zero series", () => {
    expect(hasRevenueTrendActivity([{ amount: 0 }, { amount: 0 }])).toBe(false);
  });

  it("is false for an empty series", () => {
    expect(hasRevenueTrendActivity([])).toBe(false);
  });

  it("is true when at least one bucket has a non-zero amount", () => {
    expect(hasRevenueTrendActivity([{ amount: 0 }, { amount: 12.5 }])).toBe(true);
  });
});
