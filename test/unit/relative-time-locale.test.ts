import { afterEach, describe, expect, it, vi } from "vitest";
import { relativeTime } from "@/lib/notifications/relative-time";

// Production hydration defect (React error #418): relativeTime()'s >=7-day
// branch used to call toLocaleDateString(undefined, ...), which resolves to
// the ENVIRONMENT's default locale — Node's default (English) during SSR,
// but the visiting browser's navigator.language during hydration. Caught
// live: server rendered "Sep 8", a ru-RU browser hydrated "8 сент." for the
// exact same notification. The fix pins an explicit "en-US" locale so the
// server and every client produce byte-identical output regardless of the
// visiting browser's locale. These tests prove that property directly,
// independent of this test runner's own default locale.

describe("relativeTime — thresholds unchanged", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("< 60s: Just now", () => {
    const now = new Date("2024-06-15T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date(now.getTime() - 30_000))).toBe("Just now");
  });

  it("< 60m: Nm ago", () => {
    const now = new Date("2024-06-15T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date(now.getTime() - 5 * 60_000))).toBe("5m ago");
  });

  it("< 24h: Nh ago", () => {
    const now = new Date("2024-06-15T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date(now.getTime() - 5 * 60 * 60_000))).toBe("5h ago");
  });

  it("< 7d: Nd ago", () => {
    const now = new Date("2024-06-15T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date(now.getTime() - 3 * 24 * 60 * 60_000))).toBe("3d ago");
  });
});

describe("relativeTime — >= 7 days: locale-stable output (the fixed defect)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("always calls toLocaleDateString with an explicit 'en-US' locale, never the environment-implicit default", () => {
    const spy = vi.spyOn(Date.prototype, "toLocaleDateString");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

    relativeTime(eightDaysAgo);

    expect(spy).toHaveBeenCalledWith("en-US", { month: "short", day: "numeric" });
    // The exact bug: this call must never omit the locale argument (which
    // is what let the server and the browser resolve two different
    // environment defaults for the very same render).
    expect(spy).not.toHaveBeenCalledWith(undefined, expect.anything());
  });

  it("produces byte-identical output for the same instant regardless of which locale the runtime would otherwise default to", () => {
    const date = new Date("2024-01-15T10:00:00Z");

    // Sanity check: this runtime's Intl implementation genuinely does
    // differentiate locales for this format — otherwise the whole bug
    // class (and this regression test) would be moot in this environment.
    const enUS = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const ruRU = date.toLocaleDateString("ru-RU", { month: "short", day: "numeric" });
    expect(enUS).not.toBe(ruRU);

    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const expected = eightDaysAgo.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    // relativeTime() must always match the explicit en-US rendering, never
    // whatever the calling environment's own default locale happens to be.
    expect(relativeTime(eightDaysAgo)).toBe(expected);
  });
});
