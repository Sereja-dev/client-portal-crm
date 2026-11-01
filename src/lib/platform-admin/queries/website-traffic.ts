import { requirePlatformAdmin } from "@/lib/platform-admin/authorization";
import { startOfUtcDay } from "@/lib/platform-admin/queries/platform-dashboard";

/**
 * Website Traffic V1. Server-only, Platform-Admin-only, read-only access to
 * the OFFICIAL Vercel Web Analytics query API for the marketing site
 * (aqenra.com), shown on /platform-admin/growth. Documented contract this
 * module relies on and nothing more (https://vercel.com/docs/analytics/
 * web-analytics-api):
 *
 *   GET https://api.vercel.com/v1/query/web-analytics/visits/aggregate
 *   Authorization: Bearer <token>
 *   query: projectId (+ teamId), since, until (dates, both included), by
 *          (one dimension: `day`, `referrerHostname`), limit (referrers)
 *   200: { version, query, data: [ { timestamp | referrerHostname,
 *          pageviews, visitors } ] }
 *   errors: 400 invalid query, 401/403 auth, 402/410 plan or retention,
 *          429 rate limited, 503 unavailable.
 *
 * Semantics (the page repeats them next to the numbers):
 *   - Vercel identifies a visitor by a hash of the request that resets every
 *     day (no cookies). `visitors` is therefore a per-UTC-day figure: a
 *     returning person counts again on each day they visit. It is NEVER
 *     summed into "unique people over the period", and no session/visit
 *     count is produced — the API supports page views and visitors only.
 *   - Page views are additive and may be summed.
 *   - Aggregate queries are limited to the plan's reporting window (Hobby: 1
 *     month); a longer period is clipped to it and reported as such.
 *   - The day bucketing timezone is not stated by the docs; the example
 *     timestamps are midnight UTC and this module treats them as UTC days.
 *     Confirm at activation (an activation gate, not an assumption of
 *     correctness).
 *
 * Activation is explicit and fail-closed. Nothing is fetched unless
 * WEBSITE_TRAFFIC_ENABLED is exactly "true" AND the token, the marketing
 * project id and the collection start date are configured. There is no
 * fallback to any other project — in particular never to the CRM's own
 * (VERCEL_PROJECT_ID is deliberately never read) — and the token is read
 * only here, on the server, and never logged or returned. This module logs
 * nothing at all.
 *
 * Resilience: bounded requests (one timeout, no retries), an in-process
 * cache (per serverless instance, like this app's rate limiter) and a short
 * negative cache so an outage or rate limit is not hammered. Every failure
 * becomes a typed `unavailable` result; this function never throws (apart
 * from the authorization redirect), so a Vercel outage cannot affect the
 * registration dashboard rendered alongside it.
 */

export const WEBSITE_TRAFFIC_SITE = "aqenra.com";
export const WEBSITE_TRAFFIC_SOURCE = "Vercel Web Analytics";

const API_ENDPOINT = "https://api.vercel.com/v1/query/web-analytics/visits/aggregate";
const REQUEST_TIMEOUT_MS = 4_000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 32;
const DEFAULT_REPORTING_WINDOW_DAYS = 30;
const TOP_REFERRERS_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export type WebsiteTrafficUnavailableReason =
  | "auth_failed"
  | "rate_limited"
  | "timeout"
  | "upstream_error"
  | "invalid_response"
  | "unsupported_range"
  | "plan_limit";

export type WebsiteTrafficPoint = {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string;
  /** Page views that day; null for a day before collection started (no data, not zero). */
  pageViews: number | null;
  /** Daily unique visitors that day (a per-day figure, not people); null before collection started. */
  visitors: number | null;
};

export type WebsiteTrafficReferrer = { hostname: string | null; pageViews: number; visitors: number };

