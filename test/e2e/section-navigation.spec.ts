import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Section Consolidation — real-browser coverage for the new Finance/
 * Work/Insights/Documents section-tabs navigation layer. Domain-layer
 * tab-set/active-state/permission-filtering logic is already exhaustively
 * covered by test/unit/navigation/section-tabs.test.ts — this file only
 * covers what genuinely needs a real browser: rendering, real navigation,
 * the Billing/SettingsNav boundary, nested-route exclusion, and
 * responsive behavior.
 */

let fixtures: TestFixtures;

async function actAs(
  context: BrowserContext,
  baseURL: string,
  user: { id: string; email: string },
  organizationId: string,
): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, user, baseURL);
  await context.addCookies([
    {
      name: "active_organization_id",
      value: organizationId,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

async function expectNoOverflow(page: Page): Promise<void> {
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasOverflow).toBe(false);
}

test.describe("Section Navigation", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.describe("Finance (OWNER)", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    });

    test("/invoices shows the Finance section tabs", async ({ page }) => {
      await page.goto("/invoices");
      const financeNav = page.getByRole("navigation", { name: "Finance" });
      await expect(financeNav).toBeVisible();
      await expect(financeNav.getByRole("link", { name: "Invoices" })).toHaveAttribute("aria-current", "page");
      await expect(financeNav.getByRole("link", { name: "Quotes" })).toBeVisible();
      await expect(financeNav.getByRole("link", { name: "Recurring" })).toBeVisible();
      await expect(financeNav.getByRole("link", { name: "Billing" })).toBeVisible();
    });

    test("clicking Quotes reaches /quotes with Quotes active", async ({ page }) => {
      await page.goto("/invoices");
      await page.getByRole("navigation", { name: "Finance" }).getByRole("link", { name: "Quotes" }).click();
      await expect(page).toHaveURL(/\/quotes$/);
      const financeNav = page.getByRole("navigation", { name: "Finance" });
      await expect(financeNav.getByRole("link", { name: "Quotes" })).toHaveAttribute("aria-current", "page");
    });

    test("clicking Recurring reaches /recurring-invoices (permitted for OWNER)", async ({ page }) => {
      await page.goto("/invoices");
      await page.getByRole("navigation", { name: "Finance" }).getByRole("link", { name: "Recurring" }).click();
      await expect(page).toHaveURL(/\/recurring-invoices$/);
      const financeNav = page.getByRole("navigation", { name: "Finance" });
      await expect(financeNav.getByRole("link", { name: "Recurring" })).toHaveAttribute("aria-current", "page");
    });

    test("clicking Billing reaches /settings/billing, where Finance tabs disappear and SettingsNav takes over", async ({ page }) => {
      await page.goto("/invoices");
      await page.getByRole("navigation", { name: "Finance" }).getByRole("link", { name: "Billing" }).click();
      await expect(page).toHaveURL(/\/settings\/billing$/);

      // No stacked Finance tab bar on Billing itself.
      await expect(page.getByRole("navigation", { name: "Finance" })).toHaveCount(0);

      // The existing Settings section nav still renders normally, exactly
      // as before this feature (settings/layout.tsx untouched).
      const settingsNav = page.getByRole("navigation", { name: "Settings" });
      await expect(settingsNav).toBeVisible();
      await expect(settingsNav.getByRole("link", { name: "Billing" })).toHaveAttribute("aria-current", "page");

      // Primary Sidebar Finance ownership of /settings/billing is
      // unchanged (sidebar.tsx itself was not touched by this feature).
      const primaryNav = page.getByRole("navigation", { name: "Primary" });
      await expect(primaryNav.getByRole("link", { name: "Billing" })).toHaveAttribute("aria-current", "page");
    });

    test("/settings/billing never renders Finance tabs directly (page never mounts FinanceTabs)", async ({ page }) => {
      await page.goto("/settings/billing");
      await expect(page.getByRole("navigation", { name: "Finance" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    });
  });

  test.describe("Finance (MEMBER without Recurring permission)", () => {
    test("Recurring tab is omitted, not shown disabled; Invoices/Quotes/Billing remain", async ({ page, context, baseURL }) => {
      await actAs(context, baseURL!, fixtures.member, fixtures.orgA.id);
      await page.goto("/invoices");
      const financeNav = page.getByRole("navigation", { name: "Finance" });
      await expect(financeNav.getByRole("link", { name: "Invoices" })).toBeVisible();
      await expect(financeNav.getByRole("link", { name: "Quotes" })).toBeVisible();
      await expect(financeNav.getByRole("link", { name: "Billing" })).toBeVisible();
      await expect(financeNav.getByRole("link", { name: "Recurring" })).toHaveCount(0);
    });
  });

  test.describe("Work (OWNER)", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    });

    test("Projects → Tasks → Calendar → Time, entirely through the Work section tabs", async ({ page }) => {
      await page.goto("/projects");
      const workNav = page.getByRole("navigation", { name: "Work" });
      await expect(workNav.getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");

      await workNav.getByRole("link", { name: "Tasks" }).click();
      await expect(page).toHaveURL(/\/tasks$/);
      await expect(page.getByRole("navigation", { name: "Work" }).getByRole("link", { name: "Tasks" })).toHaveAttribute("aria-current", "page");

      await page.getByRole("navigation", { name: "Work" }).getByRole("link", { name: "Calendar" }).click();
      await expect(page).toHaveURL(/\/calendar$/);
      await expect(page.getByRole("navigation", { name: "Work" }).getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");

      await page.getByRole("navigation", { name: "Work" }).getByRole("link", { name: "Time" }).click();
      await expect(page).toHaveURL(/\/time$/);
      await expect(page.getByRole("navigation", { name: "Work" }).getByRole("link", { name: "Time" })).toHaveAttribute("aria-current", "page");
    });

    test("Calendar's own Month/Agenda/Archived view tabs still work alongside the Work section tabs", async ({ page }) => {
      await page.goto("/calendar");
      await expect(page.getByRole("navigation", { name: "Work" })).toBeVisible();
      await page.getByRole("link", { name: "Agenda" }).click();
      await expect(page).toHaveURL(/view=agenda/);
      // Work tabs remain present after switching Calendar's own local view.
      await expect(page.getByRole("navigation", { name: "Work" }).getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
    });

    test("a nested Project detail/edit route does not show the Work section tab bar", async ({ page }) => {
      await page.goto(`/projects/${fixtures.project.id}/edit`);
      await expect(page.getByRole("navigation", { name: "Work" })).toHaveCount(0);
    });

    test("a nested Task detail/edit route does not show the Work section tab bar", async ({ page }) => {
      await page.goto(`/tasks/${fixtures.task.id}/edit`);
      await expect(page.getByRole("navigation", { name: "Work" })).toHaveCount(0);
    });

    test("the Project create route does not show the Work section tab bar", async ({ page }) => {
      await page.goto("/projects/new");
      await expect(page.getByRole("navigation", { name: "Work" })).toHaveCount(0);
    });
  });

  test.describe("Insights", () => {
    test("OWNER: Analytics / Reports / Activity switching, all three tabs visible", async ({ page, context, baseURL }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/analytics");
      const insightsNav = page.getByRole("navigation", { name: "Insights" });
      await expect(insightsNav.getByRole("link", { name: "Analytics" })).toHaveAttribute("aria-current", "page");
      await expect(insightsNav.getByRole("link", { name: "Reports" })).toBeVisible();
      await expect(insightsNav.getByRole("link", { name: "Activity" })).toBeVisible();

      await insightsNav.getByRole("link", { name: "Reports" }).click();
      await expect(page).toHaveURL(/\/reports$/);
      await expect(page.getByRole("navigation", { name: "Insights" }).getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");

      await page.getByRole("navigation", { name: "Insights" }).getByRole("link", { name: "Activity" }).click();
      await expect(page).toHaveURL(/\/activity$/);
      await expect(page.getByRole("navigation", { name: "Insights" }).getByRole("link", { name: "Activity" })).toHaveAttribute("aria-current", "page");
    });

    test("MEMBER (Analytics/Reports denied by default): Insights degrades to Activity alone", async ({ page, context, baseURL }) => {
      await actAs(context, baseURL!, fixtures.member, fixtures.orgA.id);
      await page.goto("/activity");
      const insightsNav = page.getByRole("navigation", { name: "Insights" });
      await expect(insightsNav.getByRole("link", { name: "Activity" })).toBeVisible();
      await expect(insightsNav.getByRole("link", { name: "Analytics" })).toHaveCount(0);
      await expect(insightsNav.getByRole("link", { name: "Reports" })).toHaveCount(0);
    });
  });

  test.describe("Documents (OWNER)", () => {
    test("/contracts shows the Documents section shell with a single active Contracts tab", async ({ page, context, baseURL }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/contracts");
      const documentsNav = page.getByRole("navigation", { name: "Documents" });
      await expect(documentsNav).toBeVisible();
      await expect(documentsNav.getByRole("link", { name: "Contracts" })).toHaveAttribute("aria-current", "page");
    });
  });

  test.describe("Route preservation", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    });

    const CANONICAL_ROUTES = [
      "/invoices",
      "/quotes",
      "/recurring-invoices",
      "/settings/billing",
      "/projects",
      "/tasks",
      "/calendar",
      "/time",
      "/analytics",
      "/reports",
      "/activity",
      "/contracts",
    ];

    for (const route of CANONICAL_ROUTES) {
      test(`direct load of ${route} still succeeds at its unchanged canonical URL`, async ({ page }) => {
        const response = await page.goto(route);
        expect(response?.ok()).toBe(true);
        await expect(page).toHaveURL(new RegExp(`${route.replace(/[/]/g, "\\/")}$`));
      });
    }
  });

  test.describe("Responsive", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    });

    for (const width of [390, 834, 1280] as const) {
      test(`${width}px: Finance/Work/Insights/Documents tabs render with no horizontal page overflow`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });

        await page.goto("/invoices");
        await expect(page.getByRole("navigation", { name: "Finance" })).toBeVisible();
        await expectNoOverflow(page);

        await page.goto("/projects");
        await expect(page.getByRole("navigation", { name: "Work" })).toBeVisible();
        await expectNoOverflow(page);

        await page.goto("/analytics");
        await expect(page.getByRole("navigation", { name: "Insights" })).toBeVisible();
        await expectNoOverflow(page);

        await page.goto("/contracts");
        await expect(page.getByRole("navigation", { name: "Documents" })).toBeVisible();
        await expectNoOverflow(page);
      });
    }
  });
});
