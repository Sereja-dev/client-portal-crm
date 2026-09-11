import { describe, expect, it } from "vitest";
import { combineDurationInput, splitDurationMinutes, formatDurationMinutes } from "@/lib/time-entries/duration";

describe("combineDurationInput", () => {
  it("11. hours+minutes serialize correctly", () => {
    expect(combineDurationInput(0, 30)).toEqual({ ok: true, totalMinutes: 30 });
    expect(combineDurationInput(1, 30)).toEqual({ ok: true, totalMinutes: 90 });
    expect(combineDurationInput(24, 0)).toEqual({ ok: true, totalMinutes: 1440 });
  });

  it("accepts numeric strings (FormData shape)", () => {
    expect(combineDurationInput("1", "30")).toEqual({ ok: true, totalMinutes: 90 });
  });

  it("rejects negative hours or minutes", () => {
    expect(combineDurationInput(-1, 0)).toEqual({ ok: false });
    expect(combineDurationInput(0, -1)).toEqual({ ok: false });
  });

  it("rejects fractional hours or minutes", () => {
    expect(combineDurationInput(1.5, 0)).toEqual({ ok: false });
    expect(combineDurationInput(0, 30.5)).toEqual({ ok: false });
  });

  it("rejects minutes outside 0-59, regardless of the resulting total", () => {
    expect(combineDurationInput(0, 60)).toEqual({ ok: false });
    expect(combineDurationInput(0, 90)).toEqual({ ok: false });
  });

  it("rejects non-numeric input", () => {
    expect(combineDurationInput("abc", 0)).toEqual({ ok: false });
    expect(combineDurationInput(0, "abc")).toEqual({ ok: false });
    expect(combineDurationInput(null, 0)).toEqual({ ok: false });
    expect(combineDurationInput(undefined, undefined)).toEqual({ ok: false });
  });

  it("does not itself enforce the 1..1440 total ceiling (left to the domain layer) — 24h + positive minutes combines to a value over 1440, the domain layer's own job to reject", () => {
    // 24h 1m = 1441 minutes — combineDurationInput happily returns it;
    // parseDurationMinutes (Phase 1, unchanged) is what actually rejects
    // it downstream. This documents that division of responsibility.
    expect(combineDurationInput(24, 1)).toEqual({ ok: true, totalMinutes: 1441 });
  });

  it("0h 0m combines successfully to 0 — rejected downstream by parseDurationMinutes's own 1-minute floor, not here", () => {
    expect(combineDurationInput(0, 0)).toEqual({ ok: true, totalMinutes: 0 });
  });
});

describe("splitDurationMinutes", () => {
  it("splits a total back into hours/minutes", () => {
    expect(splitDurationMinutes(0)).toEqual({ hours: 0, minutes: 0 });
    expect(splitDurationMinutes(30)).toEqual({ hours: 0, minutes: 30 });
    expect(splitDurationMinutes(90)).toEqual({ hours: 1, minutes: 30 });
    expect(splitDurationMinutes(1440)).toEqual({ hours: 24, minutes: 0 });
  });

  it("round-trips with combineDurationInput", () => {
    const combined = combineDurationInput(2, 15);
    if (!combined.ok) throw new Error("expected ok");
    expect(splitDurationMinutes(combined.totalMinutes)).toEqual({ hours: 2, minutes: 15 });
  });
});

describe("34. formatDurationMinutes", () => {
  it("30 -> 30m", () => {
    expect(formatDurationMinutes(30)).toBe("30m");
  });

  it("60 -> 1h", () => {
    expect(formatDurationMinutes(60)).toBe("1h");
  });

  it("90 -> 1h 30m", () => {
    expect(formatDurationMinutes(90)).toBe("1h 30m");
  });

  it("1 -> 1m", () => {
    expect(formatDurationMinutes(1)).toBe("1m");
  });

  it("1440 -> 24h", () => {
    expect(formatDurationMinutes(1440)).toBe("24h");
  });

  it("never renders a raw integer alone with no unit", () => {
    expect(formatDurationMinutes(45)).toMatch(/m$/);
    expect(formatDurationMinutes(120)).toMatch(/h$/);
  });
});
