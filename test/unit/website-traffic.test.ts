import { beforeEach, describe, expect, it, vi } from "vitest";

// website-traffic.ts imports the real authorization guard; the guard itself
// is proven (execution-level) in test/integration/platform-admin/
// website-traffic.test.ts. Everything here is the module's own logic, with a
// fully mocked fetch — the live Vercel API is never called.
vi.mock("@/lib/platform-admin/authorization", () => ({ requirePlatformAdmin: vi.fn(async () => ({ email: "admin@example.com" })) }));

const {
  buildTrafficSeries,
  clearWebsiteTrafficCache,
  getWebsiteTraffic,
  parseDailyRows,
  parseReferrerRows,
  readWebsiteTrafficConfig,
} = await import("@/lib/platform-admin/queries/website-traffic");

const TOKEN = "vcp_SECRET_TOKEN_VALUE_123";
const READY_ENV = {
  WEBSITE_TRAFFIC_ENABLED: "true",
  VERCEL_ANALYTICS_TOKEN: TOKEN,
  VERCEL_ANALYTICS_PROJECT_ID: "prj_marketing123",
  WEBSITE_TRAFFIC_COLLECTION_START: "2026-11-10",
};
const NOW = new Date("2026-11-20T10:00:00.000Z");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const dailyBody = (rows: Array<[string, number, number]>) => ({
  version: 1,
  data: rows.map(([day, pageviews, visitors]) => ({ timestamp: `${day}T00:00:00.000Z`, pageviews, visitors })),
});
const referrerBody = (rows: Array<[string | null, number, number]>) => ({
  version: 1,
  data: rows.map(([referrerHostname, pageviews, visitors]) => ({ referrerHostname, pageviews, visitors })),
});

function routedFetch(handlers: { day?: () => Response | Promise<Response>; referrer?: () => Response | Promise<Response> }) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    const by = url.searchParams.get("by");
    if (by === "day") return handlers.day ? handlers.day() : json(dailyBody([]));
    return handlers.referrer ? handlers.referrer() : json(referrerBody([]));
  });
}

beforeEach(() => {
  clearWebsiteTrafficCache();
});

describe("readWebsiteTrafficConfig — explicit, fail-closed activation", () => {
  it("is disabled unless WEBSITE_TRAFFIC_ENABLED is exactly the string true", () => {
    for (const value of [undefined, "", "1", "TRUE", "True", "yes", " true", "false"]) {
      expect(readWebsiteTrafficConfig({ ...READY_ENV, WEBSITE_TRAFFIC_ENABLED: value })).toEqual({ state: "disabled" });
    }
    expect(readWebsiteTrafficConfig({}).state).toBe("disabled");
  });

  it("names missing or invalid variables only — never a value", () => {
    const result = readWebsiteTrafficConfig({
      WEBSITE_TRAFFIC_ENABLED: "true",
      VERCEL_ANALYTICS_TOKEN: "",
      VERCEL_ANALYTICS_PROJECT_ID: "not-a-project-id",
      VERCEL_ANALYTICS_TEAM_ID: "bad",
      WEBSITE_TRAFFIC_COLLECTION_START: "2026-13-45",
      WEBSITE_TRAFFIC_REPORTING_WINDOW_DAYS: "999",
    });
    expect(result).toEqual({
      state: "not_configured",
      missing: [
        "VERCEL_ANALYTICS_TOKEN",
        "VERCEL_ANALYTICS_PROJECT_ID",
        "VERCEL_ANALYTICS_TEAM_ID",
        "WEBSITE_TRAFFIC_COLLECTION_START",
        "WEBSITE_TRAFFIC_REPORTING_WINDOW_DAYS",
      ],
    });
    expect(JSON.stringify(result)).not.toContain("not-a-project-id");
  });

  it("requires a collection start date so zeros can never be confused with 'not collected'", () => {
    const withoutStart: Record<string, string | undefined> = { ...READY_ENV, WEBSITE_TRAFFIC_COLLECTION_START: undefined };
    expect(readWebsiteTrafficConfig(withoutStart)).toEqual({ state: "not_configured", missing: ["WEBSITE_TRAFFIC_COLLECTION_START"] });
  });

  it("defaults the reporting window to 30 days and accepts an explicit one", () => {
    expect(readWebsiteTrafficConfig(READY_ENV)).toMatchObject({ state: "ready", reportingWindowDays: 30, teamId: null });
    expect(readWebsiteTrafficConfig({ ...READY_ENV, WEBSITE_TRAFFIC_REPORTING_WINDOW_DAYS: "365", VERCEL_ANALYTICS_TEAM_ID: "team_abc1" })).toMatchObject({
      reportingWindowDays: 365,
      teamId: "team_abc1",
    });
  });

  it("never falls back to the CRM's own Vercel project", () => {
    const result = readWebsiteTrafficConfig({ ...READY_ENV, VERCEL_ANALYTICS_PROJECT_ID: "", VERCEL_PROJECT_ID: "prj_crm_own_project" });
    expect(result).toEqual({ state: "not_configured", missing: ["VERCEL_ANALYTICS_PROJECT_ID"] });
  });
});

