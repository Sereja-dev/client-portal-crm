import { describe, expect, it } from "vitest";
import {
  resolveWallClockToInstant,
  formatInstantInTimezone,
  formatTimeInTimezone,
  toWallClockInputValues,
} from "@/lib/calendar-events/timezone";

/**
 * Calendar V1 — locked architecture §10 (DST correctness). Every
 * assertion below pins an explicit `timeZone`/locale so the result is
 * deterministic regardless of the machine actually running the test —
 * no reliance on the current host's own local timezone anywhere in this
 * file.
 */
describe("resolveWallClockToInstant", () => {
  it("A. normal time round-trips exactly (America/New_York, 2026-01-15 14:00, EST)", () => {
    const result = resolveWallClockToInstant({ year: 2026, month: 1, day: 15, hour: 14, minute: 0 }, "America/New_York");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // EST is UTC-5 in January -- 14:00 local = 19:00 UTC.
      expect(result.instant.toISOString()).toBe("2026-01-15T19:00:00.000Z");
      expect(formatInstantInTimezone(result.instant, "America/New_York", "en-US")).toBe("Jan 15, 2026, 2:00 PM");
    }
  });

  it("B. DST spring-forward gap is rejected, never silently normalized (America/New_York, 2026-03-08 02:30 does not exist)", () => {
    // 2026-03-08 is the second Sunday of March -- US DST begins at 2:00
    // AM local, clocks jump straight to 3:00 AM. 02:30 never happens.
    const result = resolveWallClockToInstant({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/New_York");
    expect(result).toEqual({ ok: false, reason: "NONEXISTENT" });
  });

  it("the instant immediately before the spring-forward gap (01:59) still resolves normally", () => {
    const result = resolveWallClockToInstant({ year: 2026, month: 3, day: 8, hour: 1, minute: 59 }, "America/New_York");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Still EST (UTC-5) one minute before the jump.
      expect(result.instant.toISOString()).toBe("2026-03-08T06:59:00.000Z");
    }
  });

  it("the instant immediately after the spring-forward gap (03:00) resolves normally, already in EDT", () => {
    const result = resolveWallClockToInstant({ year: 2026, month: 3, day: 8, hour: 3, minute: 0 }, "America/New_York");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Now EDT (UTC-4).
      expect(result.instant.toISOString()).toBe("2026-03-08T07:00:00.000Z");
    }
  });

  it("C. DST fall-back overlap is rejected, never silently resolved to either instant (America/New_York, 2026-11-01 01:30 occurs twice)", () => {
    // 2026-11-01 is the first Sunday of November -- US DST ends at 2:00
    // AM local (EDT), clocks fall back to 1:00 AM (EST). 01:30 happens
    // once at 05:30 UTC (still EDT) and again at 06:30 UTC (now EST).
    const result = resolveWallClockToInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/New_York");
    expect(result).toEqual({ ok: false, reason: "AMBIGUOUS" });
  });

  it("the instant well before the fall-back overlap (00:30) still resolves normally", () => {
    const result = resolveWallClockToInstant({ year: 2026, month: 11, day: 1, hour: 0, minute: 30 }, "America/New_York");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.instant.toISOString()).toBe("2026-11-01T04:30:00.000Z");
    }
  });

  it("the instant well after the fall-back overlap (02:30, unambiguously EST) still resolves normally", () => {
    const result = resolveWallClockToInstant({ year: 2026, month: 11, day: 1, hour: 2, minute: 30 }, "America/New_York");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.instant.toISOString()).toBe("2026-11-01T07:30:00.000Z");
    }
  });

  it("D. positive-offset zone round-trips exactly (Asia/Bangkok, UTC+7, no DST)", () => {
    const result = resolveWallClockToInstant({ year: 2026, month: 6, day: 10, hour: 9, minute: 15 }, "Asia/Bangkok");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.instant.toISOString()).toBe("2026-06-10T02:15:00.000Z");
      expect(formatInstantInTimezone(result.instant, "Asia/Bangkok", "en-US")).toBe("Jun 10, 2026, 9:15 AM");
    }
  });

  it("E. UTC round-trips exactly (offset is always zero, no DST)", () => {
    const result = resolveWallClockToInstant({ year: 2026, month: 7, day: 4, hour: 12, minute: 0 }, "UTC");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.instant.toISOString()).toBe("2026-07-04T12:00:00.000Z");
    }
  });

  it("F. a positive-offset local time near midnight preserves the intended LOCAL calendar date even though the UTC instant lands on the previous day", () => {
    // 00:30 in Bangkok (UTC+7) on the 10th is 17:30 UTC on the 9th --
    // the UTC calendar date and the local calendar date genuinely
    // differ here; the resolver must still report the 9th in UTC while
    // formatting back to the 10th in Bangkok.
    const result = resolveWallClockToInstant({ year: 2026, month: 6, day: 10, hour: 0, minute: 30 }, "Asia/Bangkok");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.instant.toISOString()).toBe("2026-06-09T17:30:00.000Z");
      // The local wall-clock, re-derived from the stored UTC instant,
      // is still genuinely June 10th in Bangkok -- the intended local
      // calendar date was never lost.
      expect(formatInstantInTimezone(result.instant, "Asia/Bangkok", "en-US")).toBe("Jun 10, 2026, 12:30 AM");
    }
  });

  it("a negative-offset local time near midnight likewise preserves the intended LOCAL calendar date even though UTC lands on the next day", () => {
    // 23:45 in New York (EST, UTC-5) on the 15th is 04:45 UTC on the
    // 16th.
    const result = resolveWallClockToInstant({ year: 2026, month: 1, day: 15, hour: 23, minute: 45 }, "America/New_York");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.instant.toISOString()).toBe("2026-01-16T04:45:00.000Z");
      expect(formatInstantInTimezone(result.instant, "America/New_York", "en-US")).toBe("Jan 15, 2026, 11:45 PM");
    }
  });
});

