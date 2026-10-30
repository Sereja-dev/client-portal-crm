import { test, expect } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Platform Admin Organization Suspension, PR 1 (design investigation:
 * PLATFORM_ADMIN_ORGANIZATION_SUSPENSION_DESIGN). No mutation or UI exists
 * yet — every Organization.suspendedAt value here is set directly via
 * dbQuery, exactly the way a real Platform Admin action will set it once
 * PR 2 ships. This file proves the read-side denial/route-level contract
 * only: the exact HTTP status/redirect behavior, and that the unavailable
 * page discloses nothing.
 */

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  // Always leave the fixture organization active before cleanup runs,
  // regardless of which test last ran or failed.
  await dbQuery("organization", "update", { where: { id: fixtures.orgA.id }, data: { suspendedAt: null } });
  await cleanupTestData(fixtures);
});

test.afterEach(async () => {
  await dbQuery("organization", "update", { where: { id: fixtures.orgA.id }, data: { suspendedAt: null } });
});

test("regression: an active organization's dashboard renders exactly as before", async ({ context, baseURL }) => {
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
});

test("a suspended organization's staff (OWNER) is redirected to /organization-unavailable", async ({ context, baseURL }) => {
  await dbQuery("organization", "update", { where: { id: fixtures.orgA.id }, data: { suspendedAt: new Date().toISOString() } });
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/organization-unavailable$/);
  await expect(page.getByRole("heading", { name: "Workspace unavailable" })).toBeVisible();
  // "Contact support." is plain text, or "Contact support at <mailto link>." when a platform support address is
  // configured (Support Email UX Cleanup) — the same fixed, organization-agnostic sentence either way.
  await expect(page.getByText(/This workspace is currently unavailable\. Contact support/)).toBeVisible();
});

test("a suspended organization's staff (MEMBER) is redirected too — not role-specific", async ({ context, baseURL }) => {
  await dbQuery("organization", "update", { where: { id: fixtures.orgA.id }, data: { suspendedAt: new Date().toISOString() } });
  await injectTestSession(context, { id: fixtures.member.id, email: fixtures.member.email }, baseURL!);
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/organization-unavailable$/);
});

test("the unavailable page discloses no reason, timestamp, actor email, organization name/id, or raw error — and has no interactive control", async ({
  context,
  baseURL,
}) => {
  await dbQuery("organization", "update", { where: { id: fixtures.orgA.id }, data: { suspendedAt: new Date().toISOString() } });
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/organization-unavailable$/);

  const bodyText = await page.locator("body").innerText();
  for (const forbidden of [fixtures.orgA.id, fixtures.orgA.slug, fixtures.owner.email, fixtures.owner.id]) {
    expect(bodyText).not.toContain(forbidden);
  }
  // Generic, fixed copy only — no timestamp/date ever rendered on this page.
  expect(bodyText).not.toMatch(/\d{4}-\d{2}-\d{2}/);

  // Scoped to this page's own <main> — the root layout's shared site
  // Footer (Privacy/Terms links, present on every page in this app,
  // including /privacy and /login themselves) is not a mutation control
  // and is out of scope for this assertion.
  const main = page.getByRole("main");
  await expect(main.getByRole("button")).toHaveCount(0);
  // The only link allowed is the generic, organization-agnostic support mailto: (Support Email UX Cleanup);
  // never a navigation link to anything about this workspace.
  const hrefs = await main.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  expect(hrefs.length).toBeLessThanOrEqual(1);
  for (const href of hrefs) expect(href).toMatch(/^mailto:/);
  await expect(main.locator("form")).toHaveCount(0);
});

test("direct download route probes are denied for a suspended organization, never returning the signed URL", async ({ context, baseURL }) => {
  await dbQuery("organization", "update", { where: { id: fixtures.orgA.id }, data: { suspendedAt: new Date().toISOString() } });
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  const page = await context.newPage();
  const res = await page.request.get(`${baseURL}/api/attachments/${fixtures.attachment.id}/download`, { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers()["location"]).toBe("/organization-unavailable");
});

test("a suspended organization's Client Portal user is redirected to /organization-unavailable", async ({ context, baseURL }) => {
  await dbQuery("organization", "update", { where: { id: fixtures.orgA.id }, data: { suspendedAt: new Date().toISOString() } });
  await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL!);
  const page = await context.newPage();
  await page.goto("/portal");
  await expect(page).toHaveURL(/\/organization-unavailable$/);
});

test("search cannot bypass suspension: returns a plain 403 JSON body, never a redirect", async ({ context, baseURL }) => {
  await dbQuery("organization", "update", { where: { id: fixtures.orgA.id }, data: { suspendedAt: new Date().toISOString() } });
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  const page = await context.newPage();
  const res = await page.request.get(`${baseURL}/api/search?q=test`, { maxRedirects: 0 });
  expect(res.status()).toBe(403);
  expect(res.headers()["content-type"]).toContain("application/json");
  const body = await res.json();
  expect(body).toEqual({ error: "Not authorized." });
});

test("reactivation (clearing suspendedAt) restores access on the very next request, with no other change needed", async ({ context, baseURL }) => {
  await dbQuery("organization", "update", { where: { id: fixtures.orgA.id }, data: { suspendedAt: new Date().toISOString() } });
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/organization-unavailable$/);

  await dbQuery("organization", "update", { where: { id: fixtures.orgA.id }, data: { suspendedAt: null } });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
});

test("no horizontal overflow on the unavailable page at narrow, intermediate, and wide viewports", async ({ context, baseURL }) => {
  await dbQuery("organization", "update", { where: { id: fixtures.orgA.id }, data: { suspendedAt: new Date().toISOString() } });
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  const page = await context.newPage();
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/organization-unavailable$/);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `width=${width}`).toBeLessThanOrEqual(clientWidth);
  }
});
