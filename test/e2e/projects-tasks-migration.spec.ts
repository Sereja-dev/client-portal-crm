import { test, expect } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Design System page migration Batch 3 — Projects + Tasks. Covers the
 * invariants this batch's own audit requires: semantic surfaces (no
 * raw-light page wrapper visible in Dark), preserved business behavior
 * (search/filter/pagination/navigation/permissions unchanged), and the
 * one real behavioral touch this batch made — CommentComposer's Cancel
 * control moving from a raw `<button>` to the shared `<Button
 * variant="secondary">` (same element type, same onClick/disabled
 * wiring) — still opens/cancels correctly.
 *
 * Not a class-string snapshot suite: assertions are computed-style
 * contrast checks and real interaction outcomes, not literal className
 * comparisons (see this project's own testing conventions).
 *
 * getByLabel calls below deliberately omit `exact: true` — every field
 * here is `required`, and FormField's own required-marker asterisk
 * (aria-hidden="true", pre-existing/unchanged by this batch) is still
 * included in Chromium's actual computed accessible name despite the
 * aria-hidden attribute, so an exact "Name" match never resolves. This
 * is a pre-existing FormField characteristic shared by every required
 * field in the app, not something this batch introduced.
 */

test.describe("Design System Batch 3 — Projects + Tasks", () => {
  let fixtures: TestFixtures;

  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "LIGHT" } });
    await injectTestSession(context, fixtures.owner, baseURL!);
  });

  test("Projects list: search/filter/pagination params preserved, Edit link navigates", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add project" })).toHaveAttribute("href", "/projects/new");

    // Search preserves the query string exactly (same list-params contract
    // every other migrated list page already uses).
    await page.goto("/projects?q=Test");
    await expect(page).toHaveURL(/[?&]q=Test/);
    await expect(page.getByRole("cell", { name: fixtures.project.name })).toBeVisible();

    const editLink = page.getByRole("link", { name: /Edit/ }).first();
    await expect(editLink).toHaveAttribute("href", `/projects/${fixtures.project.id}/edit`);
    await editLink.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${fixtures.project.id}/edit$`));
  });

  test("Tasks list: filters preserved, Edit link navigates", async ({ page }) => {
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add task" })).toHaveAttribute("href", "/tasks/new");

    await page.goto("/tasks?status=TODO");
    await expect(page).toHaveURL(/[?&]status=TODO/);

    const editLink = page.getByRole("link", { name: /Edit/ }).first();
    await expect(editLink).toHaveAttribute("href", `/tasks/${fixtures.task.id}/edit`);
    await editLink.click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${fixtures.task.id}/edit$`));
  });

  test("Project create form renders shared controls and Cancel returns to the list", async ({ page }) => {
    await page.goto("/projects/new");
    await expect(page.getByRole("heading", { name: "Add project" })).toBeVisible();
    await expect(page.getByLabel("Name")).toBeVisible();
    await expect(page.getByLabel("Client")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create project" })).toBeVisible();

    await page.getByRole("link", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/\/projects$/);
  });

  test("Task create form renders shared controls and Cancel returns to the list", async ({ page }) => {
    await page.goto("/tasks/new");
    await expect(page.getByRole("heading", { name: "Add task" })).toBeVisible();
    await expect(page.getByLabel("Title")).toBeVisible();
    await expect(page.getByLabel("Project")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create task" })).toBeVisible();

    await page.getByRole("link", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
  });

  test("Project edit page: form defaults populated, comments section present with working composer", async ({ page }) => {
    await page.goto(`/projects/${fixtures.project.id}/edit`);
    await expect(page.getByRole("heading", { name: "Edit project" })).toBeVisible();
    await expect(page.getByLabel("Name")).toHaveValue(fixtures.project.name);
    await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();

    await page.getByLabel("Comment").fill("A migration-check comment.");
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect(page.getByText("A migration-check comment.")).toBeVisible();

    // Exercise the Cancel control specifically — this batch swapped it
    // from a raw <button> to the shared <Button variant="secondary">.
    await page.getByRole("button", { name: "Edit" }).first().click();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    // "Save" (exact) is the comment composer's own edit-mode submit label,
    // distinct from ProjectForm's own always-visible "Save changes" button.
    await expect(page.getByRole("button", { name: "Save", exact: true })).not.toBeVisible();
  });

  test("Task edit page: form defaults populated, comments section present", async ({ page }) => {
    await page.goto(`/tasks/${fixtures.task.id}/edit`);
    await expect(page.getByRole("heading", { name: "Edit task" })).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue(fixtures.task.title);
    await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
  });

  test("Dark mode: Projects/Tasks list and edit pages have no raw-light page-owned surfaces", async ({ page }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });

    for (const path of ["/projects", `/projects/${fixtures.project.id}/edit`, "/tasks", `/tasks/${fixtures.task.id}/edit`]) {
      await page.goto(path);
      await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

      const heading = page.getByRole("heading").first();
      // Dark's --text-primary is rgb(236, 237, 238) — a raw text-gray-900
      // leftover would instead report near-black (~rgb(23,23,23)).
      await expect.poll(() => heading.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(236, 237, 238)");

      const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bodyBg).not.toBe("rgb(255, 255, 255)");
    }
  });

  test("Dark mode: primary action link and card wrapper are opaque, not alpha-over-wrong-ancestor", async ({ page }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });

    await page.goto("/projects");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
    const primaryLink = page.getByRole("link", { name: "Add project" });
    // Dark's --accent is #6C65C9 = rgb(108, 101, 201) — darkened from the
    // original #726BCB during the shared Dark accent contrast correction
    // (PLATFORM_ADMIN_DARK_ACCENT_CONTRAST_CORRECTION in globals.css) to
    // restore white-on-fill contrast above WCAG AA's 4.5:1. Polled (not a
    // single evaluate) since the button's own transition-colors briefly
    // reports an in-flight interpolated value right after the theme
    // attribute flips.
    await expect.poll(() => primaryLink.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(108, 101, 201)");

    await page.goto(`/projects/${fixtures.project.id}/edit`);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
    // ProjectForm's own <form> specifically (Header also renders a search
    // <form>) — its immediate parent is the page-owned CARD_SURFACE_CLASSES
    // wrapper.
    const card = page.locator("form").filter({ has: page.getByLabel("Name") }).locator("..");
    // Dark's --surface is #1B1F26 = rgb(27, 31, 38) — fully opaque, not a
    // wash composited over an unmigrated ancestor.
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(27, 31, 38)");
  });
});
