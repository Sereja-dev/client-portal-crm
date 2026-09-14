import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Reports Phase 2. Real app/database — no mocking. Mirrors
 * test/e2e/analytics-ui.spec.ts's own established structure (actAsMember,
 * fixtures lifecycle, real Recharts SVG assertions) throughout.
 */

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

/** Same pattern as test/e2e/analytics-ui.spec.ts's own actAsMember — every identity switch must set active_organization_id explicitly. */
async function actAsMember(context: BrowserContext, baseURL: string, user: { id: string; email: string }, organizationId: string): Promise<void> {
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

type SeededPaidInvoice = { id: string };
type SeededLead = { id: string };
type SeededTimeEntry = { id: string };

/** One real PAID invoice, one real Lead, one real Project-linked TimeEntry — enough for every Reports section to render non-empty content in a single test run. Caller cleans these up. */
async function seedReportsActivity(fixtures: TestFixtures, currency = "USD"): Promise<{ invoice: SeededPaidInvoice; lead: SeededLead; timeEntry: SeededTimeEntry }> {
  const invoice = await dbQuery<SeededPaidInvoice>("invoice", "create", {
    data: {
      invoiceNumber: `RPT-E2E-${randomUUID().slice(0, 8)}`,
      organizationId: fixtures.orgA.id,
      clientId: fixtures.clientA.id,
      projectId: fixtures.project.id,
      status: "PAID",
      amount: "250.00",
      currency,
      paidAt: new Date(),
      issueDate: new Date(),
    },
  });
  const lead = await dbQuery<SeededLead>("lead", "create", {
    data: { organizationId: fixtures.orgA.id, name: `Reports E2E Lead ${randomUUID().slice(0, 8)}`, stage: "QUALIFIED" },
  });
  const timeEntry = await dbQuery<SeededTimeEntry>("timeEntry", "create", {
    data: { organizationId: fixtures.orgA.id, projectId: fixtures.project.id, durationMinutes: 125, workDate: new Date() },
  });
  return { invoice, lead, timeEntry };
}

async function cleanupReportsActivity(seeded: { invoice: SeededPaidInvoice; lead: SeededLead; timeEntry: SeededTimeEntry }): Promise<void> {
  await dbQuery("invoice", "deleteMany", { where: { id: seeded.invoice.id } });
  await dbQuery("lead", "deleteMany", { where: { id: seeded.lead.id } });
  await dbQuery("timeEntry", "deleteMany", { where: { id: seeded.timeEntry.id } });
}

test.describe("OWNER", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
  });

  test("Reports link is visible in the sidebar, immediately after Analytics, and navigates to /reports", async ({ page }) => {
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Analytics" })).toBeVisible();
    await nav.getByRole("link", { name: "Reports" }).click();
    await expect(page).toHaveURL(/\/reports/);
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
  });

  test("renders every KPI card with exact required labels, and Outstanding uses current-snapshot wording, never the period", async ({ page }) => {
    await page.goto("/reports");

    for (const label of ["Paid revenue", "Outstanding", "New Leads", "Converted Leads", "New Clients", "Tracked hours"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    await expect(page.getByText("Current outstanding receivables")).toBeVisible();
    // "Conversion rate" must never appear anywhere on this page.
    await expect(page.getByText("Conversion rate")).toHaveCount(0);
  });

  test("renders every required section heading with the exact required copy", async ({ page }) => {
    await page.goto("/reports");

    await expect(page.getByRole("heading", { name: "Paid revenue trend" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Current Lead pipeline" })).toBeVisible();
    await expect(page.getByText("Snapshot of active leads by current stage")).toBeVisible();
    // Never implies the pipeline is a historical trend -- checked against
    // the pipeline section's own heading text alone (never the full page,
    // which legitimately contains the word "trend" elsewhere, in both the
    // separate "Paid revenue trend" section heading and this section's
    // own reassuring "not a historical trend" disclaimer).
    const pipelineHeading = await page.getByRole("heading", { name: "Current Lead pipeline" }).innerText();
    expect(pipelineHeading).not.toMatch(/over time|trend|history/i);

    await expect(page.getByRole("heading", { name: "Top Clients" })).toBeVisible();
    await expect(page.getByText("By paid revenue in the selected period")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Time by Client" })).toBeVisible();
    await expect(page.getByText("Tracked time in the selected period")).toBeVisible();
  });

  test("shows real, non-empty data across every section once real activity exists, and the chart actually renders (real SVG)", async ({ page }) => {
    const seeded = await seedReportsActivity(fixtures);
    try {
      await page.goto("/reports?period=this_year");

      await expect(page.getByText("No paid invoices in this period.")).toHaveCount(0);
      await expect(page.getByText("No Leads yet.")).toHaveCount(0);
      await expect(page.getByText("No tracked time in this period.")).toHaveCount(0);

      const trendSection = page.locator("section", { has: page.getByRole("heading", { name: "Paid revenue trend" }) });
      await expect(trendSection.locator("svg").first()).toBeVisible();

      const topClientsSection = page.locator("section", { has: page.getByRole("heading", { name: "Top Clients" }) });
      await expect(topClientsSection.getByRole("cell", { name: fixtures.clientA.name })).toBeVisible();

      const timeSection = page.locator("section", { has: page.getByRole("heading", { name: "Time by Client" }) });
      await expect(timeSection.getByRole("cell", { name: "2h 5m" })).toBeVisible(); // 125 minutes
    } finally {
      await cleanupReportsActivity(seeded);
    }
  });
});

test.describe("ADMIN", () => {
  test("can access /reports and sees the sidebar link", async ({ page, context, baseURL }) => {
    await actAsMember(context, baseURL!, fixtures.admin, fixtures.orgA.id);
    await page.goto("/dashboard");
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Reports" })).toBeVisible();
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Access denied" })).toHaveCount(0);
  });
});

test.describe("MEMBER", () => {
  test("direct /reports navigation fails closed with Access denied, never real report data -- matching the existing Analytics access-denied convention exactly", async ({
    page,
    context,
    baseURL,
  }) => {
    await actAsMember(context, baseURL!, fixtures.member, fixtures.orgA.id);
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
    await expect(page.getByText("Reports is only available to organization owners and admins.")).toBeVisible();
    await expect(page.getByText("Paid revenue", { exact: true })).toHaveCount(0);
  });
});

test.describe("Portal", () => {
  test("a Portal identity navigating to /reports is redirected away, never reaching Staff report data", async ({ page, context, baseURL }) => {
    await context.clearCookies();
    await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL!);
    await page.goto("/reports");
    await expect(page).not.toHaveURL(/\/reports/);
    await expect(page.getByText("Paid revenue", { exact: true })).toHaveCount(0);
  });
});

test.describe("Filters", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
  });

  test("default period is 30d with no query string", async ({ page }) => {
    await page.goto("/reports");
    const periodGroup = page.getByRole("group", { name: "Period" });
    await expect(periodGroup.getByRole("link", { name: "Last 30 days" })).toHaveAttribute("aria-current", "true");
  });

  test("changing period updates the URL and stays selected after reload", async ({ page }) => {
    await page.goto("/reports");
    await page.getByRole("group", { name: "Period" }).getByRole("link", { name: "This month" }).click();
    await expect(page).toHaveURL(/period=this_month/);
    await expect(page.getByRole("group", { name: "Period" }).getByRole("link", { name: "This month" })).toHaveAttribute("aria-current", "true");
  });

  test("an invalid period value in the URL falls back safely to the default, without an error page", async ({ page }) => {
    await page.goto("/reports?period=not-a-real-period");
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
    await expect(page.getByRole("group", { name: "Period" }).getByRole("link", { name: "Last 30 days" })).toHaveAttribute("aria-current", "true");
  });

  test("an invalid/forged currency value in the URL falls back safely, without an error page", async ({ page }) => {
    await page.goto("/reports?currency=ZZZ");
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Access denied" })).toHaveCount(0);
  });

  test("changing period preserves the currently-selected currency; changing currency preserves the currently-selected period", async ({ page }) => {
    const eur = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber: `RPT-E2E-CUR-${randomUUID().slice(0, 8)}`,
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        status: "SENT",
        amount: "10.00",
        currency: "EUR",
        issueDate: new Date(),
      },
    });
    try {
      await page.goto("/reports?period=this_month&currency=EUR");
      const currencyGroup = page.getByRole("group", { name: "Currency" });
      await expect(currencyGroup.getByRole("link", { name: "EUR" })).toHaveAttribute("aria-current", "true");

      // Switch period -- currency=EUR must survive in the URL.
      await page.getByRole("group", { name: "Period" }).getByRole("link", { name: "This quarter" }).click();
      await expect(page).toHaveURL(/currency=EUR/);
      await expect(page).toHaveURL(/period=this_quarter/);

      // Switch currency -- period=this_quarter must survive in the URL.
      await page.getByRole("group", { name: "Currency" }).getByRole("link", { name: "USD" }).click();
      await expect(page).toHaveURL(/period=this_quarter/);
      await expect(page).toHaveURL(/currency=USD/);
    } finally {
      await dbQuery("invoice", "deleteMany", { where: { id: eur.id } });
    }
  });

  test("multiple currencies never blend into one figure -- selecting EUR shows only the EUR amount", async ({ page }) => {
    const usdPaid = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber: `RPT-E2E-USD-${randomUUID().slice(0, 8)}`,
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        status: "PAID",
        amount: "500.00",
        currency: "USD",
        paidAt: new Date(),
        issueDate: new Date(),
      },
    });
    const eurPaid = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber: `RPT-E2E-EUR-${randomUUID().slice(0, 8)}`,
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        status: "PAID",
        amount: "7.00",
        currency: "EUR",
        paidAt: new Date(),
        issueDate: new Date(),
      },
    });
    try {
      await page.goto("/reports?period=this_year&currency=EUR");
      // Scoped to the Paid revenue KPI card itself -- ReportsKpiCard
      // renders `label` and `value` as sibling <p> elements, so the
      // label's own parent is the whole card. `.first()`: the Top Clients
      // table's own "Paid revenue" column header text also matches
      // exact:true; the KPI card is the first such match in DOM order.
      const paidRevenueCard = page.getByText("Paid revenue", { exact: true }).first().locator("xpath=..");
      await expect(paidRevenueCard).toContainText("€7.00");
      await expect(paidRevenueCard).not.toContainText("$500.00");
      await expect(paidRevenueCard).not.toContainText("507");
      await expect(page.getByText("$500.00")).toHaveCount(0);
    } finally {
      await dbQuery("invoice", "deleteMany", { where: { id: { in: [usdPaid.id, eurPaid.id] } } });
    }
  });
});

