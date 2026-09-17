import { describe, expect, it } from "vitest";
import { buildMonthGrid, formatMonthLabel, shiftMonth } from "@/lib/calendar-events/month-grid";

function dateStrings(grid: ReturnType<typeof buildMonthGrid>): string[] {
  return grid.map((d) => d.date.toISOString().slice(0, 10));
}

describe("buildMonthGrid", () => {
  it("28-day month (Feb 2026, non-leap) -- month starts Sunday, fits exactly 4 weeks with trailing spillover", () => {
    // Feb 1 2026 is a Sunday.
    const grid = buildMonthGrid(2026, 2, 0);
    expect(grid.length % 7).toBe(0);
    expect(grid[0].date.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(grid[0].isCurrentMonth).toBe(true);
    const currentMonthDays = grid.filter((d) => d.isCurrentMonth);
    expect(currentMonthDays).toHaveLength(28);
    expect(currentMonthDays[27].date.toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("29-day month (Feb 2028, leap year)", () => {
    const grid = buildMonthGrid(2028, 2, 0);
    const currentMonthDays = grid.filter((d) => d.isCurrentMonth);
    expect(currentMonthDays).toHaveLength(29);
    expect(currentMonthDays[28].date.toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  it("30-day month (April 2026)", () => {
    const grid = buildMonthGrid(2026, 4, 0);
    const currentMonthDays = grid.filter((d) => d.isCurrentMonth);
    expect(currentMonthDays).toHaveLength(30);
    expect(currentMonthDays[29].date.toISOString().slice(0, 10)).toBe("2026-04-30");
  });

  it("31-day month (January 2026)", () => {
    const grid = buildMonthGrid(2026, 1, 0);
    const currentMonthDays = grid.filter((d) => d.isCurrentMonth);
    expect(currentMonthDays).toHaveLength(31);
    expect(currentMonthDays[30].date.toISOString().slice(0, 10)).toBe("2026-01-31");
  });

  it("month starting on Sunday needs no leading spillover (Sunday-start grid)", () => {
    // Feb 1 2026 is a Sunday.
    const grid = buildMonthGrid(2026, 2, 0);
    expect(grid[0].date.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(grid[0].isCurrentMonth).toBe(true);
  });

  it("month starting mid-week needs leading spillover from the previous month (March 2026 starts on a Sunday too -- use a month that doesn't)", () => {
    // June 1 2026 is a Monday.
    const grid = buildMonthGrid(2026, 6, 0);
    // Sunday-start grid: the leading cell is Sunday May 31, spillover.
    expect(grid[0].date.toISOString().slice(0, 10)).toBe("2026-05-31");
    expect(grid[0].isCurrentMonth).toBe(false);
    expect(grid[1].date.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(grid[1].isCurrentMonth).toBe(true);
  });

  it("Monday-start convention shifts the same month's leading spillover accordingly", () => {
    // June 1 2026 is a Monday -- with weekStartsOn=1, no leading spillover at all.
    const grid = buildMonthGrid(2026, 6, 1);
    expect(grid[0].date.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(grid[0].isCurrentMonth).toBe(true);
  });

  it("trailing spillover fills the final week with the next month's own leading days", () => {
    const grid = buildMonthGrid(2026, 6, 0);
    const last = grid[grid.length - 1];
    expect(last.isCurrentMonth).toBe(false);
    // June 2026 has 30 days, starting Monday -- the grid should spill
    // into July to complete its final week.
    expect(last.date.getTime()).toBeGreaterThan(new Date("2026-06-30T00:00:00.000Z").getTime());
  });

  it("every cell is a distinct, consecutive UTC calendar day with no gap or duplicate", () => {
    const grid = buildMonthGrid(2026, 9, 0);
    const strings = dateStrings(grid);
    for (let i = 1; i < strings.length; i++) {
      const prev = new Date(strings[i - 1] + "T00:00:00.000Z").getTime();
      const cur = new Date(strings[i] + "T00:00:00.000Z").getTime();
      expect(cur - prev).toBe(24 * 60 * 60 * 1000);
    }
  });

  it("the grid is always a whole number of weeks, never a partial week (28 only in the rare case a 28-day month starts exactly on the week-start day, as Feb 2026 does)", () => {
    for (let month = 1; month <= 12; month++) {
      const grid = buildMonthGrid(2026, month, 0);
      expect(grid.length % 7).toBe(0);
      expect([28, 35, 42]).toContain(grid.length);
    }
  });
});

describe("formatMonthLabel", () => {
  it("renders a stable 'Month Year' label, pinned to UTC regardless of caller locale/timezone", () => {
    expect(formatMonthLabel(2026, 3, "en-US")).toBe("March 2026");
    expect(formatMonthLabel(2026, 12, "en-US")).toBe("December 2026");
  });
});

describe("shiftMonth", () => {
  it("steps forward within a year", () => {
    expect(shiftMonth(2026, 3, 1)).toEqual({ year: 2026, month: 4 });
  });

  it("steps backward within a year", () => {
    expect(shiftMonth(2026, 3, -1)).toEqual({ year: 2026, month: 2 });
  });

  it("rolls forward across a year boundary", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });

  it("rolls backward across a year boundary", () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
});
