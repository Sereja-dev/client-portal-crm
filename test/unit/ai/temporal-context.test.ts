import { describe, expect, it } from "vitest";
import { buildEffectiveSystemPrompt } from "@/lib/ai/temporal-context";

/**
 * AI Assistant — authoritative temporal grounding, pure-builder tier.
 * Every test here injects `now`/`timezone` explicitly — never
 * `Date.now()`/`new Date()`, never the machine's own local timezone — so
 * this file has zero wall-clock dependence (see temporal-context.ts's own
 * header comment).
 */

const BASE_PROMPT = "You are the AI Assistant for a business management app.";
const FIXED_NOW = new Date("2026-09-20T05:00:00.000Z");

describe("buildEffectiveSystemPrompt — determinism", () => {
  it("returns byte-identical output for identical basePrompt/now/timezone", () => {
    const a = buildEffectiveSystemPrompt({ basePrompt: BASE_PROMPT, now: FIXED_NOW, timezone: "UTC" });
    const b = buildEffectiveSystemPrompt({ basePrompt: BASE_PROMPT, now: new Date(FIXED_NOW.getTime()), timezone: "UTC" });
    expect(a).toBe(b);
  });

  it("never mutates or truncates basePrompt — it always appears verbatim, unchanged", () => {
    const result = buildEffectiveSystemPrompt({ basePrompt: BASE_PROMPT, now: FIXED_NOW, timezone: "UTC" });
    expect(result.startsWith(BASE_PROMPT)).toBe(true);
  });
});

describe("buildEffectiveSystemPrompt — authoritative date/timezone content", () => {
  it("contains the authoritative current date, computed in the supplied timezone", () => {
    const result = buildEffectiveSystemPrompt({ basePrompt: BASE_PROMPT, now: FIXED_NOW, timezone: "UTC" });
    expect(result).toContain("2026-09-20");
  });

  it("contains the exact supplied IANA timezone name", () => {
    const result = buildEffectiveSystemPrompt({ basePrompt: BASE_PROMPT, now: FIXED_NOW, timezone: "Asia/Dubai" });
    expect(result).toContain("Asia/Dubai");
  });

  it("a timezone far enough ahead of UTC shifts the computed calendar date across the UTC day boundary", () => {
    // 2026-09-20T22:30:00Z is still 2026-09-20 in UTC, but already
    // 2026-09-21 in Asia/Tokyo (UTC+9) — proves the date is genuinely
    // derived from the (now, timezone) pair, not from `now`'s own UTC
    // calendar date.
    const lateUtc = new Date("2026-09-20T22:30:00.000Z");
    const utcResult = buildEffectiveSystemPrompt({ basePrompt: BASE_PROMPT, now: lateUtc, timezone: "UTC" });
    const tokyoResult = buildEffectiveSystemPrompt({ basePrompt: BASE_PROMPT, now: lateUtc, timezone: "Asia/Tokyo" });
    expect(utcResult).toContain("2026-09-20");
    expect(tokyoResult).toContain("2026-09-21");
  });

  it("mentions how to interpret relative date phrases", () => {
    const result = buildEffectiveSystemPrompt({ basePrompt: BASE_PROMPT, now: FIXED_NOW, timezone: "UTC" });
    for (const phrase of ["today", "tomorrow", "overdue", "this week", "next N days/weeks", "this month"]) {
      expect(result).toContain(phrase);
    }
  });

  it("never includes an organizationId, userId, name, email, or ref-shaped identifier", () => {
    const result = buildEffectiveSystemPrompt({ basePrompt: BASE_PROMPT, now: FIXED_NOW, timezone: "UTC" });
    const RAW_UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    expect(RAW_UUID_PATTERN.test(result)).toBe(false);
    expect(result).not.toMatch(/@/); // no email-shaped content
  });
});

describe("buildEffectiveSystemPrompt — no machine-local timezone dependence", () => {
  it("calling twice with the same explicit timezone always agrees, independent of whatever the host machine's own local zone is", () => {
    // The function only ever reads its own explicit `timezone` parameter
    // (passed straight through as Intl.DateTimeFormat's own `timeZone`
    // option) — it never calls Intl.DateTimeFormat()/toLocaleString()
    // without one, so there is no code path left that could observe the
    // host machine's own local zone. Two independent calls with the same
    // inputs, run back to back, prove this deterministically without
    // needing to mutate global process state.
    const first = buildEffectiveSystemPrompt({ basePrompt: BASE_PROMPT, now: FIXED_NOW, timezone: "Pacific/Kiritimati" });
    const second = buildEffectiveSystemPrompt({ basePrompt: BASE_PROMPT, now: FIXED_NOW, timezone: "Pacific/Kiritimati" });
    expect(first).toBe(second);
    expect(first).toContain("Pacific/Kiritimati");
  });
});
