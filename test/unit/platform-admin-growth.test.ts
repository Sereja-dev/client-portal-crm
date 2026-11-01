import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// growth.ts imports the real prisma client and the server-only guard; the
// pure helpers under test never touch either.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/platform-admin/authorization", () => ({ requirePlatformAdmin: vi.fn() }));

const {
  GROWTH_PERIOD_DAYS,
  buildGrowthTrend,
  parseGrowthParams,
  resolveRegistrationStatus,
  SIGNUP_RECORDING_STARTED_DAY,
} = await import("@/lib/platform-admin/queries/growth");
const { formatUtcDateTime, formatUtcDay } = await import("@/lib/platform-admin/format-utc");

// Platform Admin Growth V1, Slice B. Pure-logic proof of the period
// windows, the zero-fill and pre-recording rules, status resolution and
// parameter parsing. The database-backed semantics live in
// test/integration/platform-admin/growth.test.ts.

const D = (iso: string) => new Date(iso);

describe("buildGrowthTrend — UTC calendar-day windows", () => {
  const now = D("2027-06-15T10:30:00.000Z");

  it.each(GROWTH_PERIOD_DAYS)("a %i-day window has exactly that many UTC days, ending today, in order", (days) => {
    const points = buildGrowthTrend({ now, days, signupTimes: [], accountTimes: [] });
    expect(points).toHaveLength(days);
    expect(points[days - 1].date).toBe("2027-06-15");
    expect(points[0].date).toBe(new Date(Date.UTC(2027, 5, 15) - (days - 1) * 86_400_000).toISOString().slice(0, 10));
    for (let i = 1; i < points.length; i += 1) expect(points[i].date > points[i - 1].date).toBe(true);
  });

  it("includes an event at exactly the window start, excludes one a millisecond earlier", () => {
    const points = buildGrowthTrend({
      now,
      days: 7,
      signupTimes: [D("2027-06-09T00:00:00.000Z"), D("2027-06-08T23:59:59.999Z")],
      accountTimes: [D("2027-06-09T00:00:00.000Z"), D("2027-06-08T23:59:59.999Z")],
    });
    expect(points[0]).toMatchObject({ date: "2027-06-09", signups: 1, accounts: 1 });
    expect(points.reduce((s, p) => s + (p.signups ?? 0), 0)).toBe(1);
  });

  it("includes the last millisecond of today and excludes the first millisecond of tomorrow", () => {
    const points = buildGrowthTrend({
      now,
      days: 7,
      signupTimes: [D("2027-06-15T23:59:59.999Z"), D("2027-06-16T00:00:00.000Z")],
      accountTimes: [],
    });
    expect(points[6].signups).toBe(1);
    expect(points.reduce((s, p) => s + (p.signups ?? 0), 0)).toBe(1);
  });

  it("zero-fills every day with no events — the timeline never collapses", () => {
    const points = buildGrowthTrend({ now, days: 30, signupTimes: [D("2027-06-10T05:00:00.000Z")], accountTimes: [] });
    expect(points).toHaveLength(30);
    expect(points.filter((p) => p.signups === 0)).toHaveLength(29);
    expect(points.every((p) => p.accounts === 0)).toBe(true);
  });

  it("buckets by UTC day, not by the server's local day", () => {
    const points = buildGrowthTrend({
      now,
      days: 7,
      signupTimes: [D("2027-06-12T23:30:00.000Z"), D("2027-06-13T00:30:00.000Z")],
      accountTimes: [],
    });
    expect(points.find((p) => p.date === "2027-06-12")?.signups).toBe(1);
    expect(points.find((p) => p.date === "2027-06-13")?.signups).toBe(1);
  });
});

