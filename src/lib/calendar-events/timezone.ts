/**
 * Calendar V1 — locked architecture §8/§10. The ONE centralized place any
 * timed CalendarEvent's local wall-clock ↔ UTC-instant conversion happens.
 * Every service/query/UI call for a timed event must go through this
 * module — never a bare `new Date(...)`, `.toLocaleString()`,
 * `.toLocaleDateString()`, or `.toLocaleTimeString()` without an explicit
 * `timeZone`, and never the browser/server-machine/user-device timezone.
 *
 * Deliberately pure (no I/O, no `server-only`, no Prisma import) — same
 * "pure logic lives in its own file, DB access lives in queries.ts"
 * split src/lib/contracts/status.ts already established, which is what
 * lets this module's own DST-correctness be unit-tested directly (plain
 * `vitest run test/unit`, no Next/server-only transform). Reading
 * OrganizationProfile.timezone itself (the one piece of I/O this feature
 * needs) lives in src/lib/calendar-events/queries.ts's own
 * getOrganizationTimezone(), which is the only caller expected to feed
 * this module's own `timeZone` parameter.
 *
 * All-day events are handled separately, through the existing, already-
 * proven date-only convention in src/lib/invoices/date-only.ts
 * (parseDateOnly/formatDateOnly/formatDateOnlyForDisplay) — this module
 * has nothing to do with those; an all-day event's startsAt is a
 * timezone-agnostic UTC-midnight date-only value, never run through the
 * wall-clock resolver below.
 */

export type WallClockDateTime = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number; // 0-59
};

export type ResolveWallClockResult =
  | { ok: true; instant: Date }
  | { ok: false; reason: "NONEXISTENT" }
  | { ok: false; reason: "AMBIGUOUS" };

/**
 * The exact wall-clock components `Intl.DateTimeFormat` reports for
 * `instant` in `timeZone` — used both to compute a zone's UTC offset at
 * an arbitrary instant (there is no direct `Intl` API for "offset at this
 * instant in this zone"; it must be derived from the formatted local
 * components) and to round-trip-verify a resolved instant.
 */
function formatWallClock(instant: Date, timeZone: string): WallClockDateTime {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") === 24 ? 0 : get("hour"),
    minute: get("minute"),
  };
}

function wallClockEquals(a: WallClockDateTime, b: WallClockDateTime): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}

/** Minutes to add to a UTC instant to get the zone's local wall-clock at that same instant (e.g. +420 for Asia/Bangkok, -300 for America/New_York in EST). Derived from Intl's own formatted components — there is no other native API for this. */
function zoneOffsetMinutesAt(instantMs: number, timeZone: string): number {
  const wall = formatWallClock(new Date(instantMs), timeZone);
  const asIfUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0);
  return Math.round((asIfUtc - instantMs) / 60_000);
}

