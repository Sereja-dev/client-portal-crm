/**
 * Calendar V1 — Month view's own pure grid-generation math. No I/O, no
 * `new Date()` internally (every date is derived from the injected
 * `year`/`month` arguments alone, matching src/lib/recurring-invoices/
 * date-math.ts's own determinism discipline), and no calendar library —
 * built in-house per locked architecture §18.
 *
 * Every date produced here is a plain UTC-midnight `Date` representing a
 * calendar day, following the exact same date-only convention
 * src/lib/invoices/date-only.ts already established — this module has
 * nothing to do with timed CalendarEvents' own wall-clock/timezone
 * resolution (see calendar-events/timezone.ts); it only needs to know
 * which calendar day is which, never a time-of-day.
 */

export type MonthGridDay = {
  /** UTC midnight for this calendar day. */
  date: Date;
  /** false for the leading/trailing spillover days from the adjacent month, needed only to fill out complete weeks. */
  isCurrentMonth: boolean;
};

function utcMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the *next* month is the last day of *this* one — JS's own
  // Date arithmetic already handles every month-length/leap-year case
  // correctly via this well-known trick, needing no hand-written table.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Builds one Month view's complete 7-column grid, always a whole number
 * of full weeks (5 or 6 rows -- never a partial week), including leading/
 * trailing days from the adjacent month so every week is complete.
 * `weekStartsOn` 0 = Sunday, 1 = Monday (this app has no prior calendar-
 * grid convention to match; 0/Sunday is the default, matching the
 * `Intl`/`Date.getUTCDay()` platform convention that already numbers
 * Sunday as 0 with no extra mapping needed).
 */
export function buildMonthGrid(year: number, month: number, weekStartsOn: 0 | 1 = 0): MonthGridDay[] {
  const firstOfMonth = utcMidnight(year, month, 1);
  const firstWeekday = firstOfMonth.getUTCDay(); // 0=Sun .. 6=Sat
  const leadingSpillover = (firstWeekday - weekStartsOn + 7) % 7;

  const totalDaysInMonth = daysInMonth(year, month);
  const totalCells = Math.ceil((leadingSpillover + totalDaysInMonth) / 7) * 7;

  const days: MonthGridDay[] = [];
  for (let i = 0; i < totalCells; i++) {
    const dayOffset = i - leadingSpillover + 1;
    const date = new Date(firstOfMonth);
    date.setUTCDate(dayOffset);
    days.push({ date, isCurrentMonth: dayOffset >= 1 && dayOffset <= totalDaysInMonth });
  }
  return days;
}

/** The visible "Month Year" label for a Month view header — e.g. "March 2026". Never a bare Date.toLocaleDateString() (see this module's own header comment: month/year identity is UTC-calendar-derived, not a timezone-sensitive instant). */
export function formatMonthLabel(year: number, month: number, locale?: string): string {
  return utcMidnight(year, month, 1).toLocaleDateString(locale, { timeZone: "UTC", month: "long", year: "numeric" });
}

/** `{ year, month }` for the month immediately before/after the given one — the Month view's own prev/next navigation. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (((total % 12) + 12) % 12) + 1 };
}
