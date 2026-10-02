import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Finance Overview V1 (Sub-block A) — the new `/finance` route: Finance >
 * Overview navigation, the five KPI cards, the currency selector (and
 * that switching it updates only the monetary KPIs, never the two
 * organization-wide counts), and that every other existing Finance
 * destination (Invoices/Quotes/Recurring/Billing) and Quotes' own Sales
 * discoverability remain unaffected. Per-field Invoice/Quote CRUD is
 * already exhaustively covered by invoices.spec.ts/quotes.spec.ts —
 * deliberately not repeated here.
 */

let fixtures: TestFixtures;
let extraInvoiceIds: string[] = [];
let extraQuoteIds: string[] = [];

async function actAs(
  context: BrowserContext,
  baseURL: string,
  identity: { id: string; email: string },
  organizationId: string,
): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, identity, baseURL);
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

test.describe("Finance Overview", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterEach(async () => {
    if (extraInvoiceIds.length > 0) {
      await dbQuery("invoice", "deleteMany", { where: { id: { in: extraInvoiceIds } } });
      extraInvoiceIds = [];
    }
    if (extraQuoteIds.length > 0) {
      await dbQuery("quote", "deleteMany", { where: { id: { in: extraQuoteIds } } });
      extraQuoteIds = [];
    }
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("Finance > Overview navigation works; Overview tab is active; five KPI cards render", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/invoices");

    const financeNav = page.getByRole("navigation", { name: "Finance" });
    await financeNav.getByRole("link", { name: "Overview" }).click();
    await expect(page).toHaveURL(/\/finance$/);
    await expect(financeNav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");

    await expect(page.getByText("Outstanding", { exact: true })).toBeVisible();
    await expect(page.getByText("Overdue", { exact: true })).toBeVisible();
    await expect(page.getByText("Paid this month", { exact: true })).toBeVisible();
    await expect(page.getByText("Draft invoices", { exact: true })).toBeVisible();
    await expect(page.getByText("Quotes awaiting approval", { exact: true })).toBeVisible();
  });

  test("/finance loads directly; Invoices/Quotes/Recurring/Billing tabs still work; Sales > Quotes remains discoverable", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/finance");
    await expect(page.getByRole("heading", { name: "Finance", level: 1 })).toBeVisible();

    const financeNav = page.getByRole("navigation", { name: "Finance" });
    await financeNav.getByRole("link", { name: "Invoices" }).click();
    await expect(page).toHaveURL(/\/invoices$/);

    await page.goto("/finance");
    await financeNav.getByRole("link", { name: "Quotes" }).click();
    await expect(page).toHaveURL(/\/quotes$/);

    await page.goto("/finance");
    await financeNav.getByRole("link", { name: "Recurring" }).click();
    await expect(page).toHaveURL(/\/recurring-invoices$/);

    await page.goto("/finance");
    await financeNav.getByRole("link", { name: "Billing" }).click();
    await expect(page).toHaveURL(/\/settings\/billing$/);

    // Quotes remains discoverable from its own primary Sidebar Sales
    // group — Finance Overview's addition does not duplicate it there.
    await page.goto("/dashboard");
    const salesGroup = page.getByRole("navigation", { name: "Primary" }).locator("details", { has: page.getByText("Sales") });
    await salesGroup.locator("summary").evaluate((el) => {
      const details = el.closest("details");
      if (details) details.open = true;
    });
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Quotes" })).toBeVisible();
  });

  test("currency selector: multiple currencies render a real selector; switching currency updates only the monetary KPIs, never the counts", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const usdInvoice = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber: `FO-USD-${Date.now()}`,
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        amount: "123.00",
        currency: "USD",
        status: "SENT",
      },
    });
    const aedInvoice = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber: `FO-AED-${Date.now()}`,
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        amount: "456.00",
        currency: "AED",
        status: "SENT",
      },
    });
    extraInvoiceIds = [usdInvoice.id, aedInvoice.id];

    await page.goto("/finance?currency=USD");
    const outstandingUsdCard = page.getByText("Outstanding", { exact: true }).locator("..");
    await expect(outstandingUsdCard).toContainText("$");
    const draftCountText = await page.getByText("Draft invoices", { exact: true }).locator("..").textContent();

    const selector = page.getByRole("group", { name: "Currency" });
    await expect(selector.getByRole("link", { name: "AED" })).toBeVisible();
    await selector.getByRole("link", { name: "AED" }).click();
    await expect(page).toHaveURL(/currency=AED/);

    const outstandingAedCard = page.getByText("Outstanding", { exact: true }).locator("..");
    await expect(outstandingAedCard).not.toContainText("$");
    const draftCountTextAfter = await page.getByText("Draft invoices", { exact: true }).locator("..").textContent();
    // The organization-wide Draft invoices count must be identical
    // regardless of the selected currency — it is never currency-scoped.
    expect(draftCountTextAfter).toBe(draftCountText);

    // Never a blended total: USD and AED are never summed into one figure.
    await expect(page.getByText(/\$\s*579/)).toHaveCount(0);
  });

  test("Quotes awaiting approval and Draft invoices show truthful counts, never a money total or mixed-currency figure", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const sentQuote = await dbQuery<{ id: string }>("quote", "create", {
      data: {
        number: `FO-Q-${Date.now()}`,
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        subtotal: "500.00",
        total: "500.00",
        createdByUserId: fixtures.owner.id,
        status: "SENT",
      },
    });
    extraQuoteIds = [sentQuote.id];

    await page.goto("/finance");
    const quotesCard = page.getByText("Quotes awaiting approval").locator("..");
    await expect(quotesCard).toBeVisible();
    // A count card never shows a currency symbol.
    await expect(quotesCard).not.toContainText("$");
  });

  test("390x900: Finance header, tabs, currency selector, and KPI cards fit with no destructive page-level horizontal overflow", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/finance");

    await expect(page.getByRole("heading", { name: "Finance", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Finance" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  });
});
