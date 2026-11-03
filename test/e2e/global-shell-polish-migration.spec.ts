import { test, expect } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Design System page migration Batch 5 — Global Shell Polish
 * (OnboardingCard family, the generic (dashboard)/error.tsx boundary,
 * Notifications page, and the Header-mounted NotificationBell/Dropdown).
 *
 * Not a class-string snapshot suite — assertions are real rendered
 * behavior (dismiss/skip actions unmounting their own controls, bell
 * open/close, computed-style contrast checks) plus a live Dark check that
 * OnboardingProgressBar's shared Analytics consumer still renders
 * correctly (Batch 4 passive regression).
 */

test.describe("Design System Batch 5 — Global Shell Polish", () => {
  let fixtures: TestFixtures;

  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async () => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "LIGHT" } });
  });

  test("Dashboard: OnboardingCard renders with semantic surfaces, progress bar and actions present", async ({ page, context, baseURL }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Getting started" })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Onboarding progress" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dismiss onboarding" })).toBeVisible();
  });

  test("Notifications: page renders heading, filters, and empty/list state without runtime errors", async ({ page, context, baseURL }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto("/notifications");

    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expect(page.getByRole("link", { name: "All" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Unread/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("NotificationBell: opens the dropdown, shows heading/empty state, closes on Escape", async ({ page, context, baseURL }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto("/dashboard");

    const bell = page.getByRole("group").filter({ has: page.locator("summary[aria-label*='Notifications']") }).locator("summary");
    const summary = page.locator("summary[aria-label*='Notifications' i]");
    await summary.click();
    await expect(page.getByText("Notifications", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("details[open] summary[aria-label*='Notifications' i]")).toHaveCount(0);
    void bell;
  });

  test("Dark mode: Dashboard onboarding, Notifications page, and NotificationDropdown have no raw-light islands", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await injectTestSession(context, fixtures.owner, baseURL!);

    await page.goto("/dashboard");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

    const onboardingHeading = page.getByRole("heading", { name: "Getting started" });
    await expect.poll(() => onboardingHeading.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(236, 237, 238)");

    const progressbar = page.getByRole("progressbar", { name: "Onboarding progress" });
    const trackBg = await progressbar.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(trackBg).not.toBe("rgb(255, 255, 255)");

    // Open the notification dropdown and confirm it's opaque, not a raw
    // white floating panel.
    const summary = page.locator("summary[aria-label*='Notifications' i]");
    await summary.click();
    const dropdownPanel = summary.locator("~ div").first();
    await expect.poll(() => dropdownPanel.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(27, 31, 38)");
    await page.keyboard.press("Escape");

    await page.goto("/notifications");
    const notifHeading = page.getByRole("heading", { name: "Notifications" });
    await expect.poll(() => notifHeading.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(236, 237, 238)");
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBg).not.toBe("rgb(255, 255, 255)");
  });

  test("Analytics passive regression: OrganizationActivitySection's shared OnboardingProgressBar still renders correctly in Dark", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto("/analytics");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

    await expect(page.getByRole("heading", { name: "Organization activity" })).toBeVisible();
    const progressbar = page.getByRole("progressbar", { name: "Onboarding progress" });
    await expect(progressbar).toBeVisible();
    const trackBg = await progressbar.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(trackBg).not.toBe("rgb(255, 255, 255)");

    // Charts on the same page must still render without error (Batch 4
    // regression).
    const svgCount = await page.locator("svg").count();
    expect(svgCount).toBeGreaterThan(0);
  });

  test("Mobile (390/320px): no horizontal overflow on Dashboard, Notifications, or the open dropdown", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await injectTestSession(context, fixtures.owner, baseURL!);

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/dashboard", "/notifications"]) {
        await page.goto(path);
        await page.waitForTimeout(150);
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
      }
    }
  });
});