describe("buildGrowthTrend — days before signup recording began", () => {
  it("reports signups as null (no data), never zero, but still reports authoritative account counts", () => {
    const now = D("2026-11-03T12:00:00.000Z");
    const points = buildGrowthTrend({
      now,
      days: 7,
      signupTimes: [D("2026-11-01T08:00:00.000Z")],
      accountTimes: [D("2026-10-29T08:00:00.000Z")],
    });
    expect(SIGNUP_RECORDING_STARTED_DAY).toBe("2026-11-01");
    expect(points.map((p) => [p.date, p.signups])).toEqual([
      ["2026-10-28", null],
      ["2026-10-29", null],
      ["2026-10-30", null],
      ["2026-10-31", null],
      ["2026-11-01", 1],
      ["2026-11-02", 0],
      ["2026-11-03", 0],
    ]);
    expect(points.find((p) => p.date === "2026-10-29")?.accounts).toBe(1);
  });
});

describe("resolveRegistrationStatus — User existence is authoritative", () => {
  it("is ACTIVATED whenever a User exists, even if the recorded activatedAt is missing", () => {
    expect(resolveRegistrationStatus({ activatedAt: null }, true)).toBe("ACTIVATED");
    expect(resolveRegistrationStatus({ activatedAt: D("2026-11-01T00:00:00Z") }, true)).toBe("ACTIVATED");
  });
  it("is NO_APP_ACCOUNT when there is neither a User nor a recorded activation", () => {
    expect(resolveRegistrationStatus({ activatedAt: null }, false)).toBe("NO_APP_ACCOUNT");
  });
  it("is ACCOUNT_NOT_FOUND (unknown, not pending) when an activation was recorded but no User exists", () => {
    expect(resolveRegistrationStatus({ activatedAt: D("2026-11-01T00:00:00Z") }, false)).toBe("ACCOUNT_NOT_FOUND");
  });
});

describe("parseGrowthParams", () => {
  it("defaults to 30 days, newest signup first, page 1", () => {
    expect(parseGrowthParams({})).toMatchObject({ periodDays: 30, sortCombined: "firstAttemptedAt:desc", page: 1, q: "" });
  });
  it("accepts only 7, 30 and 90 days; anything else falls back to the default", () => {
    expect(parseGrowthParams({ period: "7" }).periodDays).toBe(7);
    expect(parseGrowthParams({ period: "90" }).periodDays).toBe(90);
    for (const bad of ["1", "365", "0", "-7", "abc", "7.5", ""]) expect(parseGrowthParams({ period: bad }).periodDays).toBe(30);
    expect(parseGrowthParams({ period: ["7", "90"] }).periodDays).toBe(30);
  });
  it("whitelists sort fields and clamps the page", () => {
    expect(parseGrowthParams({ sort: "email:asc" }).sortField).toBe("email");
    expect(parseGrowthParams({ sort: "authUserId:asc" }).sortField).toBe("firstAttemptedAt");
    expect(parseGrowthParams({ sort: "password:desc" }).sortField).toBe("firstAttemptedAt");
    expect(parseGrowthParams({ page: "0" }).page).toBe(1);
    expect(parseGrowthParams({ page: "3" }).page).toBe(3);
  });
  it("trims the search term", () => {
    expect(parseGrowthParams({ q: "  alice  " }).q).toBe("alice");
  });
});

describe("UTC formatting convention", () => {
  it("renders timestamps in UTC, labelled, regardless of the machine timezone", () => {
    expect(formatUtcDateTime(D("2026-11-01T05:04:59.999Z"))).toBe("2026-11-01 05:04 UTC");
    expect(formatUtcDay(D("2026-11-01T23:59:59.999Z"))).toBe("2026-11-01");
  });
});

describe("Growth route contract", () => {
  it("has its own loading state and a nav link, and no server actions", () => {
    expect(existsSync("src/app/(platform-admin)/platform-admin/growth/loading.tsx")).toBe(true);
    expect(readFileSync("src/app/(platform-admin)/layout.tsx", "utf8")).toContain('href: "/platform-admin/growth"');
    for (const file of [
      "src/app/(platform-admin)/platform-admin/growth/page.tsx",
      "src/lib/platform-admin/queries/growth.ts",
      "src/components/platform-admin/growth-stat-card.tsx",
    ]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/^\s*["']use server["']/m);
    }
  });
});
