import { describe, expect, it } from "vitest";
import { computeNextIssueDate, daysInMonth, deriveAnchorDay } from "@/lib/recurring-invoices/date-math";

/**
 * Recurring Invoices Phase 1 — the finalized month-end/anchor date math
 * (test items 1-8). Pure functions, no DB needed. Every Date here is
 * constructed via Date.UTC directly (never a string parse) to keep these
 * tests independent of parseDateOnly's own coverage.
 */

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

describe("daysInMonth — explicit leap-year behavior", () => {
  it("February has 28 days in a non-leap year", () => {
    expect(daysInMonth(2027, 2)).toBe(28);
  });
  it("February has 29 days in a leap year", () => {
    expect(daysInMonth(2028, 2)).toBe(29);
  });
  it("a century year not divisible by 400 is NOT a leap year (2100)", () => {
    expect(daysInMonth(2100, 2)).toBe(28);
  });
  it("a century year divisible by 400 IS a leap year (2000)", () => {
    expect(daysInMonth(2000, 2)).toBe(29);
  });
});

describe("computeNextIssueDate — monthly", () => {
  it("1. Jan 31 -> Feb 28 (non-leap) -> Mar 31", () => {
    const feb = computeNextIssueDate(utc(2027, 1, 31), "MONTHLY", 31);
    expect(feb.getTime()).toBe(utc(2027, 2, 28).getTime());
    const mar = computeNextIssueDate(feb, "MONTHLY", 31);
    expect(mar.getTime()).toBe(utc(2027, 3, 31).getTime());
  });

  it("2. Jan 31 -> Feb 29 (leap) -> Mar 31", () => {
    const feb = computeNextIssueDate(utc(2028, 1, 31), "MONTHLY", 31);
    expect(feb.getTime()).toBe(utc(2028, 2, 29).getTime());
    const mar = computeNextIssueDate(feb, "MONTHLY", 31);
    expect(mar.getTime()).toBe(utc(2028, 3, 31).getTime());
  });

  it("3. Jan 30 -> Feb clamp -> Mar 30", () => {
    const feb = computeNextIssueDate(utc(2027, 1, 30), "MONTHLY", 30);
    expect(feb.getTime()).toBe(utc(2027, 2, 28).getTime());
    const mar = computeNextIssueDate(feb, "MONTHLY", 30);
    expect(mar.getTime()).toBe(utc(2027, 3, 30).getTime());
  });

  it("4. Jan 29 -> Feb 28 (non-leap) -> Mar 29", () => {
    const feb = computeNextIssueDate(utc(2027, 1, 29), "MONTHLY", 29);
    expect(feb.getTime()).toBe(utc(2027, 2, 28).getTime());
    const mar = computeNextIssueDate(feb, "MONTHLY", 29);
    expect(mar.getTime()).toBe(utc(2027, 3, 29).getTime());
  });

  it("5. anchor 15 stays 15 (never clamps)", () => {
    const feb = computeNextIssueDate(utc(2027, 1, 15), "MONTHLY", 15);
    expect(feb.getTime()).toBe(utc(2027, 2, 15).getTime());
    const mar = computeNextIssueDate(feb, "MONTHLY", 15);
    expect(mar.getTime()).toBe(utc(2027, 3, 15).getTime());
  });

  it("crosses a year boundary correctly (Dec -> Jan)", () => {
    const jan = computeNextIssueDate(utc(2027, 12, 31), "MONTHLY", 31);
    expect(jan.getTime()).toBe(utc(2028, 1, 31).getTime());
  });
});

describe("computeNextIssueDate — quarterly / yearly", () => {
  it("6. Jan 31 quarterly -> Apr 30 -> Jul 31", () => {
    const apr = computeNextIssueDate(utc(2027, 1, 31), "QUARTERLY", 31);
    expect(apr.getTime()).toBe(utc(2027, 4, 30).getTime());
    const jul = computeNextIssueDate(apr, "QUARTERLY", 31);
    expect(jul.getTime()).toBe(utc(2027, 7, 31).getTime());
  });

  it("7. Feb 29 yearly -> Feb 28 (next non-leap) -> Feb 29 (next leap)", () => {
    // 2028 is a leap year; 2029/2030/2031 are not; 2032 is.
    const y2029 = computeNextIssueDate(utc(2028, 2, 29), "YEARLY", 29);
    expect(y2029.getTime()).toBe(utc(2029, 2, 28).getTime());
    const y2030 = computeNextIssueDate(y2029, "YEARLY", 29);
    expect(y2030.getTime()).toBe(utc(2030, 2, 28).getTime());
    const y2031 = computeNextIssueDate(y2030, "YEARLY", 29);
    expect(y2031.getTime()).toBe(utc(2031, 2, 28).getTime());
    const y2032 = computeNextIssueDate(y2031, "YEARLY", 29);
    expect(y2032.getTime()).toBe(utc(2032, 2, 29).getTime());
  });
});

describe("8. computeNextIssueDate — weekly", () => {
  it("advances by exactly 7 calendar days, ignoring anchorDay entirely", () => {
    const next = computeNextIssueDate(utc(2027, 1, 28), "WEEKLY", 15);
    expect(next.getTime()).toBe(utc(2027, 2, 4).getTime());
  });

  it("crosses a month boundary correctly", () => {
    const next = computeNextIssueDate(utc(2027, 1, 29), "WEEKLY", 1);
    expect(next.getTime()).toBe(utc(2027, 2, 5).getTime());
  });
});

describe("deriveAnchorDay", () => {
  it("reads the UTC day-of-month", () => {
    expect(deriveAnchorDay(utc(2027, 3, 31))).toBe(31);
    expect(deriveAnchorDay(utc(2027, 3, 1))).toBe(1);
  });
});