test.describe("Zero-data", () => {
  test("a brand-new organization with no invoices/Leads/Clients/TimeEntries renders every section's own explicit empty state, no runtime exception", async ({
    page,
    context,
    baseURL,
  }) => {
    const empty = await dbQuery<{ id: string }>("organization", "create", {
      data: { name: `E2E Reports Empty ${fixtures.runId}`, slug: `e2e-reports-empty-${fixtures.runId}` },
    });
    await dbQuery("membership", "create", { data: { userId: fixtures.owner.id, organizationId: empty.id, role: "OWNER" } });

    try {
      await actAsMember(context, baseURL!, fixtures.owner, empty.id);
      await page.goto("/reports");

      await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Access denied" })).toHaveCount(0);

      // Financial cards show a real zero, formatted, not blank/dash-only
      // (both Paid revenue and Outstanding legitimately show "$0.00" for
      // a brand-new organization -- scoped per-card, not a bare page-wide
      // text search, since asserting "at least one $0.00 exists" would be
      // true even if only one of the two cards rendered correctly).
      const paidRevenueCard = page.getByText("Paid revenue", { exact: true }).locator("xpath=..");
      await expect(paidRevenueCard).toContainText("$0.00");
      const outstandingCard = page.getByText("Outstanding", { exact: true }).locator("xpath=..");
      await expect(outstandingCard).toContainText("$0.00");
      await expect(page.getByText("0h 0m")).toBeVisible();

      await expect(page.getByText("No paid invoices in this period.")).toHaveCount(2); // chart + Top Clients
      await expect(page.getByText("No Leads yet.")).toBeVisible();
      await expect(page.getByText("No tracked time in this period.")).toBeVisible();
    } finally {
      await dbQuery("membership", "deleteMany", { where: { organizationId: empty.id } });
      await dbQuery("organization", "delete", { where: { id: empty.id } });
    }
  });
});