/**
 * Resolves a local wall-clock date+time in `timeZone` to the real UTC
 * instant it names — locked architecture §10 (DST correctness). This is
 * deliberately NOT a one-line `Date` parse: converting an arbitrary local
 * wall-clock time into an instant requires knowing the zone's UTC offset
 * AT that local time, which itself depends on the very instant being
 * solved for (a chicken-and-egg problem only DST transitions make visible
 * at all — every other day of the year has exactly one stable offset).
 *
 * Algorithm (standard fixed-point technique, no new dependency — only
 * `Intl.DateTimeFormat`, which already has full IANA tzdata via ICU):
 * 1. Guess the instant by treating the wall-clock components as if they
 *    were already UTC.
 * 2. Read the zone's real offset AT that guess, and again at the
 *    resulting first-correction instant (the offset can differ between
 *    the two right around a transition, which is exactly the signal used
 *    to detect one).
 * 3. If both offsets produce the same instant, or both bring the wall-
 *    clock back to the requested value with the same instant, the time
 *    is unambiguous — return it.
 * 4. If neither candidate instant's own formatted wall-clock matches the
 *    requested one, the requested local time was skipped entirely by a
 *    spring-forward transition — reject as NONEXISTENT (locked: never
 *    silently normalize it forward).
 * 5. If both candidate instants' formatted wall-clocks match the
 *    requested one (two different real instants both display as the
 *    same local wall-clock — a fall-back overlap), reject as AMBIGUOUS
 *    (locked: never silently pick the earlier or later instant).
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveWallClockToInstant(wall: WallClockDateTime, timeZone: string): ResolveWallClockResult {
  const naiveGuessMs = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0);

  // Sample the zone's offset a full day before and a full day after the
  // naive guess — every real IANA zone's DST transitions are at least a
  // day apart from each other, so this always lands cleanly on the
  // stable regime on each side of any transition the requested wall-
  // clock might be near, regardless of exactly where within that
  // transition window the naive guess itself happens to fall (a single
  // fixed-point iteration from the guess alone can converge to only one
  // of the two candidate offsets and silently miss the other side
  // entirely — that failure mode is exactly what this two-sided sampling
  // avoids).
  const offsetBefore = zoneOffsetMinutesAt(naiveGuessMs - DAY_MS, timeZone);
  const offsetAfter = zoneOffsetMinutesAt(naiveGuessMs + DAY_MS, timeZone);

  const candidateBefore = naiveGuessMs - offsetBefore * 60_000;
  const candidateAfter = naiveGuessMs - offsetAfter * 60_000;

  const wallAtBefore = formatWallClock(new Date(candidateBefore), timeZone);
  const wallAtAfter = formatWallClock(new Date(candidateAfter), timeZone);

  const beforeMatches = wallClockEquals(wallAtBefore, wall);
  const afterMatches = wallClockEquals(wallAtAfter, wall);

  if (beforeMatches && afterMatches) {
    if (candidateBefore === candidateAfter) {
      // The ordinary case, far from any transition — both sides agree
      // on the same single real instant.
      return { ok: true, instant: new Date(candidateBefore) };
    }
    // Two distinct real instants both display as the exact requested
    // local wall-clock — a fall-back (DST-ends) overlap.
    return { ok: false, reason: "AMBIGUOUS" };
  }

  if (beforeMatches) return { ok: true, instant: new Date(candidateBefore) };
  if (afterMatches) return { ok: true, instant: new Date(candidateAfter) };

  // Neither candidate's own formatted wall-clock reproduces the request
  // — the requested local time was skipped entirely by a spring-forward
  // transition.
  return { ok: false, reason: "NONEXISTENT" };
}

/**
 * Display-only: formats a real UTC instant (startsAt/endsAt of a TIMED
 * CalendarEvent) as a local date+time string in `timeZone` — never the
 * viewer's browser-local zone, never a bare `.toLocaleString()`. Not used
 * for all-day events (see this module's own header comment).
 */
export function formatInstantInTimezone(instant: Date, timeZone: string, locale?: string): string {
  return instant.toLocaleString(locale, {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Display-only: just the time-of-day portion, in `timeZone`. */
export function formatTimeInTimezone(instant: Date, timeZone: string, locale?: string): string {
  return instant.toLocaleTimeString(locale, { timeZone, hour: "numeric", minute: "2-digit" });
}

/**
 * The inverse of resolveWallClockToInstant's own input shape, used only
 * to pre-fill an edit form's plain `<input type="date">`/`<input
 * type="time">` default values from an already-stored UTC instant — the
 * organization's own local wall-clock date+time, as "YYYY-MM-DD"/"HH:MM"
 * strings, never the viewer's browser-local zone. Every already-stored
 * instant round-trips through this function to exactly the wall-clock
 * components that produced it (see this module's own unit tests).
 */
export function toWallClockInputValues(instant: Date, timeZone: string): { date: string; time: string } {
  const wall = formatWallClock(instant, timeZone);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${String(wall.year).padStart(4, "0")}-${pad2(wall.month)}-${pad2(wall.day)}`,
    time: `${pad2(wall.hour)}:${pad2(wall.minute)}`,
  };
}