describe("formatInstantInTimezone / formatTimeInTimezone", () => {
  const instant = new Date("2026-06-10T02:15:00.000Z");

  it("never renders through the caller's own implicit local timezone -- an explicit timeZone always wins", () => {
    expect(formatInstantInTimezone(instant, "Asia/Bangkok", "en-US")).toBe("Jun 10, 2026, 9:15 AM");
    expect(formatInstantInTimezone(instant, "America/New_York", "en-US")).toBe("Jun 9, 2026, 10:15 PM");
    expect(formatInstantInTimezone(instant, "UTC", "en-US")).toBe("Jun 10, 2026, 2:15 AM");
  });

  it("formatTimeInTimezone renders only the time-of-day portion in the given zone", () => {
    expect(formatTimeInTimezone(instant, "Asia/Bangkok", "en-US")).toBe("9:15 AM");
    expect(formatTimeInTimezone(instant, "UTC", "en-US")).toBe("2:15 AM");
  });
});

describe("toWallClockInputValues", () => {
  it("round-trips exactly through resolveWallClockToInstant for a normal time", () => {
    const wall = { year: 2026, month: 1, day: 15, hour: 14, minute: 0 };
    const resolved = resolveWallClockToInstant(wall, "America/New_York");
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(toWallClockInputValues(resolved.instant, "America/New_York")).toEqual({ date: "2026-01-15", time: "14:00" });
    }
  });

  it("round-trips exactly for a positive-offset midnight-crossing instant", () => {
    const wall = { year: 2026, month: 6, day: 10, hour: 0, minute: 30 };
    const resolved = resolveWallClockToInstant(wall, "Asia/Bangkok");
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      // The stored UTC instant is on June 9th, but the organization's own
      // local wall-clock date is still genuinely June 10th.
      expect(toWallClockInputValues(resolved.instant, "Asia/Bangkok")).toEqual({ date: "2026-06-10", time: "00:30" });
    }
  });
});