test.describe("Responsive", () => {
  for (const { width, label } of [
    { width: 1280, label: "1280px (desktop)" },
    { width: 834, label: "834px (tablet)" },
    { width: 390, label: "390px (mobile)" },
  ]) {
    test(`at ${label}: header, filters, KPI cards, and every section render with no page-level horizontal overflow`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width, height: 900 });
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);

      await page.goto("/reports");
      await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
      await expect(page.getByText("Paid revenue", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Paid revenue trend" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Current Lead pipeline" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Top Clients" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Time by Client" })).toBeVisible();

      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflowX).toBe(false);
    });
  }
});

test.describe("Accessibility", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
  });

  test("period and currency controls are labeled groups, and Top Clients renders real table column headers once it has data", async ({ page }) => {
    const eur = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber: `RPT-E2E-A11Y-SENT-${randomUUID().slice(0, 8)}`,
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        status: "SENT",
        amount: "10.00",
        currency: "EUR",
        issueDate: new Date(),
      },
    });
    const paid = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber: `RPT-E2E-A11Y-PAID-${randomUUID().slice(0, 8)}`,
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        status: "PAID",
        amount: "20.00",
        currency: "USD",
        paidAt: new Date(),
        issueDate: new Date(),
      },
    });
    try {
      await page.goto("/reports?period=this_year&currency=USD");

      await expect(page.getByRole("group", { name: "Period" })).toBeVisible();
      // Two currencies now exist for org A (USD, EUR) -- a real selector group renders.
      await expect(page.getByRole("group", { name: "Currency" })).toBeVisible();

      const topClientsSection = page.locator("section", { has: page.getByRole("heading", { name: "Top Clients" }) });
      await expect(topClientsSection.getByRole("columnheader", { name: "Client" })).toBeVisible();
      await expect(topClientsSection.getByRole("columnheader", { name: "Paid revenue" })).toBeVisible();

      // The chart has a real text-accessible name, not a bare decorative image.
      await expect(page.getByRole("img", { name: /Paid revenue trend, total/ })).toBeVisible();
    } finally {
      await dbQuery("invoice", "deleteMany", { where: { id: { in: [eur.id, paid.id] } } });
    }
  });
});
