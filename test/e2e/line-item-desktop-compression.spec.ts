import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Desktop line-item compression fix — permanent regression coverage for
 * the defect found by the dedicated Recurring Invoice overflow-readiness
 * audit: the shared InvoiceLineItemRow's bare `1fr` Description track
 * had no protective minimum, silently collapsing to ~73–75px at any
 * container width tight enough (Recurring, at every desktop width, via
 * its own narrower max-w-xl page; Invoice/Quote, dormant, only once
 * their own two-column live-preview layout activates at >=1024px) — all
 * with zero page-level or row-level overflow to signal it.
 *
 * The fix is two-part, both confirmed necessary while building it:
 * 1. InvoiceLineItemRow's own grid: `minmax(10rem, 1fr)` gives
 *    Description a real floor; `min-w-0` + `overflow-x-auto` on that
 *    same `<fieldset>` lets it contain any residual shortfall as a
 *    LOCAL horizontal scroll, never a page-level one.
 * 2. RecurringInvoiceForm's own "Invoice contents" `<fieldset>` (B1
 *    sectioning, unique to Recurring — Invoice/Quote never wrap their
 *    line items in an extra fieldset layer) needed its own `min-w-0`:
 *    every `<fieldset>`'s UA-stylesheet default `min-width: min-content`
 *    is NOT limited by a descendant's own overflow-x-auto opt-out, so
 *    without this second `min-w-0`, the outer fieldset kept forcing
 *    itself (and therefore the page) wider than the card — confirmed
 *    empirically as a genuine page-level overflow regression before
 *    this second change was added.
 *
 * At every width below, "local horizontal scroll inside the row" when
 * the row's own minimum (10rem Description + fixed Qty/Unit price +
 * the action-button cluster + gaps/padding) exceeds the available
 * container width is the EXPECTED, approved fallback — only page-level
 * (`document.documentElement`) overflow is treated as a failure.
 */

let fixtures: TestFixtures;

async function actAs(context: BrowserContext, baseURL: string, user: { id: string; email: string }, orgId: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, user, baseURL);
  await context.addCookies([
    { name: "active_organization_id", value: orgId, domain: new URL(baseURL).hostname, path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
  ]);
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
}

// 10rem = 160px; a couple of px of browser sub-pixel rounding tolerance.
const DESCRIPTION_MIN_WIDTH = 160;
const WIDTH_TOLERANCE = 2;

async function descriptionWidth(page: Page, index = 0): Promise<number> {
  return page.locator(`#lineItems\\.${index}\\.description`).evaluate((el) => el.getBoundingClientRect().width);
}

