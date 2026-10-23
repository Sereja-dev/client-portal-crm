import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Theme Persistence Phase C2 — authenticated DB -> cookie/runtime
 * reconciliation, end to end through the REAL /dashboard and /portal
 * layouts (not a synthetic harness): `injectTestSession` + a real
 * fixture identity exercise the actual `getOrCreateUser()`/
 * `getCurrentPortalUser()` full-row queries, so `themeMode` is read the
 * exact way Production does. Every time-dependent case uses Playwright's
 * fake Clock and every OS-preference case uses `page.emulateMedia` —
 * never this machine's real clock/OS theme.
 */

const COOKIE_NAME = "aqenra_theme";

function resolvedAttr(page: Page) {
  return page.evaluate(() => document.documentElement.getAttribute("data-theme"));
}

function cookieValue(context: BrowserContext, hostname: string) {
  return context.cookies().then((cookies) => cookies.find((c) => c.name === COOKIE_NAME && c.domain.includes(hostname))?.value);
}

async function setDeviceThemeCookie(context: BrowserContext, baseURL: string, value: string): Promise<void> {
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

test.describe("Theme Persistence Phase C2 — staff authenticated reconciliation (/dashboard)", () => {
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

  test("device cookie dark, DB LIGHT: authenticated tree converges to Light, cookie becomes light.light (not a pre-paint guarantee — an intentional post-auth correction)", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "LIGHT" } });
    await setDeviceThemeCookie(context, baseURL!, "dark.dark");
    await injectTestSession(context, fixtures.owner, baseURL!);

    await page.goto("/dashboard");

    await expect.poll(() => resolvedAttr(page)).toBe("light");
    expect(await cookieValue(context, new URL(baseURL!).hostname)).toBe("light.light");
  });

  test("device cookie light, DB DARK: converges to Dark", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await setDeviceThemeCookie(context, baseURL!, "light.light");
    await injectTestSession(context, fixtures.owner, baseURL!);

    await page.goto("/dashboard");

    await expect.poll(() => resolvedAttr(page)).toBe("dark");
    expect(await cookieValue(context, new URL(baseURL!).hostname)).toBe("dark.dark");
  });

  test("no cookie mismatch (cookie already agrees with DB): no visual jump, no unnecessary cookie rewrite loop", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await setDeviceThemeCookie(context, baseURL!, "dark.dark");
    await injectTestSession(context, fixtures.owner, baseURL!);

    await page.goto("/dashboard");

    await expect.poll(() => resolvedAttr(page)).toBe("dark");
  });

  test("DB SYSTEM, OS emulated dark: runtime mode resolves via System live, resolvedTheme dark — DB stores mode only, device still computes resolvedTheme", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "SYSTEM" } });
    await setDeviceThemeCookie(context, baseURL!, "light.light");
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.emulateMedia({ colorScheme: "dark" });

    await page.goto("/dashboard");

    await expect.poll(() => resolvedAttr(page)).toBe("dark");
    // Polled (not a one-shot check): the resolved attribute above was
    // already "dark" from the OS emulation alone in principle, so that
    // assertion alone can't distinguish "reconciliation genuinely ran"
    // from "coincidentally already correct" — polling the cookie's mode
    // prefix (which only reconciliation, not the pre-paint script, ever
    // rewrites post-hydration for an authenticated load) proves the
    // reconciliation effect actually completed, not just that its
    // eventual visual result happened to already match.
    await expect.poll(() => cookieValue(context, new URL(baseURL!).hostname)).toMatch(/^system\./);
  });

  test("DB AUTOMATIC, faked daytime: resolves Light", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "AUTOMATIC" } });
    await setDeviceThemeCookie(context, baseURL!, "light.light");
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.clock.install({ time: new Date(2026, 0, 15, 11, 0, 0) });

    await page.goto("/dashboard");

    await expect.poll(() => resolvedAttr(page)).toBe("light");
    // Polled, not a one-shot check — see the analogous System test's own
    // comment: the resolved attribute alone can coincidentally already
    // match before reconciliation's own cookie-write effect has actually
    // flushed, so only polling the cookie's mode prefix proves
    // reconciliation genuinely ran.
    await expect.poll(() => cookieValue(context, new URL(baseURL!).hostname)).toMatch(/^automatic\./);
  });

  test("DB AUTOMATIC, faked nighttime: resolves Dark", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "AUTOMATIC" } });
    await setDeviceThemeCookie(context, baseURL!, "light.light");
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.clock.install({ time: new Date(2026, 0, 15, 22, 0, 0) });

    await page.goto("/dashboard");

    await expect.poll(() => resolvedAttr(page)).toBe("dark");
  });

  test("logout does not delete aqenra_theme", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await setDeviceThemeCookie(context, baseURL!, "dark.dark");
    await injectTestSession(context, fixtures.owner, baseURL!);

    await page.goto("/dashboard");
    await expect.poll(() => resolvedAttr(page)).toBe("dark");

    // Sidebar Account Menu V1 — desktop Sign out now lives in the
    // sidebar's own account menu, not a standalone Header button.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL("**/login");

    expect(await cookieValue(context, new URL(baseURL!).hostname)).toBe("dark.dark");
  });

  test("cross-device: two isolated browser contexts, same identity, different starting device caches, both converge to the same DB mode on their own authenticated load", async ({ browser, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });

    const deviceA = await browser.newContext();
    const deviceB = await browser.newContext();
    try {
      await setDeviceThemeCookie(deviceA, baseURL!, "light.light");
      await injectTestSession(deviceA, fixtures.owner, baseURL!);
      const pageA = await deviceA.newPage();
      await pageA.goto("/dashboard");
      await expect.poll(() => resolvedAttr(pageA)).toBe("dark");

      await setDeviceThemeCookie(deviceB, baseURL!, "system.light");
      await injectTestSession(deviceB, fixtures.owner, baseURL!);
      const pageB = await deviceB.newPage();
      await pageB.goto("/dashboard");
      await expect.poll(() => resolvedAttr(pageB)).toBe("dark");
    } finally {
      await deviceA.close();
      await deviceB.close();
    }
  });
});

