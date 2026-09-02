import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * AI Assistant orchestration + Route Handler batch — direct HTTP/API
 * contract coverage, mirroring test/e2e/search-api.spec.ts's own
 * established structure exactly: no AI UI exists yet (a later batch's
 * own concern), so every request here goes through Playwright's
 * `request` API context against the real production build (`next
 * start`) this whole E2E suite already runs against, with TEST_MODE=1
 * (playwright.config.ts's own webServer.env) — which is exactly what
 * makes the route resolve to a real, mock-backed answer at all (see
 * src/lib/ai/providers/provider-factory.ts's own doc comment; the
 * Production/TEST_MODE-off fail-closed path is proven separately, at the
 * source/integration level, by test/integration/ai/route-fail-closed.test.ts
 * — Playwright's own webServer always runs with TEST_MODE=1, so that
 * state cannot be exercised from this file).
 */

const PLATFORM_ADMIN_EMAIL = "platform-admin-e2e@example.com";

async function setActiveOrg(context: BrowserContext, baseURL: string, organizationId: string): Promise<void> {
  await context.addCookies([
    {
      name: "active_organization_id",
      value: organizationId,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test("no session -> 401 JSON, no redirect Location, no HTML", async ({ context, baseURL }) => {
  const response = await context.request.post(`${baseURL}/api/ai/assistant`, { data: { message: "hello" } });
  expect(response.status()).toBe(401);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(response.headers()["location"]).toBeUndefined();
  const body = await response.json();
  expect(body).toEqual({ error: expect.any(String) });
  const text = JSON.stringify(body);
  expect(text.toLowerCase()).not.toContain("<html");
});

test("Portal session -> 403 JSON", async ({ context, baseURL }) => {
  await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL!);
  const response = await context.request.post(`${baseURL}/api/ai/assistant`, { data: { message: "hello" } });
  expect(response.status()).toBe(403);
  expect(response.headers()["content-type"]).toContain("application/json");
  const body = await response.json();
  expect(body).toEqual({ error: expect.any(String) });
});

test("Platform Admin session -> 403 JSON", async ({ context, baseURL }) => {
  await injectTestSession(context, { id: "e2e-ai-platform-admin", email: PLATFORM_ADMIN_EMAIL }, baseURL!);
  const response = await context.request.post(`${baseURL}/api/ai/assistant`, { data: { message: "hello" } });
  expect(response.status()).toBe(403);
  const body = await response.json();
  expect(body).toEqual({ error: expect.any(String) });
});

test("dual identity (Platform Admin allowlisted AND a real staff User/Membership) -> still 403", async ({ context, baseURL }) => {
  const dualId = randomUUID();
  await dbQuery("user", "create", { data: { id: dualId, email: PLATFORM_ADMIN_EMAIL, name: "Dual Platform Admin + Staff (E2E)" } });
  await dbQuery("membership", "create", { data: { userId: dualId, organizationId: fixtures.orgA.id, role: "OWNER" } });
  try {
    await injectTestSession(context, { id: dualId, email: PLATFORM_ADMIN_EMAIL }, baseURL!);
    const response = await context.request.post(`${baseURL}/api/ai/assistant`, { data: { message: "hello" } });
    expect(response.status()).toBe(403);
  } finally {
    await dbQuery("membership", "deleteMany", { where: { userId: dualId } });
    await dbQuery("user", "delete", { where: { id: dualId } });
  }
});

test("staff session -> 200 JSON with the stable {answer} response shape, deterministic mock content", async ({ context, baseURL }) => {
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  await setActiveOrg(context, baseURL!, fixtures.orgA.id);

  const response = await context.request.post(`${baseURL}/api/ai/assistant`, { data: { message: "How many clients do we have?" } });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");

  const body = await response.json();
  expect(Object.keys(body)).toEqual(["answer"]);
  expect(typeof body.answer).toBe("string");
  // The route's own fixed, deterministic mock script (never influenced
  // by the request body — see route.ts's own ROUTE_MOCK_SCRIPT) — this
  // is also direct proof no real provider/vendor network call happened:
  // a real provider would never produce this exact literal string.
  expect(body.answer).toBe("This is a mock AI Assistant response for automated testing.");
});

test("Cache-Control is private, no-store on a real response", async ({ context, baseURL }) => {
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  await setActiveOrg(context, baseURL!, fixtures.orgA.id);
  const response = await context.request.post(`${baseURL}/api/ai/assistant`, { data: { message: "hello" } });
  const cacheControl = response.headers()["cache-control"] ?? "";
  expect(cacheControl).toContain("no-store");
  expect(cacheControl).toContain("private");
});

test("security headers (CSP etc.) are still present on the AI route", async ({ context, baseURL }) => {
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  await setActiveOrg(context, baseURL!, fixtures.orgA.id);
  const response = await context.request.post(`${baseURL}/api/ai/assistant`, { data: { message: "hello" } });
  const headers = response.headers();
  expect(headers["content-security-policy"]).toBeTruthy();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
});

test.describe("body validation", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
    await setActiveOrg(context, baseURL!, fixtures.orgA.id);
  });

  test("malformed (non-JSON) body -> 400", async ({ context, baseURL }) => {
    const response = await context.request.post(`${baseURL}/api/ai/assistant`, {
      headers: { "Content-Type": "application/json" },
      data: "not valid json",
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request." });
  });

  test("oversized message (> 2000 chars) -> 400", async ({ context, baseURL }) => {
    const response = await context.request.post(`${baseURL}/api/ai/assistant`, { data: { message: "a".repeat(2001) } });
    expect(response.status()).toBe(400);
  });

  test("unknown key -> 400", async ({ context, baseURL }) => {
    const response = await context.request.post(`${baseURL}/api/ai/assistant`, {
      data: { message: "hello", organizationId: fixtures.orgB.id },
    });
    expect(response.status()).toBe(400);
  });

  test("empty/whitespace-only message -> 400", async ({ context, baseURL }) => {
    const response = await context.request.post(`${baseURL}/api/ai/assistant`, { data: { message: "    " } });
    expect(response.status()).toBe(400);
  });
});

test("rate limiting: enough requests in a burst eventually returns 429 JSON, without leaking counters", async ({ context, baseURL }) => {
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  await setActiveOrg(context, baseURL!, fixtures.orgA.id);

  let limitedResponse: Awaited<ReturnType<typeof context.request.post>> | null = null;
  // AI_ASSISTANT_LIMIT is 20/hour (src/lib/rate-limit/limits.ts) —
  // comfortably exceeded by 21 sequential requests within this one test.
  for (let i = 0; i < 21; i++) {
    const response = await context.request.post(`${baseURL}/api/ai/assistant`, { data: { message: `burst ${i}` } });
    if (response.status() === 429) {
      limitedResponse = response;
      break;
    }
  }

  expect(limitedResponse).not.toBeNull();
  expect(limitedResponse!.headers()["content-type"]).toContain("application/json");
  const body = await limitedResponse!.json();
  expect(body).toEqual({ error: "Too many requests. Please try again later." });
});
