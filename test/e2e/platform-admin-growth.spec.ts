import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Platform Admin Growth V1, Slice B — the real route end to end: who can
 * reach it, what it renders from real SignupAttempt/User rows, search and
 * period navigation, empty states, and layout at narrow widths. Every test
 * seeds its own uniquely-marked rows and searches for exactly that marker,
 * so assertions never depend on whatever else the shared database holds.
 * PLATFORM_ADMIN_EMAILS is fixed in playwright.config.ts to exactly the one
 * address this suite injects a session for.
 */

const PLATFORM_ADMIN_EMAIL = "platform-admin-e2e@example.com";
const PATH = "/platform-admin/growth";

let fixtures: TestFixtures;
const attemptIds: string[] = [];
const userIds: string[] = [];

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterEach(async () => {
  if (attemptIds.length) await dbQuery("signupAttempt", "deleteMany", { where: { authUserId: { in: attemptIds.splice(0) } } });
  if (userIds.length) await dbQuery("user", "deleteMany", { where: { id: { in: userIds.splice(0) } } });
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

async function asAdmin(context: BrowserContext, baseURL: string): Promise<Page> {
  await injectTestSession(context, { id: `e2e-growth-${randomUUID()}`, email: PLATFORM_ADMIN_EMAIL }, baseURL);
  return context.newPage();
}

async function seedAttempt(overrides: { email: string; activated?: boolean; count?: number; origin?: "STANDALONE" | "INVITED" }) {
  const authUserId = randomUUID();
  attemptIds.push(authUserId);
  const first = new Date(Date.now() - 60_000).toISOString();
  await dbQuery("signupAttempt", "create", {
    data: {
      authUserId,
      email: overrides.email,
      origin: overrides.origin ?? "STANDALONE",
      firstAttemptedAt: first,
      lastAttemptedAt: first,
      attemptCount: overrides.count ?? 1,
      activatedAt: overrides.activated ? first : null,
    },
  });
  if (overrides.activated) {
    userIds.push(authUserId);
    await dbQuery("user", "create", { data: { id: authUserId, email: overrides.email, name: "Growth E2E User", createdAt: first } });
  }
  return authUserId;
}

test("no session redirects to /login", async ({ page }) => {
  await page.goto(PATH);
  await expect(page).toHaveURL(/\/login\?reason=session_expired$/);
});

test("an authenticated Staff user who is not allowlisted is redirected to /dashboard, never shown the page or an access-denied message", async ({
  context,
  baseURL,
}) => {
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Growth", level: 1 })).toHaveCount(0);
  await expect(page.getByText("Access denied")).toHaveCount(0);
});

test("a Client Portal identity is redirected away", async ({ context, baseURL }) => {
  await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL!);
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(page).toHaveURL(/\/portal$/);
});

test("the allowlisted admin reaches Growth from the Platform Admin navigation", async ({ context, baseURL }) => {
  const page = await asAdmin(context, baseURL!);
  await page.goto("/platform-admin");
  await page.getByRole("navigation", { name: "Platform Admin" }).getByRole("link", { name: "Growth" }).click();
  await expect(page).toHaveURL(/\/platform-admin\/growth$/);
  await expect(page.getByRole("heading", { name: "Growth", level: 1 })).toBeVisible();
});

test("states the recording-period and no-backfill caveats, all in UTC", async ({ context, baseURL }) => {
  const page = await asAdmin(context, baseURL!);
  await page.goto(PATH);
  const note = page.getByRole("note");
  await expect(note).toContainText("no historical backfill has been run");
  await expect(note).toContainText("a zero before it is not evidence that nobody registered");
  await expect(note).toContainText("no confirmation time is shown");
  await expect(page.getByText("All times are UTC.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Signup identities (recording period)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Staff accounts (all time)" })).toBeVisible();
});

test("renders recorded signups with their real status, attempts and timestamps; search narrows to the marker", async ({ context, baseURL }) => {
  const marker = `growthe2e-${randomUUID().slice(0, 8)}`;
  await seedAttempt({ email: `${marker}-pending@example.com`, count: 3, origin: "INVITED" });
  await seedAttempt({ email: `${marker}-done@example.com`, activated: true });

  const page = await asAdmin(context, baseURL!);
  await page.goto(`${PATH}?q=${marker}`);

  const pending = page.getByRole("row", { name: new RegExp(`${marker}-pending@example.com`) });
  await expect(pending).toContainText("Invitation");
  await expect(pending).toContainText("Signup recorded, no app account");
  await expect(pending.getByRole("cell", { name: "3", exact: true })).toBeVisible();
  await expect(pending).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
  await expect(pending).toContainText("None");

  const done = page.getByRole("row", { name: new RegExp(`${marker}-done@example.com`) });
  await expect(done).toContainText("Activated");
  await expect(done).toContainText("Account created");
  await expect(page.getByText("2 recorded signup identities matching your search")).toBeVisible();
});

test("a search with no match shows the honest empty state with a way back", async ({ context, baseURL }) => {
  const page = await asAdmin(context, baseURL!);
  await page.goto(`${PATH}?q=no-such-email-${randomUUID()}`);
  await expect(page.getByText("No matching signups")).toBeVisible();
  await page.getByRole("link", { name: "Clear search" }).click();
  await expect(page).toHaveURL(/\/platform-admin\/growth\?period=30$/);
});

test("the period switch changes the window and keeps the search; the current period is marked", async ({ context, baseURL }) => {
  const page = await asAdmin(context, baseURL!);
  await page.goto(`${PATH}?q=abc`);
  await expect(page.getByRole("heading", { name: "Last 30 UTC days" })).toBeVisible();
  const periods = page.getByRole("navigation", { name: "Period" });
  await expect(periods.getByRole("link", { name: "30 days" })).toHaveAttribute("aria-current", "page");

  await periods.getByRole("link", { name: "7 days" }).click();
  await expect(page).toHaveURL(/period=7/);
  await expect(page).toHaveURL(/q=abc/);
  await expect(page.getByRole("heading", { name: "Last 7 UTC days" })).toBeVisible();

  await page.goto(`${PATH}?period=90`);
  await expect(page.getByRole("heading", { name: "Last 90 UTC days" })).toBeVisible();
  await page.goto(`${PATH}?period=1000`);
  await expect(page.getByRole("heading", { name: "Last 30 UTC days" })).toBeVisible();
});

test("the daily values table lists every UTC day in the window", async ({ context, baseURL }) => {
  const page = await asAdmin(context, baseURL!);
  await page.goto(`${PATH}?period=7`);
  await page.getByText("Daily values (UTC)").click();
  await expect(page.getByRole("row")).not.toHaveCount(0);
  const dayRows = page.locator("details table tbody tr");
  await expect(dayRows).toHaveCount(7);
});

test("no horizontal page overflow at narrow, intermediate and wide viewports", async ({ context, baseURL }) => {
  const marker = `growthe2e-${randomUUID().slice(0, 8)}`;
  await seedAttempt({ email: `${marker}-a-very-long-email-address-to-stress-wrapping@example.com`, activated: true });
  const page = await asAdmin(context, baseURL!);
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${PATH}?q=${marker}`);
    await expect(page.getByRole("heading", { name: "Growth", level: 1 })).toBeVisible();
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `width=${width}`).toBeLessThanOrEqual(clientWidth);
  }
});
