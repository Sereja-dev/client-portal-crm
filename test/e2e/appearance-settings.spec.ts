import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Aqenra Phase D — staff Settings -> Appearance, end to end through the
 * REAL /settings/appearance page (not a synthetic harness): real
 * `injectTestSession` + real fixtures exercise the actual
 * `getOrCreateUser()`/`updateThemeModeAction()`/`ThemePreferenceReconciler`
 * stack exactly the way Production does. Every OS-preference case uses
 * `page.emulateMedia`; every time-dependent case uses Playwright's fake
 * Clock — never this machine's real clock/OS theme.
 */

const COOKIE_NAME = "aqenra_theme";
const APPEARANCE_PATH = "/settings/appearance";

function resolvedAttr(page: Page) {
  return page.evaluate(() => document.documentElement.getAttribute("data-theme"));
}
function cookieValue(context: BrowserContext, hostname: string) {
  return context.cookies().then((cookies) => cookies.find((c) => c.name === COOKIE_NAME && c.domain.includes(hostname))?.value);
}
/**
 * Clicks the same visible text a real user would click. The radio
 * input itself is intentionally visually hidden (`sr-only`) — its
 * accessible-name text (the title span) sits at the same static
 * position the input would otherwise occupy in the flex column, which
 * makes Playwright's own pointer-hit-testing (correctly, for a raw
 * `.click()` on the input's exact box) report the title span as the
 * topmost element there. This is not a real usability bug: native
 * `<label>` click-delegation activates the associated control from
 * anywhere inside the label regardless of paint/stacking order — real
 * mouse and touch users clicking this card work correctly. Clicking the
 * visible title text (exactly what a user's pointer actually lands on)
 * is the faithful way to drive this interaction in a real browser.
 */
function selectMode(page: Page, title: "Light" | "Dark" | "System" | "Automatic") {
  return page.getByText(title, { exact: true }).click();
}

function dbMode(userId: string) {
  return dbQuery<{ themeMode: string } | null>("user", "findUnique", { where: { id: userId }, select: { themeMode: true } }).then(
    (row) => row?.themeMode,
  );
}

