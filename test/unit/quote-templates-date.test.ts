import { describe, expect, it } from "vitest";
import { addValidityDays } from "@/lib/quote-templates/date";

describe("addValidityDays", () => {
  it("adds a simple number of days within the same month", () => {
    const result = addValidityDays(new Date("2026-06-01T00:00:00.000Z"), 10);
    expect(result.toISOString()).toBe("2026-06-11T00:00:00.000Z");
  });

  it("normalizes a basis Date carrying a time-of-day component before adding", () => {
    const result = addValidityDays(new Date("2026-06-01T15:42:07.123Z"), 1);
    expect(result.toISOString()).toBe("2026-06-02T00:00:00.000Z");
  });

  it("crosses a month boundary correctly", () => {
    const result = addValidityDays(new Date("2026-06-25T00:00:00.000Z"), 10);
    expect(result.toISOString()).toBe("2026-07-05T00:00:00.000Z");
  });

  it("crosses a year boundary correctly", () => {
    const result = addValidityDays(new Date("2026-12-28T00:00:00.000Z"), 10);
    expect(result.toISOString()).toBe("2027-01-07T00:00:00.000Z");
  });

  it("handles a leap-year February correctly", () => {
    // 2028 is a leap year -- Feb has 29 days.
    const result = addValidityDays(new Date("2028-02-20T00:00:00.000Z"), 10);
    expect(result.toISOString()).toBe("2028-03-01T00:00:00.000Z");
  });

  it("handles the maximum bound (3650 days, ~10 years) without error", () => {
    const result = addValidityDays(new Date("2026-01-01T00:00:00.000Z"), 3650);
    expect(result.getUTCFullYear()).toBe(2035);
  });

  it("adding 1 day is deterministic regardless of the basis's own time-of-day", () => {
    const morning = addValidityDays(new Date("2026-06-01T00:00:01.000Z"), 1);
    const night = addValidityDays(new Date("2026-06-01T23:59:59.999Z"), 1);
    expect(morning.toISOString()).toBe(night.toISOString());
  });
});
