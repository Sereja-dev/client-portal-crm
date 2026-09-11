import { describe, expect, it, vi } from "vitest";

// generate.ts imports the real "server-only" marker package, which throws
// outside Next's own build — see test/unit/cron-auth.test.ts's own header
// comment for the identical precedent.
vi.mock("server-only", () => ({}));

import { isRecurringInvoiceDueToday } from "@/lib/recurring-invoices/generate";

/**
 * Recurring Invoices Phase 2A — the Staff UI's own "is this schedule due
 * today" eligibility check (test item 46's underlying logic), which the
 * detail page's Generate button visibility and generateDueInvoiceAction's
 * own server-side pre-check both call directly.
 */

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

describe("isRecurringInvoiceDueToday", () => {
  it("a past nextIssueDate is due", () => {
    expect(isRecurringInvoiceDueToday(utc(2027, 1, 1), utc(2027, 1, 15))).toBe(true);
  });
  it("today's own nextIssueDate is due", () => {
    expect(isRecurringInvoiceDueToday(utc(2027, 1, 15), utc(2027, 1, 15))).toBe(true);
  });
  it("a future nextIssueDate is not due", () => {
    expect(isRecurringInvoiceDueToday(utc(2027, 1, 16), utc(2027, 1, 15))).toBe(false);
  });
  it("ignores any time-of-day component on `now`", () => {
    const nowWithTime = new Date(Date.UTC(2027, 0, 15, 23, 59, 59));
    expect(isRecurringInvoiceDueToday(utc(2027, 1, 15), nowWithTime)).toBe(true);
  });
});
