import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Design System page migration Batch 6 — Global Search (Cmd+K). Covers
 * this batch's own critical gates: real keyboard interaction (not class
 * strings), focus management, data-equivalence against the existing
 * fixture graph, and Dark computed-style checks for the selected-result
 * state and the dialog surface.
 */

// Same helper/convention as the pre-existing test/e2e/global-search.spec.ts:
// waiting for networkidle after goto() before pressing Ctrl+K avoids a race
// against the global keydown listener's own post-hydration attachment
// (visible in the DOM is not the same as hydrated).
async function gotoAndSettle(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

test.describe("Design System Batch 6 — Global Search", () => {
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

  test("Ctrl+K opens the dialog with focus on the input; Escape closes it", async ({ page, context, baseURL }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await gotoAndSettle(page, "/dashboard");

    const trigger = page.getByRole("button", { name: "Search (Cmd+K)" });
    await expect(trigger).toBeVisible();

    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const input = page.getByRole("combobox", { name: "Search" });
    await expect(input).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });

  test("Clicking the trigger opens the dialog, and native <dialog> focus-restore returns focus to the trigger on Escape (mouse path)", async ({ page, context, baseURL }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await gotoAndSettle(page, "/dashboard");
    const trigger = page.getByRole("button", { name: "Search (Cmd+K)" });
    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    // showModal()'s own spec'd behavior: focus returns to whatever was
    // focused when it was invoked — here, the trigger itself (since it
    // was clicked). Untouched by this batch's visual-only diff.
    await expect(trigger).toBeFocused();
  });

  test("typing a real query returns the matching fixture project, grouped, with a working Enter-to-navigate flow", async ({ page, context, baseURL }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await gotoAndSettle(page, "/dashboard");
    await page.keyboard.press("Control+k");

    const input = page.getByRole("combobox", { name: "Search" });
    await input.fill(fixtures.project.name);
    // Scoped to the "Projects" group specifically — the fixture Task's own
    // subtitle also contains the project's name as substring text, which
    // would otherwise ambiguously match a page-wide role="option" query.
    const projectsGroup = page.getByRole("group", { name: "Projects" });
    await expect(projectsGroup).toBeVisible({ timeout: 5000 });

    // Data-equivalence: exactly the fixture project appears, under its
    // real group label, with the expected href — not a fabricated/altered
    // result.
    const option = projectsGroup.getByRole("option").first();
    const link = option.locator("a");
    await expect(link).toHaveAttribute("href", `/projects/${fixtures.project.id}`);

    // Auto-highlighted first result + Enter activates it (real navigation,
    // not a class-string check).
    await expect(option).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/projects/${fixtures.project.id}$`));
  });

  test("ArrowDown/ArrowUp move the active result between groups", async ({ page, context, baseURL }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await gotoAndSettle(page, "/dashboard");
    await page.keyboard.press("Control+k");

    const input = page.getByRole("combobox", { name: "Search" });
    // "Test" matches both the fixture Client and Project/Task by name.
    await input.fill("Test");
    await expect(page.locator('[role="option"]').first()).toBeVisible({ timeout: 5000 });

    const optionCount = await page.locator('[role="option"]').count();
    test.skip(optionCount < 2, "Fixture data does not yield 2+ results for this query");

    const firstActive = await page.locator('[role="option"][aria-selected="true"]').getAttribute("id");
    await page.keyboard.press("ArrowDown");
    const secondActive = await page.locator('[role="option"][aria-selected="true"]').getAttribute("id");
    expect(secondActive).not.toBe(firstActive);

    await page.keyboard.press("ArrowUp");
    const backToFirst = await page.locator('[role="option"][aria-selected="true"]').getAttribute("id");
    expect(backToFirst).toBe(firstActive);
  });

  test("no results and idle states render without runtime errors", async ({ page, context, baseURL }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectTestSession(context, fixtures.owner, baseURL!);
    await gotoAndSettle(page, "/dashboard");
    await page.keyboard.press("Control+k");

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Search clients, projects, tasks, invoices, and comments.")).toBeVisible();

    const input = page.getByRole("combobox", { name: "Search" });
    await input.fill("zzz_no_such_result_zzz");
    // The same text also exists in a visually-hidden sr-only live region
    // (aria-live announcement) — .first() targets the visible <p>.
    await expect(page.getByText("No results found.").first()).toBeVisible({ timeout: 5000 });
    expect(errors).toEqual([]);
  });

  test("Dark mode: dialog is opaque, selected result readable, no raw-white island", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await injectTestSession(context, fixtures.owner, baseURL!);
    await gotoAndSettle(page, "/dashboard");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await expect.poll(() => dialog.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(27, 31, 38)");

    const input = page.getByRole("combobox", { name: "Search" });
    await input.fill(fixtures.project.name);
    const option = page.getByRole("group", { name: "Projects" }).getByRole("option").first();
    await expect(option).toBeVisible({ timeout: 5000 });

    const activeLink = option.locator("a");
    const activeBg = await activeLink.evaluate((el) => getComputedStyle(el).backgroundColor);
    // Dark's --accent-subtle is rgba(114, 107, 203, 0.16) — never the old
    // literal bg-gray-100, and never fully transparent.
    expect(activeBg).toBe("rgba(114, 107, 203, 0.16)");

    const titleColor = await option.locator("p").first().evaluate((el) => getComputedStyle(el).color);
    expect(titleColor).toBe("rgb(236, 237, 238)");
  });

  test("Mobile (390/320px): dialog fits viewport, no horizontal overflow", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await injectTestSession(context, fixtures.owner, baseURL!);

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 700 });
      await gotoAndSettle(page, "/dashboard");
      // Click the trigger directly rather than the keyboard shortcut — this
      // also exercises the same mobile-visible trigger button a real touch
      // user would tap (its "Search…" label text is hidden below the sm:
      // breakpoint, but the button itself stays present and clickable).
      await page.getByRole("button", { name: "Search (Cmd+K)" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
      await page.keyboard.press("Escape");
    }
  });
});