export type WebsiteTrafficResult =
  | { status: "disabled" }
  | { status: "not_configured"; missing: string[] }
  | { status: "not_started"; collectionStart: string }
  | { status: "unavailable"; reason: WebsiteTrafficUnavailableReason; collectionStart: string }
  | {
      status: "ok";
      site: string;
      source: string;
      collectionStart: string;
      period: {
        requestedDays: number;
        shownDays: number;
        /** True when the requested period is longer than the plan's reporting window and was clipped to it. */
        clippedToReportingWindow: boolean;
        reportingWindowDays: number;
      };
      points: WebsiteTrafficPoint[];
      totals: {
        pageViews: number;
        /** Mean of the daily visitor figures over COMPLETED UTC days with collection; null if there is none yet. */
        averageDailyVisitors: number | null;
        busiestDay: { date: string; visitors: number } | null;
        trackedDays: number;
      };
      /** Null when the referrer query alone failed; the daily data above is still valid. */
      referrers: WebsiteTrafficReferrer[] | null;
    };

type Env = Record<string, string | undefined>;

export type WebsiteTrafficConfig =
  | { state: "disabled" }
  | { state: "not_configured"; missing: string[] }
  | {
      state: "ready";
      token: string;
      projectId: string;
      teamId: string | null;
      collectionStart: string;
      reportingWindowDays: number;
    };

function isValidIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Strict, explicit gate: only the literal "true" enables (the same
 * discipline as FREE_BETA_MODE). Reports missing variable NAMES only,
 * never any value.
 */
export function readWebsiteTrafficConfig(env: Env = process.env): WebsiteTrafficConfig {
  if (env.WEBSITE_TRAFFIC_ENABLED !== "true") return { state: "disabled" };

  const token = env.VERCEL_ANALYTICS_TOKEN?.trim() ?? "";
  const projectId = env.VERCEL_ANALYTICS_PROJECT_ID?.trim() ?? "";
  const teamId = env.VERCEL_ANALYTICS_TEAM_ID?.trim() || null;
  const collectionStart = env.WEBSITE_TRAFFIC_COLLECTION_START?.trim() ?? "";
  const windowRaw = env.WEBSITE_TRAFFIC_REPORTING_WINDOW_DAYS?.trim();

  const missing: string[] = [];
  if (!token) missing.push("VERCEL_ANALYTICS_TOKEN");
  if (!/^prj_[A-Za-z0-9]+$/.test(projectId)) missing.push("VERCEL_ANALYTICS_PROJECT_ID");
  if (teamId !== null && !/^team_[A-Za-z0-9]+$/.test(teamId)) missing.push("VERCEL_ANALYTICS_TEAM_ID");
  if (!isValidIsoDay(collectionStart)) missing.push("WEBSITE_TRAFFIC_COLLECTION_START");

  let reportingWindowDays = DEFAULT_REPORTING_WINDOW_DAYS;
  if (windowRaw !== undefined && windowRaw !== "") {
    const parsed = Number(windowRaw);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 365) reportingWindowDays = parsed;
    else missing.push("WEBSITE_TRAFFIC_REPORTING_WINDOW_DAYS");
  }

  if (missing.length > 0) return { state: "not_configured", missing };
  return { state: "ready", token, projectId, teamId, collectionStart, reportingWindowDays };
}

type DailyRow = { date: string; pageViews: number; visitors: number };

/**
 * Pure and exported for tests. One point per UTC day in the window ending
 * today (partial). Days before collection started are null (no data); days
 * since then are the API's figure or a genuine 0 when the API returned no
 * row for that day.
 */