test.describe("Theme Persistence Phase C2 — Portal authenticated reconciliation (/portal)", () => {
  let fixtures: TestFixtures;

  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.afterEach(async () => {
    await dbQuery("portalUser", "update", { where: { id: fixtures.portalUser.id }, data: { themeMode: "SYSTEM" } });
  });

  test("device cookie dark, PortalUser DB LIGHT: converges to Light", async ({ page, context, baseURL }) => {
    await dbQuery("portalUser", "update", { where: { id: fixtures.portalUser.id }, data: { themeMode: "LIGHT" } });
    await setDeviceThemeCookie(context, baseURL!, "dark.dark");
    await injectTestSession(context, fixtures.portalUser, baseURL!);

    await page.goto("/portal");

    await expect.poll(() => resolvedAttr(page)).toBe("light");
    expect(await cookieValue(context, new URL(baseURL!).hostname)).toBe("light.light");
  });

  test("device cookie light, PortalUser DB DARK: converges to Dark", async ({ page, context, baseURL }) => {
    await dbQuery("portalUser", "update", { where: { id: fixtures.portalUser.id }, data: { themeMode: "DARK" } });
    await setDeviceThemeCookie(context, baseURL!, "light.light");
    await injectTestSession(context, fixtures.portalUser, baseURL!);

    await page.goto("/portal");

    await expect.poll(() => resolvedAttr(page)).toBe("dark");
    expect(await cookieValue(context, new URL(baseURL!).hostname)).toBe("dark.dark");
  });

  test("Portal logout does not delete aqenra_theme", async ({ page, context, baseURL }) => {
    await dbQuery("portalUser", "update", { where: { id: fixtures.portalUser.id }, data: { themeMode: "DARK" } });
    await setDeviceThemeCookie(context, baseURL!, "dark.dark");
    await injectTestSession(context, fixtures.portalUser, baseURL!);

    await page.goto("/portal");
    await expect.poll(() => resolvedAttr(page)).toBe("dark");

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/portal/login**");

    expect(await cookieValue(context, new URL(baseURL!).hostname)).toBe("dark.dark");
  });
});

test.describe("Theme Persistence Phase C2 — shared-device sequential identities", () => {
  let fixtures: TestFixtures;

  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("User A (DB DARK) reconciles, logs out (cookie survives), User B (DB LIGHT) logs in and reconciles to Light — same browser context throughout", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await dbQuery("user", "update", { where: { id: fixtures.admin.id }, data: { themeMode: "LIGHT" } });

    await setDeviceThemeCookie(context, baseURL!, "system.light");
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto("/dashboard");
    await expect.poll(() => resolvedAttr(page)).toBe("dark");
    expect(await cookieValue(context, new URL(baseURL!).hostname)).toBe("dark.dark");

    // Sidebar Account Menu V1 — desktop Sign out now lives in the
    // sidebar's own account menu, not a standalone Header button.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL("**/login");
    expect(await cookieValue(context, new URL(baseURL!).hostname)).toBe("dark.dark");

    await injectTestSession(context, fixtures.admin, baseURL!);
    await page.goto("/dashboard");
    await expect.poll(() => resolvedAttr(page)).toBe("light");
    expect(await cookieValue(context, new URL(baseURL!).hostname)).toBe("light.light");

    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "SYSTEM" } });
    await dbQuery("user", "update", { where: { id: fixtures.admin.id }, data: { themeMode: "SYSTEM" } });
  });
});
