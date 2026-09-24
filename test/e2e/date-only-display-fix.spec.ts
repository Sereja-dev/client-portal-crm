import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Date-Only Display Drift Fix. Real browser coverage proving that
 * Task.dueDate, Project.startDate/endDate, and (Portal) Invoice.issueDate/
 * dueDate — all date-only values, stored as UTC midnight on their own
 * named calendar date — now render via the existing
 * formatDateOnlyForDisplay() helper (src/lib/invoices/date-only.ts) at
 * every surface, instead of the previous bare `.toLocaleDateString()`
 * that could silently roll back to the previous calendar day for any
 * negative-UTC-offset viewer.
 *
 * These pages are Server Components — the date text is rendered in the
 * Node.js process running the app, not by the browser, so a Playwright
 * context's own `timezoneId` option has no effect on it (it only governs
 * client-side JS) — see test/e2e/invoices.spec.ts's own identical "date-
 * only display — no local-timezone drift" block, whose exact technique
 * this mirrors: the expected text is computed with the same expression
 * production uses (`date.toLocaleDateString(undefined, { timeZone: "UTC" })`),
 * so what these tests actually prove is the absence of drift (the wrong
 * calendar day), not any one locale's particular formatting. The shared
 * helper's own zone-independence-by-construction (it unconditionally
 * pins `timeZone: "UTC"`, so no runtime offset — negative, zero, or
 * positive — can ever change its output) is already exhaustively proven
 * by test/unit/invoice-date-only.test.ts and is not re-derived here; these
 * tests instead prove each of the fixed surfaces below actually wires
 * into that already-safe helper.
 */

async function actAsStaff(context: BrowserContext, baseURL: string, user: { id: string; email: string }, organizationId: string): Promise<void> {
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

async function actAsPortalUser(context: BrowserContext, baseURL: string, portalUser: { id: string; email: string }): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, portalUser, baseURL);
}

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

// A fixed UTC-midnight fixture in the past (for overdue/list assertions)
// and one in the future (for Project/Portal Invoice start/end/due-date
// assertions below) — both are the exact stored shape parseDateOnly()
// itself produces, and neither depends on the current date, keeping
// every assertion deterministic.
const PAST_DATE_ONLY = new Date("2020-01-06T00:00:00.000Z");
const FUTURE_DATE_ONLY = new Date("2099-06-15T00:00:00.000Z");
const expectedText = (d: Date) => d.toLocaleDateString(undefined, { timeZone: "UTC" });

test.describe("Task.dueDate — no calendar-day drift", () => {
  let taskId: string;

  test.beforeAll(async () => {
    const created = await dbQuery<{ id: string }>("task", "create", {
      data: {
        title: "Date Drift Fixture Task",
        projectId: fixtures.project.id,
        organizationId: fixtures.orgA.id,
        status: "TODO",
        priority: "MEDIUM",
        dueDate: PAST_DATE_ONLY,
      },
    });
    taskId = created.id;
  });

  test.afterAll(async () => {
    await dbQuery("task", "deleteMany", { where: { id: taskId } });
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsStaff(context, baseURL!, fixtures.owner, fixtures.orgA.id);
  });

  test("Dashboard Needs Attention (overdue tasks) shows the correct calendar day", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Date Drift Fixture Task")).toBeVisible();
    await expect(page.getByText(`Due ${expectedText(PAST_DATE_ONLY)}`, { exact: true })).toBeVisible();
  });

  test("Task list (table) shows the correct calendar day", async ({ page }) => {
    await page.goto("/tasks");
    const row = page.getByRole("row", { name: /Date Drift Fixture Task/ });
    await expect(row.getByText(expectedText(PAST_DATE_ONLY), { exact: true })).toBeVisible();
  });

  test("a null dueDate still renders the existing empty-state dash on the Task list", async ({ page }) => {
    await page.goto("/tasks");
    const row = page.getByRole("row", { name: /Test Task/ });
    await expect(row.getByText("—", { exact: true }).first()).toBeVisible();
  });
});

/**
 * Dashboard Redesign — the previous version of this file had a
 * "Task.dueDate — Dashboard Upcoming tasks" block here, proving a
 * future-dated task's own due-date text rendered without drift on the
 * Dashboard's own "Upcoming tasks" card. That card (and the
 * getDashboardAnalytics().upcomingTasks list it rendered) was removed
 * from the Dashboard page by the redesign — the underlying query/data
 * still exists unchanged (getOrganizationSummary's own AI-tool contract
 * still reads it), but nothing on /dashboard displays it anymore, so
 * there is no remaining real surface for this specific future-dated
 * assertion to exercise there. The past-dated case is still fully
 * covered above ("Dashboard Needs Attention (overdue tasks)" and "Task
 * list (table)"), and formatDateOnlyForDisplay()'s own zone-independence
 * for ANY date (past or future alike, it has no direction-specific
 * branch) remains exhaustively proven at the unit level by
 * test/unit/invoice-date-only.test.ts, per this file's own header
 * comment — removing this one redundant E2E case is not a coverage gap.
 */

