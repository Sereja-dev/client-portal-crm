import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Authenticated Staff Feedback Widget — real-browser coverage: placement,
 * open/close, drag-vs-click, viewport containment, keyboard, tabs, both
 * submissions, mobile layouts, reduced motion, and the pre-auth/portal
 * boundaries. No real email is ever sent: under TEST_MODE the email client
 * short-circuits (see sendEmailViaResend), and recipient routing itself is
 * covered by the unit/integration suites with injected senders.
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

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no bounding box");
  return b;
}

async function expectInsideViewport(page: Page, locator: Locator) {
  const b = await box(locator);
  const vp = page.viewportSize()!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 0.5);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function dragBy(page: Page, locator: Locator, dx: number, dy: number) {
  const b = await box(locator);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 4 });
  await page.mouse.move(cx + dx, cy + dy, { steps: 4 });
  await page.mouse.up();
}

test.describe("Staff feedback widget", () => {
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

  test("is visible on Staff pages as a single control inside the viewport, with no overflow", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(trigger(page)).toHaveCount(1);
    await expect(trigger(page)).toBeVisible();
    await expectInsideViewport(page, trigger(page));
    await expectNoHorizontalOverflow(page);
    await page.goto("/clients");
    await expect(trigger(page)).toBeVisible();
  });

  test("click opens and closes; Escape closes and returns focus to the button", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(panel(page)).toHaveCount(0);
    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(trigger(page)).toHaveAttribute("aria-expanded", "true");
    await expectInsideViewport(page, panel(page));
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(trigger(page)).toBeFocused();
    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    await page.getByRole("button", { name: "Close feedback" }).click();
    await expect(panel(page)).toBeHidden();
  });

  test("tabs switch by click and by arrow keys, with roving focus", async ({ page }) => {
    await page.goto("/dashboard");
    await trigger(page).click();
    const support = page.getByRole("tab", { name: "Support" });
    const bug = page.getByRole("tab", { name: "Report a bug" });
    await expect(support).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Subject")).toBeVisible();
    await bug.click();
    await expect(bug).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel(/Short issue title/)).toBeVisible();
    await expect(page.getByLabel("Subject")).toBeHidden();
    await bug.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(support).toBeFocused();
    await expect(support).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(bug).toHaveAttribute("aria-selected", "true");
  });

  test("dragging moves the button, stays inside the viewport and does not open the panel", async ({ page }) => {
    await page.goto("/dashboard");
    const before = await box(trigger(page));
    await dragBy(page, trigger(page), -300, -200);
    const after = await box(trigger(page));
    expect(before.x - after.x).toBeGreaterThan(200);
    expect(before.y - after.y).toBeGreaterThan(100);
    await expect(panel(page)).toHaveCount(0);
    await dragBy(page, trigger(page), -5000, -5000);
    await expectInsideViewport(page, trigger(page));
    await dragBy(page, trigger(page), 9000, 9000);
    await expectInsideViewport(page, trigger(page));
    await expect(panel(page)).toHaveCount(0);
  });

  test("a plain click without movement still opens after earlier dragging", async ({ page }) => {
    await page.goto("/dashboard");
    await dragBy(page, trigger(page), -80, -80);
    await page.waitForTimeout(500);
    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    await expectInsideViewport(page, panel(page));
  });

  test("Shift+Arrow moves the button without opening it", async ({ page }) => {
    await page.goto("/dashboard");
    await trigger(page).focus();
    const before = await box(trigger(page));
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowUp");
    const after = await box(trigger(page));
    expect(after.x).toBeLessThan(before.x);
    expect(after.y).toBeLessThan(before.y);
    await expect(panel(page)).toHaveCount(0);
  });

  test("shrinking the window keeps a dragged button inside the viewport", async ({ page }) => {
    await page.goto("/dashboard");
    await dragBy(page, trigger(page), -600, -300);
    await page.setViewportSize({ width: 390, height: 700 });
    await expect.poll(async () => (await box(trigger(page))).x + (await box(trigger(page))).width).toBeLessThanOrEqual(390);
    await expectInsideViewport(page, trigger(page));
    await expectNoHorizontalOverflow(page);
  });

  for (const size of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    test(`mobile ${size.width}×${size.height}: button and bottom sheet fit, no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto("/dashboard");
      await expectInsideViewport(page, trigger(page));
      await expectNoHorizontalOverflow(page);
      await trigger(page).click();
      await expect(panel(page)).toBeVisible();
      await expectInsideViewport(page, panel(page));
      await expectNoHorizontalOverflow(page);
      await page.getByRole("tab", { name: "Report a bug" }).click();
      await expectInsideViewport(page, panel(page));
      await page.keyboard.press("Escape");
      await expect(panel(page)).toBeHidden();
    });
  }

  test("reduced motion: still opens and closes", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dashboard");
    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
  });

  test("support: shows the signed-in account and workspace, and submitting succeeds", async ({ page }) => {
    await page.goto("/dashboard");
    await trigger(page).click();
    await expect(panel(page)).toContainText(fixtures.owner.email);
    await expect(panel(page)).toContainText("Test Org A");
    await page.getByLabel("Subject").fill("Question about invoices");
    await page.getByLabel("Message").fill("I would like to know how to change my invoice numbering format.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(panel(page)).toContainText("Your message has been sent to Aqenra Support");
    await page.getByRole("button", { name: "Send another" }).click();
    await expect(page.getByLabel("Subject")).toHaveValue("");
  });

  test("support: empty submit does not report success", async ({ page }) => {
    await page.goto("/dashboard");
    await trigger(page).click();
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(panel(page)).not.toContainText("has been sent");
    await expect(page.getByLabel("Subject")).toBeVisible();
  });

  test("bug report: discloses diagnostics, then submitting succeeds", async ({ page }) => {
    await page.goto("/clients");
    await trigger(page).click();
    await page.getByRole("tab", { name: "Report a bug" }).click();
    await expect(panel(page)).toContainText("What we send with your report");
    await page.getByLabel(/Short issue title/).fill("Save button does nothing");
    await page.getByLabel(/What went wrong/).fill("Clicking save on a client does nothing at all.");
    await page.getByLabel(/Steps to reproduce/).fill("Open a client, edit a field and click Save.");
    await page.getByRole("button", { name: "Send bug report" }).click();
    await expect(panel(page)).toContainText("your bug report has been sent");
  });

  test("typed text survives closing and reopening the panel", async ({ page }) => {
    await page.goto("/dashboard");
    await trigger(page).click();
    await page.getByLabel("Subject").fill("Half-written subject");
    await page.keyboard.press("Escape");
    await trigger(page).click();
    await expect(page.getByLabel("Subject")).toHaveValue("Half-written subject");
  });

  const POSITION_KEY = "aqenra:feedback-widget-position";
  const storedPosition = (page: Page) => page.evaluate((key) => localStorage.getItem(key), POSITION_KEY);

  test("persistence: a dragged position is restored after reload, with only the coordinates stored", async ({ page }) => {
    await page.goto("/dashboard");
    await dragBy(page, trigger(page), -300, -200);
    const moved = await box(trigger(page));
    const raw = await storedPosition(page);
    expect(raw).not.toBeNull();
    expect(Object.keys(JSON.parse(raw!)).sort()).toEqual(["bottom", "right", "version"]);
    await page.reload();
    await expect(trigger(page)).toBeVisible();
    const restored = await box(trigger(page));
    expect(Math.abs(restored.x - moved.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(restored.y - moved.y)).toBeLessThanOrEqual(1);
    await page.goto("/clients");
    const onOtherPage = await box(trigger(page));
    expect(Math.abs(onOtherPage.x - moved.x)).toBeLessThanOrEqual(1);
  });

  test("persistence: a keyboard move is remembered too", async ({ page }) => {
    await page.goto("/dashboard");
    await trigger(page).focus();
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowUp");
    const moved = await box(trigger(page));
    await page.reload();
    const restored = await box(trigger(page));
    expect(Math.abs(restored.x - moved.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(restored.y - moved.y)).toBeLessThanOrEqual(1);
  });

  test("persistence: a plain open/close does not store anything", async ({ page }) => {
    await page.goto("/dashboard");
    await trigger(page).click();
    await page.keyboard.press("Escape");
    expect(await storedPosition(page)).toBeNull();
  });

  test("persistence: nothing the user types is ever written to browser storage", async ({ page }) => {
    await page.goto("/dashboard");
    await dragBy(page, trigger(page), -50, -50);
    await page.waitForTimeout(450);
    await trigger(page).click();
    await page.getByLabel("Subject").fill("UNIQUE-SUBJECT-MARKER-91");
    await page.getByLabel("Message").fill("UNIQUE-MESSAGE-MARKER-91 please do not store this anywhere at all.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(panel(page)).toContainText("has been sent");
    const dump = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);
    expect(dump).not.toContain("UNIQUE-");
    expect(dump).not.toContain(fixtures.owner.email);
    expect(Object.keys(await page.evaluate(() => ({ ...localStorage }))).filter((k) => k.includes("feedback"))).toEqual([POSITION_KEY]);
  });

  test("persistence: a stored far-off position is clamped on a small viewport and the preferred spot returns when the window grows back", async ({ page }) => {
    await page.goto("/dashboard");
    await dragBy(page, trigger(page), -700, -400);
    const wide = await box(trigger(page));
    await page.setViewportSize({ width: 390, height: 700 });
    await expectInsideViewport(page, trigger(page));
    expect(JSON.parse((await storedPosition(page))!).right).toBeGreaterThan(300);
    await page.reload();
    await expectInsideViewport(page, trigger(page));
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(async () => Math.abs((await box(trigger(page))).x - wide.x)).toBeLessThanOrEqual(1);
  });

  test("persistence: corrupt, foreign or out-of-range stored data falls back to the default spot", async ({ page }) => {
    await page.goto("/dashboard");
    const defaultBox = await box(trigger(page));
    for (const bad of ["not json", '{"version":9,"right":50,"bottom":50}', '{"version":1,"right":99999,"bottom":99999}', '{"version":1,"right":"x","bottom":1}']) {
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [POSITION_KEY, bad]);
      await page.reload();
      const b = await box(trigger(page));
      expect(Math.abs(b.x - defaultBox.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.y - defaultBox.y)).toBeLessThanOrEqual(1);
    }
  });

  test("persistence: an in-range stored value larger than the window is clamped inside it", async ({ page }) => {
    await page.goto("/dashboard");
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ version: 1, right: 5000, bottom: 5000 })), POSITION_KEY);
    await page.reload();
    await expectInsideViewport(page, trigger(page));
  });

  test("persistence: restoring a stored position causes no hydration warning", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") problems.push(m.text());
    });
    page.on("pageerror", (e) => problems.push(String(e)));
    await page.goto("/dashboard");
    await dragBy(page, trigger(page), -120, -90);
    await page.reload();
    await expect(trigger(page)).toBeVisible();
    await page.goto("/clients");
    expect(problems.filter((p) => /hydrat|did not match|server rendered HTML/i.test(p))).toEqual([]);
  });

  test("persistence: blocked storage never breaks dragging or the panel", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("blocked", "SecurityError");
      };
      Storage.prototype.getItem = () => {
        throw new DOMException("blocked", "SecurityError");
      };
    });
    await page.goto("/dashboard");
    const before = await box(trigger(page));
    await dragBy(page, trigger(page), -100, -100);
    expect((await box(trigger(page))).x).toBeLessThan(before.x - 50);
    await page.waitForTimeout(450);
    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("is absent from pre-auth pages, which keep their own support widget", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/login");
    await expect(trigger(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Contact Aqenra Support" })).toBeVisible();
  });
});
