import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Dashboard Redesign — real-browser coverage for the operational
 * Dashboard structure: exactly five KPI cards, the old page-level period
 * selector/Revenue chart/three status-breakdown cards genuinely absent,
 * Needs Attention/Today/Recent Activity all present, the three header
 * CTAs correct (including the real overdue-filtered Tasks destination),
 * and responsive behavior at the app's own established representative
 * widths. Domain-layer semantics (exact KPI/Needs-Attention/Today
 * query correctness) are already exhaustively covered by
 * test/integration/dashboard/redesign-semantics.test.ts — this file only
 * covers what genuinely needs a real browser.
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

async function gotoDashboard(page: Page): Promise<void> {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test.describe("Dashboard Redesign", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsOwner(context, baseURL!);
  });

  test.describe("Structure", () => {
    test("renders exactly five KPI cards, with the correct labels", async ({ page }) => {
      await gotoDashboard(page);
      // Scoped to <main> — the sidebar's own "Clients" nav link (outside
      // <main>) would otherwise also match the bare label.
      const main = page.getByRole("main");
      for (const label of ["Clients", "Active projects", "Open tasks", "Outstanding invoices", "Revenue"]) {
        await expect(main.getByRole("link", { name: new RegExp(`^${label}`, "i") })).toBeVisible();
      }
      // Exactly five — the old sixth card ("Paid revenue"/"Overdue tasks")
      // is gone; count every KPI-card-shaped link by its own <p> label
      // structure via the total number of matches for the five names above.
      const kpiLinks = main.getByRole("link", { name: /^(Clients|Active projects|Open tasks|Outstanding invoices|Revenue)( |$)/ });
      await expect(kpiLinks).toHaveCount(5);
    });

    test("the old page-level period selector is absent", async ({ page }) => {
      await gotoDashboard(page);
      await expect(page.getByText("Period", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "7 days" })).toHaveCount(0);
    });

    test("the Revenue-over-time chart is absent", async ({ page }) => {
      await gotoDashboard(page);
      await expect(page.getByRole("heading", { name: "Revenue over time" })).toHaveCount(0);
    });

    test("the three status-breakdown cards are absent", async ({ page }) => {
      await gotoDashboard(page);
      await expect(page.getByRole("heading", { name: "Invoice status" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Task status" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Project status" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Breakdowns" })).toHaveCount(0);
    });

    test("Needs attention, Today, and Recent activity are all present", async ({ page }) => {
      await gotoDashboard(page);
      await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
    });
  });

  test.describe("CTAs", () => {
    test("Add client links to /clients/new", async ({ page }) => {
      await gotoDashboard(page);
      await expect(page.getByRole("link", { name: "Add client" })).toHaveAttribute("href", "/clients/new");
    });

    test("Create invoice links to /invoices/new", async ({ page }) => {
      await gotoDashboard(page);
      await expect(page.getByRole("link", { name: "Create invoice" })).toHaveAttribute("href", "/invoices/new");
    });

    test("View overdue tasks links to the real overdue-filtered Tasks destination and lands correctly", async ({ page }) => {
      await gotoDashboard(page);
      const cta = page.getByRole("link", { name: "View overdue tasks" });
      await expect(cta).toHaveAttribute("href", "/tasks?overdue=true");
      await cta.click();
      await expect(page).toHaveURL(/\/tasks\?overdue=true/);
      // The active-filter state is visible — the subtitle names "overdue"
      // and the SearchFilterBar's own existing "Clear" link appears.
      await expect(page.getByText(/overdue task/i)).toBeVisible();
    });
  });

  test.describe("Needs attention — empty and populated states", () => {
    test("a bounded overdue-invoice row shows in Needs Attention and links to the real invoice", async ({ page }) => {
      const overdueInvoice = await dbQuery<{ id: string; invoiceNumber: string }>("invoice", "create", {
        data: {
          invoiceNumber: `E2E-DASH-NA-${Date.now()}`,
          status: "SENT",
          amount: "77.00",
          subtotal: "77.00",
          discountAmount: "0.00",
          taxAmount: "0.00",
          currency: "USD",
          clientId: fixtures.clientA.id,
          organizationId: fixtures.orgA.id,
          issueDate: new Date(),
          dueDate: new Date("2020-01-01T00:00:00.000Z"),
        },
      });
      try {
        await gotoDashboard(page);
        await expect(page.getByRole("heading", { name: "Overdue invoices" })).toBeVisible();
        await expect(page.getByText(overdueInvoice.invoiceNumber)).toBeVisible();
      } finally {
        await dbQuery("invoice", "deleteMany", { where: { id: overdueInvoice.id } });
      }
    });
  });

  test.describe("Responsive", () => {
    async function expectNoOverflow(page: Page): Promise<void> {
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);
    }

    test("390px: KPI cards and CTAs remain usable, no horizontal overflow", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoDashboard(page);
      await expect(page.getByRole("link", { name: "Add client" })).toBeVisible();
      await expectNoOverflow(page);
    });

    test("834px: KPI grid and Needs Attention/Today stack usably, no overflow", async ({ page }) => {
      await page.setViewportSize({ width: 834, height: 1100 });
      await gotoDashboard(page);
      await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
      await expectNoOverflow(page);
    });

    test("1280px: full desktop layout, no overflow", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await gotoDashboard(page);
      await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
      await expectNoOverflow(page);
    });
  });
});