describe("buildTrafficSeries — UTC days, gaps vs genuine zeros", () => {
  it("returns one point per UTC day ending today; zero-event days since collection are real zeros", () => {
    const { points, totals } = buildTrafficSeries({
      now: NOW,
      days: 7,
      collectionStart: "2026-11-01",
      rows: [{ date: "2026-11-18", pageViews: 12, visitors: 9 }],
    });
    expect(points.map((p) => p.date)).toEqual(["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
    expect(points.find((p) => p.date === "2026-11-18")).toEqual({ date: "2026-11-18", pageViews: 12, visitors: 9 });
    expect(points.find((p) => p.date === "2026-11-19")).toEqual({ date: "2026-11-19", pageViews: 0, visitors: 0 });
    expect(totals.trackedDays).toBe(7);
  });

  it("marks days before collection started as null (not collected), never zero, and excludes them from totals", () => {
    const { points, totals } = buildTrafficSeries({
      now: NOW,
      days: 7,
      collectionStart: "2026-11-18",
      rows: [{ date: "2026-11-18", pageViews: 4, visitors: 3 }],
    });
    expect(points.filter((p) => p.visitors === null).map((p) => p.date)).toEqual(["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"]);
    expect(totals.trackedDays).toBe(3);
    expect(totals.pageViews).toBe(4);
  });

  it("never sums daily visitors into a period total: average is over completed days only, busiest day is a single day", () => {
    const { totals } = buildTrafficSeries({
      now: NOW,
      days: 7,
      collectionStart: "2026-11-01",
      rows: [
        { date: "2026-11-17", pageViews: 10, visitors: 6 },
        { date: "2026-11-18", pageViews: 30, visitors: 14 },
        { date: "2026-11-20", pageViews: 99, visitors: 50 }, // today, partial: excluded from the average
      ],
    });
    // Completed days: Nov 14-19 (6 days): (6 + 14) / 6
    expect(totals.averageDailyVisitors).toBe(3.3);
    expect(totals.busiestDay).toEqual({ date: "2026-11-20", visitors: 50 });
    expect(totals.pageViews).toBe(139); // page views are additive
    expect(Object.keys(totals)).not.toContain("uniqueVisitors");
    expect(Object.keys(totals)).not.toContain("sessions");
  });

  it("has no average and no busiest day before any visitor was recorded", () => {
    const { totals } = buildTrafficSeries({ now: NOW, days: 7, collectionStart: "2026-11-20", rows: [] });
    expect(totals).toMatchObject({ averageDailyVisitors: null, busiestDay: null, pageViews: 0, trackedDays: 1 });
  });
});

describe("response validation", () => {
  it("accepts documented daily rows, converts timestamps to UTC days and ignores rows outside the window", () => {
    const rows = parseDailyRows(dailyBody([["2026-11-17", 10, 6], ["2026-11-05", 1, 1]]), "2026-11-14", "2026-11-20");
    expect(rows).toEqual([{ date: "2026-11-17", pageViews: 10, visitors: 6 }]);
  });

  it.each([
    ["a non-object body", null],
    ["a missing data array", {}],
    ["data that is not an array", { data: "x" }],
    ["a row without a timestamp", { data: [{ pageviews: 1, visitors: 1 }] }],
    ["an unparseable timestamp", { data: [{ timestamp: "nope", pageviews: 1, visitors: 1 }] }],
    ["negative counts", { data: [{ timestamp: "2026-11-17T00:00:00Z", pageviews: -1, visitors: 1 }] }],
    ["string counts", { data: [{ timestamp: "2026-11-17T00:00:00Z", pageviews: "1", visitors: 1 }] }],
    ["non-finite counts", { data: [{ timestamp: "2026-11-17T00:00:00Z", pageviews: Infinity, visitors: 1 }] }],
    ["duplicate days", dailyBody([["2026-11-17", 1, 1], ["2026-11-17", 2, 2]])],
  ])("rejects %s as an invalid response", (_label, body) => {
    expect(() => parseDailyRows(body, "2026-11-14", "2026-11-20")).toThrow();
  });

  it("parses referrers: an empty or missing hostname is direct/unknown, and rows are sorted by page views", () => {
    const rows = parseReferrerRows(referrerBody([[null, 3, 2], ["news.example", 9, 5], ["", 1, 1], [" spaced.example ", 4, 4]]));
    expect(rows).toEqual([
      { hostname: "news.example", pageViews: 9, visitors: 5 },
      { hostname: "spaced.example", pageViews: 4, visitors: 4 },
      { hostname: null, pageViews: 3, visitors: 2 },
      { hostname: null, pageViews: 1, visitors: 1 },
    ]);
  });

  it("caps referrers at the top 10 by page views", () => {
    const rows = parseReferrerRows(referrerBody(Array.from({ length: 15 }, (_, i): [string, number, number] => [`s${i}.example`, i, 1])));
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual({ hostname: "s14.example", pageViews: 14, visitors: 1 });
    expect(rows[9].pageViews).toBe(5);
  });

  it("rejects a referrer row with a non-string hostname or invalid counts", () => {
    expect(() => parseReferrerRows({ data: [{ referrerHostname: 5, pageviews: 1, visitors: 1 }] })).toThrow();
    expect(() => parseReferrerRows({ data: [{ referrerHostname: "x", pageviews: "1", visitors: 1 }] })).toThrow();
    expect(() => parseReferrerRows({})).toThrow();
  });
});

describe("getWebsiteTraffic — activation gate, requests and failure handling", () => {
  it("disabled: returns 'disabled' and makes no network request", async () => {
    const fetchImpl = routedFetch({});
    expect(await getWebsiteTraffic({ periodDays: 30 }, NOW, { env: {}, fetchImpl })).toEqual({ status: "disabled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("enabled but misconfigured: returns the missing variable names and makes no request", async () => {
    const fetchImpl = routedFetch({});
    const result = await getWebsiteTraffic({ periodDays: 30 }, NOW, { env: { ...READY_ENV, VERCEL_ANALYTICS_TOKEN: "" }, fetchImpl });
    expect(result).toEqual({ status: "not_configured", missing: ["VERCEL_ANALYTICS_TOKEN"] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("collection start in the future: 'not_started', no request", async () => {
    const fetchImpl = routedFetch({});
    const result = await getWebsiteTraffic({ periodDays: 30 }, NOW, { env: { ...READY_ENV, WEBSITE_TRAFFIC_COLLECTION_START: "2026-12-01" }, fetchImpl });
    expect(result).toEqual({ status: "not_started", collectionStart: "2026-12-01" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the documented request: GET visits/aggregate with Bearer auth, the marketing project, UTC dates and one dimension", async () => {
    const fetchImpl = routedFetch({ day: () => json(dailyBody([["2026-11-18", 10, 6]])), referrer: () => json(referrerBody([["news.example", 9, 5]])) });
    const result = await getWebsiteTraffic({ periodDays: 7 }, NOW, { env: { ...READY_ENV, VERCEL_ANALYTICS_TEAM_ID: "team_abc1" }, fetchImpl });

    expect(result.status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const calls = fetchImpl.mock.calls.map(([input, init]) => ({ url: new URL(String(input)), init: init as RequestInit }));
    const day = calls.find((c) => c.url.searchParams.get("by") === "day")!;
    expect(day.url.origin + day.url.pathname).toBe("https://api.vercel.com/v1/query/web-analytics/visits/aggregate");
    expect(day.url.searchParams.get("projectId")).toBe("prj_marketing123");
    expect(day.url.searchParams.get("teamId")).toBe("team_abc1");
    expect(day.url.searchParams.get("since")).toBe("2026-11-14");
    expect(day.url.searchParams.get("until")).toBe("2026-11-20");
    expect(day.init.method).toBe("GET");
    expect((day.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    const referrer = calls.find((c) => c.url.searchParams.get("by") === "referrerHostname")!;
    expect(referrer.url.searchParams.get("limit")).toBe("10");
  });

  it("never puts the token in a URL, a result, or the cache key", async () => {
    const fetchImpl = routedFetch({ day: () => json(dailyBody([["2026-11-18", 10, 6]])) });
    const result = await getWebsiteTraffic({ periodDays: 7 }, NOW, { env: READY_ENV, fetchImpl });
    for (const [input] of fetchImpl.mock.calls) expect(String(input)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("never asks for days before collection started", async () => {
    const fetchImpl = routedFetch({});
    await getWebsiteTraffic({ periodDays: 30 }, NOW, { env: { ...READY_ENV, WEBSITE_TRAFFIC_COLLECTION_START: "2026-11-18" }, fetchImpl });
    const since = new URL(String(fetchImpl.mock.calls[0][0])).searchParams.get("since");
    expect(since).toBe("2026-11-18");
  });

  it("Hobby reporting window: a 90-day period is clipped to the window and says so; a period inside the window is not", async () => {
    const fetchImpl = routedFetch({});
    const clipped = await getWebsiteTraffic({ periodDays: 90 }, NOW, { env: { ...READY_ENV, WEBSITE_TRAFFIC_COLLECTION_START: "2026-01-01" }, fetchImpl });
    expect(clipped).toMatchObject({ status: "ok", period: { requestedDays: 90, shownDays: 30, clippedToReportingWindow: true, reportingWindowDays: 30 } });
    if (clipped.status === "ok") expect(clipped.points).toHaveLength(30);
    expect(new URL(String(fetchImpl.mock.calls[0][0])).searchParams.get("since")).toBe("2026-10-22");

    clearWebsiteTrafficCache();
    const within = await getWebsiteTraffic({ periodDays: 7 }, NOW, { env: { ...READY_ENV, WEBSITE_TRAFFIC_COLLECTION_START: "2026-01-01" }, fetchImpl });
    expect(within).toMatchObject({ status: "ok", period: { clippedToReportingWindow: false, shownDays: 7 } });
  });

  it("a longer plan window allows the full 90 days", async () => {
    const result = await getWebsiteTraffic({ periodDays: 90 }, NOW, {
      env: { ...READY_ENV, WEBSITE_TRAFFIC_COLLECTION_START: "2026-01-01", WEBSITE_TRAFFIC_REPORTING_WINDOW_DAYS: "365" },
      fetchImpl: routedFetch({}),
    });
    expect(result).toMatchObject({ status: "ok", period: { shownDays: 90, clippedToReportingWindow: false } });
  });

  it("genuine zero activity since collection started is 'ok' with zeros, not an error", async () => {
    const result = await getWebsiteTraffic({ periodDays: 7 }, NOW, { env: READY_ENV, fetchImpl: routedFetch({}) });
    expect(result).toMatchObject({ status: "ok", totals: { pageViews: 0, averageDailyVisitors: 0 } });
  });

  it.each([
    [401, "auth_failed"],
    [403, "auth_failed"],
    [429, "rate_limited"],
    [400, "unsupported_range"],
    [410, "unsupported_range"],
    [402, "plan_limit"],
    [503, "upstream_error"],
    [500, "upstream_error"],
    [418, "upstream_error"],
  ])("HTTP %i becomes a typed 'unavailable' (%s) and never throws", async (status, reason) => {
    const result = await getWebsiteTraffic({ periodDays: 7 }, NOW, {
      env: READY_ENV,
      fetchImpl: routedFetch({ day: () => json({ error: { code: "x", message: `secret ${TOKEN}` } }, status) }),
    });
    expect(result).toEqual({ status: "unavailable", reason, collectionStart: "2026-11-10" });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("a timeout and a network error are typed, not thrown", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    expect(
      await getWebsiteTraffic({ periodDays: 7 }, NOW, { env: READY_ENV, fetchImpl: vi.fn(async () => { throw timeout; }) as unknown as typeof fetch }),
    ).toMatchObject({ status: "unavailable", reason: "timeout" });
    clearWebsiteTrafficCache();
    expect(
      await getWebsiteTraffic({ periodDays: 7 }, NOW, { env: READY_ENV, fetchImpl: vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch }),
    ).toMatchObject({ status: "unavailable", reason: "upstream_error" });
  });

  it("an unreadable or schema-invalid body is 'invalid_response'", async () => {
    expect(
      await getWebsiteTraffic({ periodDays: 7 }, NOW, { env: READY_ENV, fetchImpl: routedFetch({ day: () => new Response("<html>", { status: 200 }) }) }),
    ).toMatchObject({ status: "unavailable", reason: "invalid_response" });
    clearWebsiteTrafficCache();
    expect(
      await getWebsiteTraffic({ periodDays: 7 }, NOW, { env: READY_ENV, fetchImpl: routedFetch({ day: () => json({ data: [{ timestamp: "2026-11-18T00:00:00Z", pageviews: "many", visitors: 1 }] }) }) }),
    ).toMatchObject({ status: "unavailable", reason: "invalid_response" });
  });

  it("a failing referrer query alone leaves the daily data intact", async () => {
    const result = await getWebsiteTraffic({ periodDays: 7 }, NOW, {
      env: READY_ENV,
      fetchImpl: routedFetch({ day: () => json(dailyBody([["2026-11-18", 10, 6]])), referrer: () => json({}, 429) }),
    });
    expect(result).toMatchObject({ status: "ok", referrers: null, totals: { pageViews: 10 } });
  });
});

describe("caching and request bounds", () => {
  it("serves repeat calls from the cache: two API calls for the first render, none for the second", async () => {
    const fetchImpl = routedFetch({ day: () => json(dailyBody([["2026-11-18", 10, 6]])) });
    let t = 1_000_000;
    const deps = { env: READY_ENV, fetchImpl, nowMs: () => t };
    await getWebsiteTraffic({ periodDays: 7 }, NOW, deps);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    t += 10 * 60 * 1000;
    await getWebsiteTraffic({ periodDays: 7 }, NOW, deps);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    t += 25 * 60 * 1000; // past the 30 minute TTL
    await getWebsiteTraffic({ periodDays: 7 }, NOW, deps);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("briefly remembers a failure so an outage or a 429 is not hammered, then retries", async () => {
    const fetchImpl = routedFetch({ day: () => json({}, 429) });
    let t = 2_000_000;
    const deps = { env: READY_ENV, fetchImpl, nowMs: () => t };
    await getWebsiteTraffic({ periodDays: 7 }, NOW, deps);
    const afterFirst = fetchImpl.mock.calls.length;
    t += 10_000;
    expect(await getWebsiteTraffic({ periodDays: 7 }, NOW, deps)).toMatchObject({ reason: "rate_limited" });
    expect(fetchImpl.mock.calls.length).toBe(afterFirst);
    t += 61_000;
    await getWebsiteTraffic({ periodDays: 7 }, NOW, deps);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it("different periods use different cache entries", async () => {
    const fetchImpl = routedFetch({});
    await getWebsiteTraffic({ periodDays: 7 }, NOW, { env: READY_ENV, fetchImpl });
    await getWebsiteTraffic({ periodDays: 30 }, NOW, { env: READY_ENV, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
