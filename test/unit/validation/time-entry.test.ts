import { describe, expect, it } from "vitest";
import {
  isUuid,
  parseDurationMinutes,
  parseTimeEntryWorkDate,
  normalizeTimeEntryDescription,
  parseTimeEntryFields,
  TIME_ENTRY_DESCRIPTION_MAX_LENGTH,
} from "@/lib/validation/time-entry";

describe("isUuid", () => {
  it("accepts a well-formed UUID and rejects everything else", () => {
    expect(isUuid("11111111-2222-3333-4444-555555555555")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});

describe("parseDurationMinutes", () => {
  it("14. 1 minute accepted", () => {
    expect(parseDurationMinutes(1)).toEqual({ ok: true, value: 1 });
  });

  it("15. 1440 minutes accepted", () => {
    expect(parseDurationMinutes(1440)).toEqual({ ok: true, value: 1440 });
  });

  it("16. zero rejected", () => {
    expect(parseDurationMinutes(0)).toEqual({ ok: false });
  });

  it("17. negative rejected", () => {
    expect(parseDurationMinutes(-5)).toEqual({ ok: false });
  });

  it("18. >1440 rejected", () => {
    expect(parseDurationMinutes(1441)).toEqual({ ok: false });
  });

  it("19. fractional duration rejected", () => {
    expect(parseDurationMinutes(30.5)).toEqual({ ok: false });
    expect(parseDurationMinutes("45.5")).toEqual({ ok: false });
  });

  it("accepts a numeric string", () => {
    expect(parseDurationMinutes("90")).toEqual({ ok: true, value: 90 });
  });

  it("rejects non-numeric input", () => {
    expect(parseDurationMinutes("abc")).toEqual({ ok: false });
    expect(parseDurationMinutes(null)).toEqual({ ok: false });
    expect(parseDurationMinutes(undefined)).toEqual({ ok: false });
    expect(parseDurationMinutes(NaN)).toEqual({ ok: false });
    expect(parseDurationMinutes(Infinity)).toEqual({ ok: false });
  });
});

describe("parseTimeEntryWorkDate", () => {
  it("20. valid date-only normalized correctly (UTC midnight)", () => {
    const result = parseTimeEntryWorkDate("2026-03-15");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.date.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("21. an invalid calendar date is rejected", () => {
    expect(parseTimeEntryWorkDate("2026-02-30")).toEqual({ ok: false });
    expect(parseTimeEntryWorkDate("not-a-date")).toEqual({ ok: false });
    expect(parseTimeEntryWorkDate("2026-13-01")).toEqual({ ok: false });
  });

  it("rejects a non-string value — never naive new Date(userInput) parsing", () => {
    expect(parseTimeEntryWorkDate(new Date())).toEqual({ ok: false });
    expect(parseTimeEntryWorkDate(undefined)).toEqual({ ok: false });
  });

  it("rejects a full datetime string, only a bare YYYY-MM-DD is accepted", () => {
    expect(parseTimeEntryWorkDate("2026-03-15T10:00:00Z")).toEqual({ ok: false });
  });
});

describe("normalizeTimeEntryDescription", () => {
  it("25. whitespace-only description becomes null", () => {
    expect(normalizeTimeEntryDescription("   ")).toEqual({ ok: true, value: null });
    expect(normalizeTimeEntryDescription("")).toEqual({ ok: true, value: null });
    expect(normalizeTimeEntryDescription(undefined)).toEqual({ ok: true, value: null });
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeTimeEntryDescription("  Fixed the bug  ")).toEqual({ ok: true, value: "Fixed the bug" });
  });

  it("rejects an over-length description", () => {
    expect(normalizeTimeEntryDescription("a".repeat(TIME_ENTRY_DESCRIPTION_MAX_LENGTH + 1))).toEqual({ ok: false });
  });

  it("accepts exactly the max length", () => {
    const value = "a".repeat(TIME_ENTRY_DESCRIPTION_MAX_LENGTH);
    expect(normalizeTimeEntryDescription(value)).toEqual({ ok: true, value });
  });
});

describe("parseTimeEntryFields", () => {
  it("combines all three fields, all errors surfaced together", () => {
    const result = parseTimeEntryFields({ workDate: "bad", durationMinutes: 0, description: "a".repeat(2000) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.workDate).toBeTruthy();
    expect(result.fieldErrors.durationMinutes).toBeTruthy();
    expect(result.fieldErrors.description).toBeTruthy();
  });

  it("accepts a fully valid input", () => {
    const result = parseTimeEntryFields({ workDate: "2026-03-15", durationMinutes: 90, description: "Worked on the bug" });
    expect(result).toEqual({
      ok: true,
      values: { workDate: new Date("2026-03-15T00:00:00.000Z"), durationMinutes: 90, description: "Worked on the bug" },
    });
  });
});