test.describe("Desktop line-item compression fix — Recurring Invoice", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  for (const width of [900, 1280]) {
    test(`@ ${width}px: no page-level overflow, Description keeps its minimum, every control stays usable`, async ({ context, baseURL, page }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/recurring-invoices/new");

      const row1 = page.getByRole("group", { name: "Line item 1" });
      await row1.getByLabel("Description").fill("Monthly consulting retainer");
      await row1.getByLabel("Qty").fill("1");
      await row1.getByLabel("Unit price").fill("500.00");

      await expectNoPageOverflow(page);

      const width1 = await descriptionWidth(page);
      expect(width1).toBeGreaterThanOrEqual(DESCRIPTION_MIN_WIDTH - WIDTH_TOLERANCE);

      await expect(row1.getByLabel("Description")).toBeEditable();
      await expect(row1.getByLabel("Qty")).toBeEditable();
      await expect(row1.getByLabel("Unit price")).toBeEditable();
      await expect(page.getByRole("button", { name: "Remove line item 1" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Remove line item 1" })).toBeEnabled();

      // Currency and Advanced options remain reachable below the row.
      await expect(page.getByLabel("Currency")).toBeVisible();
      await expect(page.getByText("Advanced options (discount, tax, notes)")).toBeVisible();

      // No overlap: Qty/Unit price/action buttons never collide with
      // Description or each other — each occupies a disjoint horizontal
      // band within the row (same row, same baseline).
      const [descBox, qtyBox, priceBox, removeBox] = await Promise.all([
        row1.getByLabel("Description").boundingBox(),
        row1.getByLabel("Qty").boundingBox(),
        row1.getByLabel("Unit price").boundingBox(),
        page.getByRole("button", { name: "Remove line item 1" }).boundingBox(),
      ]);
      expect(descBox && qtyBox && descBox.x + descBox.width <= qtyBox.x + 1).toBe(true);
      expect(qtyBox && priceBox && qtyBox.x + qtyBox.width <= priceBox.x + 1).toBe(true);
      expect(priceBox && removeBox && priceBox.x + priceBox.width <= removeBox.x + 1).toBe(true);
    });
  }

  test("multi-row: a second row gets the same protected Description width, reorder/remove remain usable, no page-level overflow", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto("/recurring-invoices/new");

    const row1 = page.getByRole("group", { name: "Line item 1" });
    await row1.getByLabel("Description").fill("Consulting");
    await row1.getByLabel("Qty").fill("1");
    await row1.getByLabel("Unit price").fill("500.00");

    await page.getByRole("button", { name: "Add line" }).click();
    const row2 = page.getByRole("group", { name: "Line item 2" });
    await row2.getByLabel("Description").fill("Hosting and maintenance");
    await row2.getByLabel("Qty").fill("1");
    await row2.getByLabel("Unit price").fill("29.99");

    await expectNoPageOverflow(page);
    expect(await descriptionWidth(page, 0)).toBeGreaterThanOrEqual(DESCRIPTION_MIN_WIDTH - WIDTH_TOLERANCE);
    expect(await descriptionWidth(page, 1)).toBeGreaterThanOrEqual(DESCRIPTION_MIN_WIDTH - WIDTH_TOLERANCE);

    await expect(page.getByRole("button", { name: "Move line item 2 up" })).toBeVisible();
    await page.getByRole("button", { name: "Move line item 2 up" }).click();
    await expect(page.getByRole("group", { name: "Line item 1" }).getByLabel("Description")).toHaveValue("Hosting and maintenance");
    await expectNoPageOverflow(page);

    await page.getByRole("button", { name: "Remove line item 2" }).click();
    await expect(page.getByRole("group", { name: "Line item 2" })).toHaveCount(0);
    await expectNoPageOverflow(page);
  });

  test("~390px mobile: the stacked layout is unchanged — Description stays comfortable, no document overflow, no new local scroll is forced", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/recurring-invoices/new");

    const row1 = page.getByRole("group", { name: "Line item 1" });
    await row1.getByLabel("Description").fill("Monthly consulting retainer");
    await row1.getByLabel("Qty").fill("1");
    await row1.getByLabel("Unit price").fill("500.00");

    await expectNoPageOverflow(page);

    // Below `sm:`, grid-cols-1 stacks every field full-width — Description
    // gets far more than the 10rem floor, and the row's own content
    // never exceeds its own box (no local scrollbar needed at this width).
    const width = await descriptionWidth(page);
    expect(width).toBeGreaterThan(200);
    const rowOverflow = await page
      .locator('fieldset[aria-label="Line item 1"]')
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(rowOverflow).toBe(false);

    await expect(row1.getByLabel("Description")).toBeEditable();
    await expect(row1.getByLabel("Qty")).toBeEditable();
    await expect(row1.getByLabel("Unit price")).toBeEditable();
    await expect(page.getByRole("button", { name: "Remove line item 1" })).toBeVisible();
  });
});

test.describe("Desktop line-item compression fix — Invoice shared-consumer regression", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("@ 1280px (two-column live-preview layout): no page-level overflow, Description keeps its minimum, row and preview stay usable", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/invoices/new");
    await page.getByRole("radio", { name: "Itemized" }).check();

    const row1 = page.getByRole("group", { name: "Line item 1" });
    await row1.getByLabel("Description").fill("Monthly consulting retainer");
    await row1.getByLabel("Qty").fill("1");
    await row1.getByLabel("Unit price").fill("500.00");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);

    const width = await descriptionWidth(page);
    expect(width).toBeGreaterThanOrEqual(DESCRIPTION_MIN_WIDTH - WIDTH_TOLERANCE);

    await expect(row1.getByLabel("Qty")).toBeEditable();
    await expect(row1.getByLabel("Unit price")).toBeEditable();
    await expect(page.getByRole("button", { name: "Remove line item 1" })).toBeVisible();
    await expect(page.getByTestId("invoice-preview")).toBeVisible();
  });
});

test.describe("Desktop line-item compression fix — Quote shared-consumer regression", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("@ 1280px (two-column live-preview layout): no page-level overflow, Description keeps its minimum, row and preview stay usable, no overlap", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/quotes/new");
    await page.getByRole("radio", { name: "Client" }).check();

    const row1 = page.getByRole("group", { name: "Line item 1" });
    await row1.getByLabel("Description").fill("Monthly consulting retainer");
    await row1.getByLabel("Qty").fill("1");
    await row1.getByLabel("Unit price").fill("500.00");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);

    const width = await descriptionWidth(page);
    expect(width).toBeGreaterThanOrEqual(DESCRIPTION_MIN_WIDTH - WIDTH_TOLERANCE);

    await expect(row1.getByLabel("Qty")).toBeEditable();
    await expect(row1.getByLabel("Unit price")).toBeEditable();
    await expect(page.getByRole("button", { name: "Remove line item 1" })).toBeVisible();
    await expect(page.getByTestId("quote-preview")).toBeVisible();

    const [descBox, qtyBox, priceBox] = await Promise.all([
      row1.getByLabel("Description").boundingBox(),
      row1.getByLabel("Qty").boundingBox(),
      row1.getByLabel("Unit price").boundingBox(),
    ]);
    expect(descBox && qtyBox && descBox.x + descBox.width <= qtyBox.x + 1).toBe(true);
    expect(qtyBox && priceBox && qtyBox.x + qtyBox.width <= priceBox.x + 1).toBe(true);
  });
});
