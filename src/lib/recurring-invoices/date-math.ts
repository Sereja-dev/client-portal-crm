import type { RecurrenceFrequency } from "@/generated/prisma/enums";

/**
 * Recurring Invoices Phase 1 — the finalized month-end/anchor date-math
 * (readiness assessment + first correctness correction, this repo's own
 * PR history). Pure, no I/O, no Prisma import, no `new Date()` internally
 * — every function here is a deterministic function of its arguments,
 * unit-testable without faking the system clock (same discipline as
 * src/lib/invoices/lifecycle.ts's own computePaidAtUpdate()).
 *
 * Every Date in and out of this module is a date-only value — 00:00:00.000
 * UTC on a calendar date, the exact same persisted convention
 * src/lib/invoices/date-only.ts's parseDateOnly()/formatDateOnly()
 * establish — never a time-of-day scheduling concept, never a timezone
 * conversion of any kind. Organization.timezone exists in this schema but
 * is deliberately NOT read here (see the readiness assessment's own
 * answer to "what timezone should schedules use" — this app does no
 * per-user/per-org timezone handling anywhere today, and this module
 * doesn't introduce any).
 */

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** month is 1-indexed (January = 1). Leap years are handled explicitly, not merely delegated to Date's own arithmetic. */
export function daysInMonth(year: number, month: number): number {
  const DAYS_NON_LEAP = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return DAYS_NON_LEAP[month - 1];
}

function utcMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Advances `current` (a date-only value) by one recurrence step for
 * `frequency`, per the finalized algorithm:
 *
 *   WEEKLY:    current + 7 calendar days (no clamping, no anchorDay).
 *   MONTHLY:   +1 month; QUARTERLY: +3 months; YEARLY: +12 months —
 *     target (year, month) is derived from CURRENT's own (year, month)
 *     plus the step count; target day = min(anchorDay, daysInTargetMonth).
 *
 * `anchorDay` must be the ORIGINAL, never-recomputed anchor (see
 * RecurringInvoice.anchorDay's own schema comment) — deriving it instead
 * from `current`'s own (possibly already-clamped) day would silently lose
 * the anchor across a clamp (Jan 31 -> Feb 28 -> Mar 28 instead of the
 * required Mar 31). This function itself never reads `current.getUTCDate()`
 * for that reason — the caller-supplied `anchorDay` is the sole source of
 * the target day for every month-based frequency.
 */
export function computeNextIssueDate(current: Date, frequency: RecurrenceFrequency, anchorDay: number): Date {
  if (frequency === "WEEKLY") {
    return new Date(current.getTime() + WEEK_MS);
  }

  const step = frequency === "MONTHLY" ? 1 : frequency === "QUARTERLY" ? 3 : 12;

  const year = current.getUTCFullYear();
  const month = current.getUTCMonth() + 1; // 1-indexed

  const totalMonths = year * 12 + (month - 1) + step;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const targetDay = Math.min(anchorDay, daysInMonth(targetYear, targetMonth));

  return utcMidnight(targetYear, targetMonth, targetDay);
}

/** Derives the initial anchorDay from a schedule's first issue date — the ONLY place this value is ever computed from a Date; every subsequent advancement reuses the stored value unchanged. */
export function deriveAnchorDay(firstIssueDate: Date): number {
  return firstIssueDate.getUTCDate();
}

/**
 * Phase 2B-1 addition — purely additive. Strips the time-of-day component
 * off an injected `now`, returning the same UTC-midnight-of-calendar-date
 * representation every date-only value in this app uses. Exported so both
 * the due-batch job's own query filter and generate.ts's own
 * isRecurringInvoiceDueToday() (Phase 2A) share one implementation of
 * "today," rather than two independently-maintained copies of this exact
 * one-line computation.
 */
export function utcDateOnly(now: Date): Date {
  return utcMidnight(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
}
