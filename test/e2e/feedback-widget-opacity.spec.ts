import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Staff Feedback Widget — idle opacity. The trigger is semi-transparent at
 * rest and becomes fully opaque on hover, keyboard focus, press, drag, and
 * while the panel is open (see feedback-widget.tsx's own header comment and
 * OPACITY_VARIANT_CLASSES for the rationale). This file covers only that
 * opacity behavior; open/close, drag distance, keyboard move, persistence
 * and submission are already covered by feedback-widget.spec.ts and are not
 * duplicated here.
 */

let fixtures: TestFixtures;

async function actAsOwner(context: BrowserContext, baseURL: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, fixtures.owner, baseURL);
  await context.addCookies([
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

const trigger = (page: Page) => page.getByRole("button", { name: "Feedback: contact support or report a bug" });
const panel = (page: Page) => page.getByRole("dialog", { name: "Feedback" });

async function opacityOf(locator: Locator): Promise<number> {
  return Number(await locator.evaluate((el) => getComputedStyle(el).opacity));
}

// Moves the pointer away and removes keyboard focus, so neither :hover nor
// :focus-visible is active for an "idle" assertion.
async function settleToIdle(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test.describe("Staff feedback widget — idle opacity", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });
  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });
  test.beforeEach(async ({ context, baseURL, page }) => {
    await actAsOwner(context, baseURL!);
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("idle: semi-transparent once pointer and keyboard focus are elsewhere", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(trigger(page)).toBeVisible();
    await settleToIdle(page);
    const opacity = await opacityOf(trigger(page));
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
  });

  test("full opacity on desktop hover", async ({ page }) => {
    await page.goto("/dashboard");
    await settleToIdle(page);
    expect(await opacityOf(trigger(page))).toBeLessThan(1);
    await trigger(page).hover();
    await expect.poll(() => opacityOf(trigger(page))).toBe(1);
  });

  test("full opacity and the existing focus-visible ring on keyboard focus", async ({ page }) => {
    await page.goto("/dashboard");
    await settleToIdle(page);
    await trigger(page).focus();
    await expect(trigger(page)).toBeFocused();
    await expect.poll(() => opacityOf(trigger(page))).toBe(1);
    // The pre-existing focus-visible ring (focus-visible:ring-2, a box-shadow
    // utility) must still render — this change must not make focus invisible
    // or rely on opacity alone to communicate it.
    const boxShadow = await trigger(page).evaluate((el) => getComputedStyle(el).boxShadow);
    expect(boxShadow).not.toBe("none");
  });

  test("a single click opens the panel starting from the idle (unhovered, unfocused) state", async ({ page }) => {
    await page.goto("/dashboard");
    await settleToIdle(page);
    expect(await opacityOf(trigger(page))).toBeLessThan(1);
    await expect(panel(page)).toHaveCount(0);
    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
  });

  test("a single tap opens the panel on a touch-enabled context, with no hover involved", async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    try {
      await actAsOwner(context, baseURL!);
      const page = await context.newPage();
      await page.goto("/dashboard");
      await expect(trigger(page)).toBeVisible();
      await expect(panel(page)).toHaveCount(0);
      await trigger(page).tap();
      await expect(panel(page)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("the open panel is fully opaque regardless of the trigger's own reduced idle opacity", async ({ page }) => {
    await page.goto("/dashboard");
    await settleToIdle(page);
    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    const panelOpacity = await panel(page).evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(panelOpacity)).toBe(1);
  });

  test("open-state: at a width where the trigger stays visible, it is fully opaque while open", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 800 });
    await page.goto("/dashboard");
    await settleToIdle(page);
    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(trigger(page)).toBeVisible();
    await expect.poll(() => opacityOf(trigger(page))).toBe(1);
  });

  test("existing behavior preserved: below 640px the trigger is still hidden while the panel is open", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");
    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(trigger(page)).toBeHidden();
  });

  test("after closing: stays fully opaque while focus remains on the trigger, returns to idle once focus and pointer move away", async ({ page }) => {
    await page.goto("/dashboard");
    await settleToIdle(page);
    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    // close() returns focus to the trigger — it is genuinely still focused
    // right after closing, so it correctly stays fully opaque here.
    await expect(trigger(page)).toBeFocused();
    await expect.poll(() => opacityOf(trigger(page))).toBe(1);
    // Only once focus and the pointer actually move away does it settle
    // back to the idle, semi-transparent appearance.
    await settleToIdle(page);
    await expect.poll(() => opacityOf(trigger(page))).toBeLessThan(1);
  });

  test("dragging uses the fully-opaque active appearance, and returns to idle after the drag ends away from the pointer", async ({ page }) => {
    await page.goto("/dashboard");
    await settleToIdle(page);
    expect(await opacityOf(trigger(page))).toBeLessThan(1);
    const box = (await trigger(page).boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 150, cy - 150, { steps: 8 });
    await expect.poll(() => opacityOf(trigger(page))).toBe(1);
    await page.mouse.up();
    await expect(panel(page)).toHaveCount(0);
    await page.mouse.move(0, 0);
    await expect.poll(() => opacityOf(trigger(page))).toBeLessThan(1);
  });

  test("reduced motion: hover and focus still reach full opacity", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dashboard");
    await settleToIdle(page);
    expect(await opacityOf(trigger(page))).toBeLessThan(1);
    await trigger(page).hover();
    await expect.poll(() => opacityOf(trigger(page))).toBe(1);
  });
});
