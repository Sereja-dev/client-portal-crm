import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Sidebar Account Menu V1 — real-browser coverage for what the source-
 * contract unit suites (avatar.test.tsx, popover-menu.test.tsx,
 * sidebar-account-menu.test.ts, header-account-cleanup-contract.test.ts,
 * sidebar-footer-structure-contract.test.ts) structurally cannot exercise:
 * actual open/close/keyboard/focus behavior, the real menu destinations,
 * and the desktop/mobile split. Mirrors row-action-menu-keyboard.spec.ts's
 * own established keyboard-coverage pattern for the sibling PopoverMenu
 * primitive this component is built on.
 */

async function actAsOwner(page: Page, baseURL: string, fixtures: TestFixtures): Promise<void> {
  await page.context().clearCookies();
  await injectTestSession(page.context(), { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL);
  await page.context().addCookies([
    {
      name: "active_organization_id",
      value: fixtures.orgA.id,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

function accountMenuTrigger(page: Page) {
  return page.getByRole("button", { name: "Account menu" });
}

function accountMenu(page: Page) {
  return page.getByRole("menu", { name: "Account menu" });
}

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test.describe("Sidebar account menu — desktop (1280px)", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!, fixtures);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/dashboard");
  });

  test("the trigger shows the owner's own name and email; opening the menu repeats both in its own header", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(accountMenuTrigger(page)).toBeVisible();
    await expect(nav.getByText(fixtures.owner.name, { exact: true })).toBeVisible();
    await expect(nav.getByText(fixtures.owner.email, { exact: true })).toBeVisible();

    await accountMenuTrigger(page).click();
    const menu = accountMenu(page);
    await expect(menu).toBeVisible();
    await expect(menu.getByText(fixtures.owner.name, { exact: true })).toBeVisible();
    await expect(menu.getByText(fixtures.owner.email, { exact: true })).toBeVisible();
  });

  test("renders exactly the approved menu items, in order, nothing speculative", async ({ page }) => {
    await accountMenuTrigger(page).click();
    const items = accountMenu(page).getByRole("menuitem");
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toHaveText("Appearance");
    await expect(items.nth(1)).toHaveText("Notifications");
    await expect(items.nth(2)).toHaveText("Billing");
    await expect(items.nth(3)).toHaveText("Sign out");
  });

  test("Appearance/Notifications/Billing navigate to the existing real settings pages", async ({ page }) => {
    await accountMenuTrigger(page).click();
    await accountMenu(page).getByRole("menuitem", { name: "Appearance" }).click();
    await expect(page).toHaveURL(/\/settings\/appearance$/);
    await expect(accountMenu(page)).toHaveCount(0);

    await accountMenuTrigger(page).click();
    await accountMenu(page).getByRole("menuitem", { name: "Notifications" }).click();
    await expect(page).toHaveURL(/\/settings\/notifications$/);

    await accountMenuTrigger(page).click();
    await accountMenu(page).getByRole("menuitem", { name: "Billing" }).click();
    await expect(page).toHaveURL(/\/settings\/billing$/);
  });

  test("Enter on the trigger opens the menu and focuses the first item (Appearance)", async ({ page }) => {
    await accountMenuTrigger(page).focus();
    await page.keyboard.press("Enter");
    await expect(accountMenu(page)).toBeVisible();
    await expect(accountMenu(page).getByRole("menuitem", { name: "Appearance" })).toBeFocused();
  });

  test("ArrowDown on the closed trigger opens the menu and focuses the first item", async ({ page }) => {
    await accountMenuTrigger(page).focus();
    await expect(accountMenu(page)).toHaveCount(0);
    await page.keyboard.press("ArrowDown");
    await expect(accountMenu(page)).toBeVisible();
    await expect(accountMenu(page).getByRole("menuitem", { name: "Appearance" })).toBeFocused();
  });

  test("ArrowDown/ArrowUp/Home/End rove focus correctly through all four items", async ({ page }) => {
    await accountMenuTrigger(page).click();
    const menu = accountMenu(page);
    await expect(menu.getByRole("menuitem", { name: "Appearance" })).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Notifications" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Billing" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeFocused();
    // Wraps back to the first item.
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Appearance" })).toBeFocused();

    await page.keyboard.press("ArrowUp");
    await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeFocused();

    await page.keyboard.press("Home");
    await expect(menu.getByRole("menuitem", { name: "Appearance" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeFocused();
  });

  test("Escape closes the menu and returns focus to the trigger", async ({ page }) => {
    await accountMenuTrigger(page).click();
    await expect(accountMenu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(accountMenu(page)).toHaveCount(0);
    await expect(accountMenuTrigger(page)).toBeFocused();
  });

  test("clicking outside the menu closes it", async ({ page }) => {
    await accountMenuTrigger(page).click();
    await expect(accountMenu(page)).toBeVisible();
    await page.mouse.click(700, 400);
    await expect(accountMenu(page)).toHaveCount(0);
  });

  test("the desktop Header no longer shows an email or a standalone Sign-out button", async ({ page }) => {
    const header = page.locator("header");
    await expect(header.getByText(fixtures.owner.email, { exact: true })).toBeHidden();
    await expect(header.getByRole("button", { name: "Sign out" })).toBeHidden();
  });

  test("Sign out from the menu ends the session and redirects to /login", async ({ page }) => {
    await accountMenuTrigger(page).click();
    await accountMenu(page).getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Sidebar account menu — absent on mobile, Header identity/Sign-out unchanged (390px)", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!, fixtures);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");
  });

  test("the account menu trigger is not visible; Header's own email and Sign-out remain, unchanged", async ({ page }) => {
    await expect(accountMenuTrigger(page)).toBeHidden();

    const header = page.locator("header");
    await expect(header.getByText(fixtures.owner.email, { exact: true })).toBeVisible();
    const signOutButton = header.getByRole("button", { name: "Sign out", exact: true });
    await expect(signOutButton).toBeVisible();
  });

  test("mobile Sign out still ends the session and redirects to /login", async ({ page }) => {
    const header = page.locator("header");
    await header.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