export function buildTrafficSeries(params: {
  now: Date;
  days: number;
  collectionStart: string;
  rows: readonly DailyRow[];
}): { points: WebsiteTrafficPoint[]; totals: Extract<WebsiteTrafficResult, { status: "ok" }>["totals"] } {
  const today = startOfUtcDay(params.now).getTime();
  const byDate = new Map(params.rows.map((r) => [r.date, r]));

  const points: WebsiteTrafficPoint[] = Array.from({ length: params.days }, (_, i) => {
    const date = new Date(today - (params.days - 1 - i) * DAY_MS).toISOString().slice(0, 10);
    if (date < params.collectionStart) return { date, pageViews: null, visitors: null };
    const row = byDate.get(date);
    return { date, pageViews: row?.pageViews ?? 0, visitors: row?.visitors ?? 0 };
  });

  const tracked = points.filter((p) => p.visitors !== null);
  const todayDate = new Date(today).toISOString().slice(0, 10);
  const completed = tracked.filter((p) => p.date !== todayDate);
  const busiest = tracked.reduce<{ date: string; visitors: number } | null>(
    (best, p) => (p.visitors! > 0 && (!best || p.visitors! > best.visitors) ? { date: p.date, visitors: p.visitors! } : best),
    null,
  );

  return {
    points,
    totals: {
      pageViews: tracked.reduce((sum, p) => sum + (p.pageViews ?? 0), 0),
      averageDailyVisitors: completed.length
        ? Math.round((completed.reduce((sum, p) => sum + p.visitors!, 0) / completed.length) * 10) / 10
        : null,
      busiestDay: busiest,
      trackedDays: tracked.length,
    },
  };
}

class TrafficFailure extends Error {
  constructor(readonly reason: WebsiteTrafficUnavailableReason) {
    super(reason);
  }
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function parseDailyRows(body: unknown, sinceDay: string, untilDay: string): DailyRow[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new TrafficFailure("invalid_response");
  const seen = new Set<string>();
  const rows: DailyRow[] = [];
  for (const row of data) {
    const r = row as { timestamp?: unknown; pageviews?: unknown; visitors?: unknown } | null;
    if (!r || typeof r.timestamp !== "string" || !isCount(r.pageviews) || !isCount(r.visitors)) {
      throw new TrafficFailure("invalid_response");
    }
    const parsed = new Date(r.timestamp);
    if (Number.isNaN(parsed.getTime())) throw new TrafficFailure("invalid_response");
    const date = parsed.toISOString().slice(0, 10);
    if (seen.has(date)) throw new TrafficFailure("invalid_response");
    seen.add(date);
    if (date < sinceDay || date > untilDay) continue;
    rows.push({ date, pageViews: r.pageviews, visitors: r.visitors });
  }
  return rows;
}

export function parseReferrerRows(body: unknown): WebsiteTrafficReferrer[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new TrafficFailure("invalid_response");
  return data
    .map((row) => {
      const r = row as { referrerHostname?: unknown; pageviews?: unknown; visitors?: unknown } | null;
      if (!r || !isCount(r.pageviews) || !isCount(r.visitors)) throw new TrafficFailure("invalid_response");
      if (r.referrerHostname !== undefined && r.referrerHostname !== null && typeof r.referrerHostname !== "string") {
        throw new TrafficFailure("invalid_response");
      }
      const hostname = typeof r.referrerHostname === "string" && r.referrerHostname.trim() ? r.referrerHostname.trim() : null;
      return { hostname, pageViews: r.pageviews, visitors: r.visitors };
    })
    .sort((a, b) => b.pageViews - a.pageViews)
    .slice(0, TOP_REFERRERS_LIMIT);
}

type CacheEntry = { at: number; expiresInMs: number; value: unknown } | { at: number; expiresInMs: number; failure: WebsiteTrafficUnavailableReason };
const cache = new Map<string, CacheEntry>();

/** Test hook: clears the in-process cache. */
export function clearWebsiteTrafficCache(): void {
  cache.clear();
}

type Deps = {
  env?: Env;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
};

async function requestAggregate(
  config: Extract<WebsiteTrafficConfig, { state: "ready" }>,
  query: { by: "day" | "referrerHostname"; since: string; until: string; limit?: number },
  deps: Deps,
): Promise<unknown> {
  // The cache key contains the query only — never the token.
  const key = [config.projectId, config.teamId ?? "", query.by, query.since, query.until, query.limit ?? ""].join("|");
  const nowMs = (deps.nowMs ?? Date.now)();
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < hit.expiresInMs) {
    if ("failure" in hit) throw new TrafficFailure(hit.failure);
    return hit.value;
  }