test.describe("Project.startDate/endDate — no calendar-day drift", () => {
  let projectId: string;

  test.beforeAll(async () => {
    const created = await dbQuery<{ id: string }>("project", "create", {
      data: {
        name: "Date Drift Fixture Project",
        clientId: fixtures.clientA.id,
        ownerId: fixtures.owner.id,
        organizationId: fixtures.orgA.id,
        startDate: PAST_DATE_ONLY,
        endDate: FUTURE_DATE_ONLY,
      },
    });
    projectId = created.id;
  });

  test.afterAll(async () => {
    await dbQuery("project", "deleteMany", { where: { id: projectId } });
  });

  test("Staff Project list (table) shows the correct calendar days for start and end date", async ({ context, baseURL, page }) => {
    await actAsStaff(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/projects");
    const row = page.getByRole("row", { name: /Date Drift Fixture Project/ });
    await expect(row.getByText(expectedText(PAST_DATE_ONLY), { exact: true })).toBeVisible();
    await expect(row.getByText(expectedText(FUTURE_DATE_ONLY), { exact: true })).toBeVisible();
  });

  test("a null start/end date still renders the existing empty-state dash on the Project list", async ({ context, baseURL, page }) => {
    await actAsStaff(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const bareProject = await dbQuery<{ id: string }>("project", "create", {
      data: { name: "Date Drift No Dates Project", clientId: fixtures.clientA.id, ownerId: fixtures.owner.id, organizationId: fixtures.orgA.id },
    });
    try {
      await page.goto("/projects");
      const row = page.getByRole("row", { name: /Date Drift No Dates Project/ });
      await expect(row.getByText("—", { exact: true }).first()).toBeVisible();
    } finally {
      await dbQuery("project", "deleteMany", { where: { id: bareProject.id } });
    }
  });

  test("Portal Project list shows the correct calendar days for start and end date", async ({ context, baseURL, page }) => {
    await actAsPortalUser(context, baseURL!, { id: fixtures.portalUser.id, email: fixtures.portalUser.email });
    await page.goto("/portal/projects");
    const row = page.getByRole("row", { name: /Date Drift Fixture Project/ });
    await expect(row.getByText(expectedText(PAST_DATE_ONLY), { exact: true })).toBeVisible();
    await expect(row.getByText(expectedText(FUTURE_DATE_ONLY), { exact: true })).toBeVisible();
  });

  test("Portal Project detail shows the correct calendar days for start and end date", async ({ context, baseURL, page }) => {
    await actAsPortalUser(context, baseURL!, { id: fixtures.portalUser.id, email: fixtures.portalUser.email });
    await page.goto(`/portal/projects/${projectId}`);
    await expect(page.getByText(expectedText(PAST_DATE_ONLY), { exact: true })).toBeVisible();
    await expect(page.getByText(expectedText(FUTURE_DATE_ONLY), { exact: true })).toBeVisible();
  });
});

test.describe("Portal Invoice.issueDate/dueDate — no calendar-day drift", () => {
  let invoiceId: string;
  const invoiceNumber = `E2E-DATEDRIFT-PORTAL-${Date.now()}`;

  test.beforeAll(async () => {
    const created = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber,
        status: "SENT",
        amount: "50.00",
        subtotal: "50.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        issueDate: PAST_DATE_ONLY,
        dueDate: FUTURE_DATE_ONLY,
        clientId: fixtures.clientA.id,
        organizationId: fixtures.orgA.id,
      },
    });
    invoiceId = created.id;
  });

  test.afterAll(async () => {
    await dbQuery("invoice", "deleteMany", { where: { id: invoiceId } });
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsPortalUser(context, baseURL!, { id: fixtures.portalUser.id, email: fixtures.portalUser.email });
  });

  test("Portal Invoice list shows the correct calendar days for issue and due date", async ({ page }) => {
    await page.goto("/portal/invoices");
    const row = page.getByRole("row", { name: new RegExp(invoiceNumber) });
    await expect(row.getByText(expectedText(PAST_DATE_ONLY), { exact: true })).toBeVisible();
    await expect(row.getByText(expectedText(FUTURE_DATE_ONLY), { exact: true })).toBeVisible();
  });

  test("Portal Invoice detail shows the correct calendar days for issue and due date", async ({ page }) => {
    await page.goto(`/portal/invoices/${invoiceId}`);
    await expect(page.getByText(expectedText(PAST_DATE_ONLY), { exact: true })).toBeVisible();
    await expect(page.getByText(expectedText(FUTURE_DATE_ONLY), { exact: true })).toBeVisible();
  });

  test("a null dueDate still renders the existing empty-state dash on the Portal Invoice list", async ({ page }) => {
    const noDueDateInvoiceNumber = `E2E-DATEDRIFT-PORTAL-NODUE-${Date.now()}`;
    const noDueDateInvoice = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber: noDueDateInvoiceNumber,
        status: "SENT",
        amount: "20.00",
        subtotal: "20.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        issueDate: PAST_DATE_ONLY,
        dueDate: null,
        clientId: fixtures.clientA.id,
        organizationId: fixtures.orgA.id,
      },
    });
    try {
      await page.goto("/portal/invoices");
      const row = page.getByRole("row", { name: new RegExp(noDueDateInvoiceNumber) });
      await expect(row.getByText("—", { exact: true })).toBeVisible();
    } finally {
      await dbQuery("invoice", "deleteMany", { where: { id: noDueDateInvoice.id } });
    }
  });
});