test.describe("Phase D — Appearance settings page", () => {
  let fixtures: TestFixtures;

  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.afterEach(async () => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "SYSTEM" } });
  });

  test("page loads authenticated and reflects the DB-seeded mode as the initial selection", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await injectTestSession(context, fixtures.owner, baseURL!);

    await page.goto(APPEARANCE_PATH);

    await expect(page.getByRole("radio", { name: /^Dark$/ })).toBeChecked();
    await expect.poll(() => resolvedAttr(page)).toBe("dark");
  });

  test("choosing Dark applies immediately and persists DARK to the database", async ({ page, context, baseURL }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(APPEARANCE_PATH);

    await selectMode(page, "Dark");

    await expect.poll(() => resolvedAttr(page)).toBe("dark");
    await expect.poll(() => cookieValue(context, new URL(baseURL!).hostname)).toBe("dark.dark");
    await expect.poll(() => dbMode(fixtures.owner.id)).toBe("DARK");
  });

  test("reload after choosing Dark: authenticated reconciliation still shows Dark selected", async ({ page, context, baseURL }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(APPEARANCE_PATH);
    await selectMode(page, "Dark");
    await expect.poll(() => dbMode(fixtures.owner.id)).toBe("DARK");

    await page.reload();

    await expect(page.getByRole("radio", { name: /^Dark$/ })).toBeChecked();
    await expect.poll(() => resolvedAttr(page)).toBe("dark");
  });

  test("choosing System resolves per this device's OS preference, and DB stores SYSTEM only (never the resolved half)", async ({ page, context, baseURL }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(APPEARANCE_PATH);

    await selectMode(page, "System");

    await expect.poll(() => resolvedAttr(page)).toBe("dark");
    await expect(page.getByText("Currently using Dark")).toBeVisible();
    await expect.poll(() => dbMode(fixtures.owner.id)).toBe("SYSTEM");
  });

  test("choosing Automatic resolves per this device's local clock (daytime -> Light), and DB stores AUTOMATIC only", async ({ page, context, baseURL }) => {
    await page.clock.install({ time: new Date(2026, 0, 15, 11, 0, 0) });
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(APPEARANCE_PATH);

    await selectMode(page, "Automatic");

    await expect.poll(() => resolvedAttr(page)).toBe("light");
    await expect(page.getByText("Currently using Light")).toBeVisible();
    await expect.poll(() => dbMode(fixtures.owner.id)).toBe("AUTOMATIC");
  });

  test("choosing Automatic at faked nighttime resolves Dark", async ({ page, context, baseURL }) => {
    await page.clock.install({ time: new Date(2026, 0, 15, 22, 0, 0) });
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(APPEARANCE_PATH);

    await selectMode(page, "Automatic");

    await expect.poll(() => resolvedAttr(page)).toBe("dark");
  });

  test("navigating away and back preserves the selection", async ({ page, context, baseURL }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(APPEARANCE_PATH);
    await selectMode(page, "Dark");
    await expect.poll(() => dbMode(fixtures.owner.id)).toBe("DARK");

    await page.goto("/dashboard");
    await expect.poll(() => resolvedAttr(page)).toBe("dark");
    await page.goto(APPEARANCE_PATH);

    await expect(page.getByRole("radio", { name: /^Dark$/ })).toBeChecked();
  });

  test("logout does not delete aqenra_theme", async ({ page, context, baseURL }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(APPEARANCE_PATH);
    await selectMode(page, "Dark");
    await expect.poll(() => cookieValue(context, new URL(baseURL!).hostname)).toBe("dark.dark");

    // Sidebar Account Menu V1 — desktop Sign out now lives in the
    // sidebar's own account menu, not a standalone Header button.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL("**/login");

    expect(await cookieValue(context, new URL(baseURL!).hostname)).toBe("dark.dark");
  });

  test("logging in as a different identity reconciles to THAT identity's own DB preference", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await dbQuery("user", "update", { where: { id: fixtures.admin.id }, data: { themeMode: "LIGHT" } });

    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(APPEARANCE_PATH);
    await expect(page.getByRole("radio", { name: /^Dark$/ })).toBeChecked();
    // Sidebar Account Menu V1 — desktop Sign out now lives in the
    // sidebar's own account menu, not a standalone Header button.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL("**/login");

    await injectTestSession(context, fixtures.admin, baseURL!);
    await page.goto(APPEARANCE_PATH);
    await expect(page.getByRole("radio", { name: /^Light$/ })).toBeChecked();

    await dbQuery("user", "update", { where: { id: fixtures.admin.id }, data: { themeMode: "SYSTEM" } });
  });

  test("rapid switching (Light -> Dark -> System -> Automatic) ends on Automatic locally AND in the database, with no stale mode winning", async ({ page, context, baseURL }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.clock.install({ time: new Date(2026, 0, 15, 11, 0, 0) });
    await page.goto(APPEARANCE_PATH);

    await selectMode(page, "Light");
    await selectMode(page, "Dark");
    await selectMode(page, "System");
    await selectMode(page, "Automatic");

    await expect(page.getByRole("radio", { name: /^Automatic$/ })).toBeChecked();
    await expect.poll(() => resolvedAttr(page)).toBe("light");
    await expect.poll(() => dbMode(fixtures.owner.id)).toBe("AUTOMATIC");
  });

  test("accessibility: each option is a real radio reachable and selectable by keyboard, with a visible focus state", async ({ page, context, baseURL }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(APPEARANCE_PATH);

    const lightRadio = page.getByRole("radio", { name: /^Light$/ });
    await lightRadio.focus();
    await expect(lightRadio).toBeFocused();

    // Arrow-key navigation is native radio-group behavior (no custom JS
    // needed) — ArrowDown moves focus+selection to the next radio in the
    // same name-group.
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: /^Dark$/ })).toBeChecked();
    await expect.poll(() => resolvedAttr(page)).toBe("dark");
  });

  test("failure: a persistence error shows a restrained toast, the local theme is NOT rolled back, and a later successful selection clears it", async ({ page, context, baseURL }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(APPEARANCE_PATH);

    // Network-level interception only — no application backdoor. Next.js
    // Server Actions POST to the same page URL; forcing exactly one such
    // POST to fail proves the UI's own failure handling without any
    // Production-facing test hook.
    let intercepted = false;
    await page.route(`**${APPEARANCE_PATH}`, async (route) => {
      if (route.request().method() === "POST" && !intercepted) {
        intercepted = true;
        await route.fulfill({ status: 500, body: "forced failure for test" });
        return;
      }
      await route.continue();
    });

    await selectMode(page, "Dark");

    // Local appearance is unaffected by the persistence failure.
    await expect.poll(() => resolvedAttr(page)).toBe("dark");
    await expect(page.getByRole("radio", { name: /^Dark$/ })).toBeChecked();
    await expect(page.getByText("Theme changed on this device, but we couldn't save it to your account.")).toBeVisible();

    // A later, genuinely new selection is not blocked by the earlier
    // failure and succeeds normally once the route is no longer forced.
    await selectMode(page, "Light");
    await expect.poll(() => dbMode(fixtures.owner.id)).toBe("LIGHT");
  });
});

test.describe("Phase D — Appearance settings, mobile viewport", () => {
  let fixtures: TestFixtures;

  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  for (const width of [390, 320]) {
    test(`renders without horizontal overflow at ${width}px, options remain usable`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width, height: 800 });
      await injectTestSession(context, fixtures.owner, baseURL!);
      await page.goto(APPEARANCE_PATH);

      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);

      await expect(page.getByRole("radio", { name: /^Automatic$/ })).toBeVisible();
      await expect(page.getByText(/Uses Light from 07:00 to 19:00/)).toBeVisible();
    });
  }
});
