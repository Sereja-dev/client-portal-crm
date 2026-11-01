import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getGrowthSummary, listRegistrations, parseGrowthParams } from "@/lib/platform-admin/queries/growth";
import { clearWebsiteTrafficCache, getWebsiteTraffic } from "@/lib/platform-admin/queries/website-traffic";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { setMockAuthUser, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

// Website Traffic V1 — the REAL requirePlatformAdmin() guard in front of
// getWebsiteTraffic(), and independence from the registration queries. The
// Vercel API is always an injected mock; the live API is never called.

const ADMIN_EMAIL = "platform-admin-traffic-test@example.com";
const NON_ADMIN_EMAIL = "not-a-platform-admin-traffic-test@example.com";
const ORIGINAL_ADMIN_EMAILS = process.env.PLATFORM_ADMIN_EMAILS;
const NOW = new Date("2026-11-20T10:00:00.000Z");
const ENV = {
  WEBSITE_TRAFFIC_ENABLED: "true",
  VERCEL_ANALYTICS_TOKEN: "vcp_integration_test_token",
  VERCEL_ANALYTICS_PROJECT_ID: "prj_marketing123",
  WEBSITE_TRAFFIC_COLLECTION_START: "2026-11-10",
};

let fixtures: TestFixtures;

const okFetch = () =>
  vi.fn(async (input: RequestInfo | URL) =>
    new Response(
      JSON.stringify(
        new URL(String(input)).searchParams.get("by") === "day"
          ? { version: 1, data: [{ timestamp: "2026-11-18T00:00:00.000Z", pageviews: 5, visitors: 3 }] }
          : { version: 1, data: [{ referrerHostname: "news.example", pageviews: 4, visitors: 2 }] },
      ),
      { status: 200 },
    ),
  );

beforeAll(async () => {
  fixtures = await seedTestData();
  process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
});

beforeEach(() => {
  clearWebsiteTrafficCache();
});

afterEach(() => {
  resetAuthMock();
  vi.restoreAllMocks();
});

afterAll(async () => {
  process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS;
  await cleanupTestData(fixtures);
});

async function catchRedirect(fn: () => Promise<unknown>): Promise<RedirectSignal> {
  let caught: unknown;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
  return caught as RedirectSignal;
}

describe("getWebsiteTraffic — authorization before any analytics request", () => {
  it("unauthenticated: redirects to /login and sends no request, even with analytics fully enabled", async () => {
    setMockAuthUser(null);
    const fetchImpl = okFetch();
    const signal = await catchRedirect(() => getWebsiteTraffic({ periodDays: 30 }, NOW, { env: ENV, fetchImpl }));
    expect(signal.url).toBe("/login?reason=session_expired");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("authenticated Staff who is not allowlisted: redirects to /dashboard and sends no request", async () => {
    setMockAuthUser({ id: randomUUID(), email: NON_ADMIN_EMAIL });
    const fetchImpl = okFetch();
    const signal = await catchRedirect(() => getWebsiteTraffic({ periodDays: 30 }, NOW, { env: ENV, fetchImpl }));
    expect(signal.url).toBe("/dashboard");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a Client Portal identity is denied the same way, with no request", async () => {
    setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
    const fetchImpl = okFetch();
    const signal = await catchRedirect(() => getWebsiteTraffic({ periodDays: 30 }, NOW, { env: ENV, fetchImpl }));
    expect(signal.url).toBe("/dashboard");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("the allowlisted admin with analytics disabled gets 'disabled' and still sends no request", async () => {
    setMockAuthUser({ id: randomUUID(), email: ADMIN_EMAIL });
    const fetchImpl = okFetch();
    expect(await getWebsiteTraffic({ periodDays: 30 }, NOW, { env: {}, fetchImpl })).toEqual({ status: "disabled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("the allowlisted admin with analytics enabled gets mocked data, exactly two bounded requests", async () => {
    setMockAuthUser({ id: randomUUID(), email: ADMIN_EMAIL });
    const fetchImpl = okFetch();
    const result = await getWebsiteTraffic({ periodDays: 7 }, NOW, { env: ENV, fetchImpl });
    expect(result).toMatchObject({ status: "ok", site: "aqenra.com", source: "Vercel Web Analytics", totals: { pageViews: 5 } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("independence from the registration dashboard", () => {
  it("an analytics outage leaves the registration summary and directory fully working", async () => {
    setMockAuthUser({ id: randomUUID(), email: ADMIN_EMAIL });
    const failingFetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const [traffic, summary, directory] = await Promise.all([
      getWebsiteTraffic({ periodDays: 30 }, NOW, { env: ENV, fetchImpl: failingFetch }),
      getGrowthSummary({ periodDays: 30 }, NOW),
      listRegistrations(parseGrowthParams({})),
    ]);

    expect(traffic).toMatchObject({ status: "unavailable", reason: "upstream_error" });
    expect(summary.signups.identities).toBeGreaterThanOrEqual(0);
    expect(directory.total).toBeGreaterThanOrEqual(0);
  });

  it("the traffic reader performs no registration (database) reads, and the registration readers perform no analytics requests", async () => {
    setMockAuthUser({ id: randomUUID(), email: ADMIN_EMAIL });
    const fetchImpl = okFetch();

    const dbSpies = [vi.spyOn(prisma.signupAttempt, "count"), vi.spyOn(prisma.user, "count"), vi.spyOn(prisma, "$transaction")];
    await getWebsiteTraffic({ periodDays: 7 }, NOW, { env: ENV, fetchImpl });
    dbSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());

    fetchImpl.mockClear();
    await getGrowthSummary({ periodDays: 7 }, NOW);
    await listRegistrations(parseGrowthParams({}));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