  const url = new URL(API_ENDPOINT);
  url.searchParams.set("projectId", config.projectId);
  if (config.teamId) url.searchParams.set("teamId", config.teamId);
  url.searchParams.set("since", query.since);
  url.searchParams.set("until", query.until);
  url.searchParams.set("by", query.by);
  if (query.limit) url.searchParams.set("limit", String(query.limit));

  const remember = (entry: CacheEntry) => {
    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(key, entry);
  };

  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason: WebsiteTrafficUnavailableReason =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError") ? "timeout" : "upstream_error";
    remember({ at: nowMs, expiresInMs: FAILURE_CACHE_TTL_MS, failure: reason });
    throw new TrafficFailure(reason);
  }

  if (!response.ok) {
    const s = response.status;
    const reason: WebsiteTrafficUnavailableReason =
      s === 401 || s === 403 ? "auth_failed"
      : s === 429 ? "rate_limited"
      : s === 400 || s === 410 ? "unsupported_range"
      : s === 402 ? "plan_limit"
      : "upstream_error";
    remember({ at: nowMs, expiresInMs: FAILURE_CACHE_TTL_MS, failure: reason });
    throw new TrafficFailure(reason);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    remember({ at: nowMs, expiresInMs: FAILURE_CACHE_TTL_MS, failure: "invalid_response" });
    throw new TrafficFailure("invalid_response");
  }
  remember({ at: nowMs, expiresInMs: CACHE_TTL_MS, value: body });
  return body;
}

/**
 * The one entry point. requirePlatformAdmin() is the first awaited
 * statement, before the activation gate or any network access.
 */
export async function getWebsiteTraffic(
  params: { periodDays: number },
  now: Date,
  deps: Deps = {},
): Promise<WebsiteTrafficResult> {
  await requirePlatformAdmin();

  const config = readWebsiteTrafficConfig(deps.env ?? process.env);
  if (config.state === "disabled") return { status: "disabled" };
  if (config.state === "not_configured") return { status: "not_configured", missing: config.missing };

  const todayStart = startOfUtcDay(now);
  const todayDay = todayStart.toISOString().slice(0, 10);
  if (todayDay < config.collectionStart) return { status: "not_started", collectionStart: config.collectionStart };

  const requestedDays = params.periodDays;
  const shownDays = Math.min(requestedDays, config.reportingWindowDays);
  const sinceDay = new Date(todayStart.getTime() - (shownDays - 1) * DAY_MS).toISOString().slice(0, 10);
  // Never ask for days before collection started: there is nothing to read.
  const querySince = sinceDay < config.collectionStart ? config.collectionStart : sinceDay;

  try {
    const dailyBody = await requestAggregate(config, { by: "day", since: querySince, until: todayDay }, deps);
    const rows = parseDailyRows(dailyBody, querySince, todayDay);

    let referrers: WebsiteTrafficReferrer[] | null = null;
    try {
      const referrerBody = await requestAggregate(
        config,
        { by: "referrerHostname", since: querySince, until: todayDay, limit: TOP_REFERRERS_LIMIT },
        deps,
      );
      referrers = parseReferrerRows(referrerBody);
    } catch {
      referrers = null;
    }

    const { points, totals } = buildTrafficSeries({ now, days: shownDays, collectionStart: config.collectionStart, rows });
    return {
      status: "ok",
      site: WEBSITE_TRAFFIC_SITE,
      source: WEBSITE_TRAFFIC_SOURCE,
      collectionStart: config.collectionStart,
      period: {
        requestedDays,
        shownDays,
        clippedToReportingWindow: requestedDays > shownDays,
        reportingWindowDays: config.reportingWindowDays,
      },
      points,
      totals,
      referrers,
    };
  } catch (err) {
    return {
      status: "unavailable",
      reason: err instanceof TrafficFailure ? err.reason : "upstream_error",
      collectionStart: config.collectionStart,
    };
  }
}
