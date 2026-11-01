import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Website Traffic V1 on /platform-admin/growth, in the shipped default
 * state: analytics is NOT enabled (WEBSITE_TRAFFIC_ENABLED is unset in the
 * E2E server), so the section must say so, show no numbers, make no
 * outbound analytics request, and leave the whole registration dashboard
 * untouched. The live Vercel API is never involved.
 */

const PLATFORM_ADMIN_EMAIL = "platform-admin-e2e@example.com";
const PATH = "/platform-admin/growth";

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

async function asAdmin(context: BrowserContext, baseURL: string): Promise<Page> {
  await injectTestSession(context, { id: `e2e-growth-traffic-${randomUUID()}`, email: PLATFORM_ADMIN_EMAIL }, baseURL);
  return context.newPage();
}

test("unauthenticated, non-allowlisted Staff and Portal identities never reach the Website traffic section", async ({ page, context, baseURL }) => {
  await page.goto(PATH);
  await expect(page).toHaveURL(/\/login\?reason=session_expired$/);

  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  const staff = await context.newPage();
  await staff.goto(PATH);
  await expect(staff).toHaveURL(/\/dashboard$/);
  await expect(staff.getByRole("heading", { name: "Website traffic" })).toHaveCount(0);
});

test("a Client Portal identity is redirected away", async ({ context, baseURL }) => {
  await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL!);
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(page).toHaveURL(/\/portal$/);
});

test("the Website traffic section shows the honest disabled state, labelled with its source, and no numbers", async ({ context, baseURL }) => {
  const page = await asAdmin(context, baseURL!);
  const analyticsRequests: string[] = [];
  page.on("request", (request) => {
    if (/vercel|analytics|insights/i.test(new URL(request.url()).hostname + new URL(request.url()).pathname)) analyticsRequests.push(request.url());
  });

  await page.goto(PATH);

  const section = page.getByRole("region", { name: "Website traffic" });
  await expect(section.getByRole("heading", { name: "Website traffic" })).toBeVisible();
  await expect(section).toContainText("Source: Vercel Web Analytics");
  await expect(section).toContainText("Site: aqenra.com");
  await expect(section).toContainText("Days are UTC");
  await expect(section).toContainText("Separate from Staff registrations");
  await expect(section.getByText("Website traffic is not enabled")).toBeVisible();
  await expect(section).toContainText("Nothing is estimated or backfilled");
  // No metric cards, chart or referrers while disabled.
  await expect(section.getByText("Page views")).toHaveCount(0);
  await expect(section.getByText("Average daily visitors")).toHaveCount(0);
  await expect(section.getByText("Top referrers")).toHaveCount(0);
  await expect(section.getByRole("img")).toHaveCount(0);
  // The browser never talks to an analytics provider.
  expect(analyticsRequests).toEqual([]);
});

test("the registration dashboard is unchanged around it: cards, chart, directory and search all still render", async ({ context, baseURL }) => {
  const page = await asAdmin(context, baseURL!);
  await page.goto(PATH);

  await expect(page.getByRole("heading", { name: "Growth", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Signup identities (recording period)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Staff accounts (all time)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Last 30 UTC days" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Registration directory" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("no historical backfill has been run");
  await expect(page.getByLabel("Search", { exact: false }).first()).toBeVisible();
});

test("changing the period keeps the traffic section independent and the page working", async ({ context, baseURL }) => {
  const page = await asAdmin(context, baseURL!);
  await page.goto(`${PATH}?period=90`);
  await expect(page.getByRole("heading", { name: "Last 90 UTC days" })).toBeVisible();
  await expect(page.getByText("Website traffic is not enabled")).toBeVisible();
  await page.getByRole("navigation", { name: "Period" }).getByRole("link", { name: "7 days" }).click();
  await expect(page).toHaveURL(/period=7/);
  await expect(page.getByText("Website traffic is not enabled")).toBeVisible();
});

test("no horizontal page overflow at narrow, intermediate and wide viewports", async ({ context, baseURL }) => {
  const page = await asAdmin(context, baseURL!);
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PATH);
    await expect(page.getByRole("heading", { name: "Website traffic" })).toBeVisible();
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `width=${width}`).toBeLessThanOrEqual(clientWidth);
  }
});
