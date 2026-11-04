import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Recurring Invoice line-item actions stay visible at every width.
 *
 * Regression for: from `sm:` (640px) up, the shared InvoiceLineItemRow's
 * four-track grid needs ~594px but Recurring's `max-w-xl` card leaves ~460px,
 * so the reorder/remove buttons sat outside the row's visible area and were
 * only reachable by scrolling inside it (the page itself never overflowed,
 * which is why page-overflow checks alone never caught it). Every assertion
 * below is made BEFORE anything scrolls the row: the row must not need an
 * inner horizontal scroll, and each action must lie inside the row's visible
 * rectangle and be the topmost element at its own centre.
 */

const WIDTHS = [320, 390, 640, 768, 1280];
const FIRST = { description: "Monthly managed hosting and priority support retainer", quantity: "12", unitPrice: "1234.56" };
const SECOND = { description: "Setup fee", quantity: "1", unitPrice: "250.00" };
const TOTAL_BOTH = "Total per invoice: $15,064.72"; // 12 x 1234.56 + 250
const TOTAL_FIRST_ONLY = "Total per invoice: $14,814.72";

let fixtures: TestFixtures;
const scheduleIds: string[] = [];

async function actAs(context: BrowserContext, baseURL: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, fixtures.owner, baseURL);
  await context.addCookies([
    { name: "active_organization_id", value: fixtures.orgA.id, domain: new URL(baseURL).hostname, path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
  ]);
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
}

function row(page: Page, n: number): Locator {
  return page.getByRole("group", { name: `Line item ${n}` });
}

/** Visible-without-scrolling check for one row: no inner scroll, every action inside the row box and topmost at its centre. */
async function expectActionsVisibleInRow(page: Page, n: number, enabled: { up: boolean; down: boolean }): Promise<void> {
  const r = row(page, n);
  const inner = await r.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollLeft: el.scrollLeft }));
  expect(inner.scrollLeft).toBe(0);
  expect(inner.scrollWidth).toBeLessThanOrEqual(inner.clientWidth + 1);

  const rowBox = (await r.boundingBox())!;
  const viewportWidth = page.viewportSize()!.width;
  const actions = [
    { name: `Move line item ${n} up`, enabled: enabled.up },
    { name: `Move line item ${n} down`, enabled: enabled.down },
    { name: `Remove line item ${n}`, enabled: true },
  ];
  for (const action of actions) {
    const button = r.getByRole("button", { name: action.name });
    await expect(button).toBeVisible();
    if (action.enabled) await expect(button).toBeEnabled();
    else await expect(button).toBeDisabled();
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(rowBox.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 0.5);
  }
  // Topmost-at-centre check, after the geometry checks above so it can never mask a clipped button.
  for (const action of actions) {
    const button = r.getByRole("button", { name: action.name });
    await button.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
    const hit = await button.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return top === el || el.contains(top);
    });
    expect(hit).toBe(true);
  }
}

async function exerciseActions(page: Page): Promise<void> {
  await expect(row(page, 1)).toBeVisible();
  await expect(row(page, 2)).toBeVisible();
  await expect(page.getByText(TOTAL_BOTH)).toBeVisible();
  await expectNoPageOverflow(page);

  await expectActionsVisibleInRow(page, 1, { up: false, down: true });
  await expectActionsVisibleInRow(page, 2, { up: true, down: false });
  await expect(row(page, 1).getByLabel("Description")).toBeEditable();
  await expect(row(page, 2).getByLabel("Unit price")).toBeEditable();

  // reorder: row 2 up, then row 1 down restores the order; the total never changes
  await row(page, 2).getByRole("button", { name: "Move line item 2 up" }).click();
  await expect(row(page, 1).getByLabel("Description")).toHaveValue(SECOND.description);
  await expect(page.getByText(TOTAL_BOTH)).toBeVisible();
  await row(page, 1).getByRole("button", { name: "Move line item 1 down" }).click();
  await expect(row(page, 1).getByLabel("Description")).toHaveValue(FIRST.description);
  await expectActionsVisibleInRow(page, 1, { up: false, down: true });

  // remove: row 2 goes away, the total follows the remaining line, the last action set is still visible
  await row(page, 2).getByRole("button", { name: "Remove line item 2" }).click();
  await expect(row(page, 2)).toHaveCount(0);
  await expect(page.getByText(TOTAL_FIRST_ONLY)).toBeVisible();
  await expectActionsVisibleInRow(page, 1, { up: false, down: false });
  await expectNoPageOverflow(page);
}

test.describe("Recurring Invoice line-item actions are visible without scrolling", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    if (scheduleIds.length > 0) {
      await dbQuery("recurringInvoice", "deleteMany", { where: { id: { in: scheduleIds } } });
    }
    await cleanupTestData(fixtures);
  });

  for (const width of WIDTHS) {
    test(`create @ ${width}px: two line items, actions inside each row, reorder/remove work, total stays right`, async ({ context, baseURL, page }) => {
      await actAs(context, baseURL!);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/recurring-invoices/new");

      await expect(row(page, 1)).toBeVisible();
      await row(page, 1).getByLabel("Description").fill(FIRST.description);
      await row(page, 1).getByLabel("Qty").fill(FIRST.quantity);
      await row(page, 1).getByLabel("Unit price").fill(FIRST.unitPrice);
      await page.getByRole("button", { name: "Add line" }).click();
      await expect(row(page, 2)).toBeVisible();
      await row(page, 2).getByLabel("Description").fill(SECOND.description);
      await row(page, 2).getByLabel("Qty").fill(SECOND.quantity);
      await row(page, 2).getByLabel("Unit price").fill(SECOND.unitPrice);

      await exerciseActions(page);
    });

    test(`edit @ ${width}px: two persisted line items, actions inside each row, reorder/remove work, total stays right`, async ({ context, baseURL, page }) => {
      await actAs(context, baseURL!);
      const schedule = await dbQuery<{ id: string }>("recurringInvoice", "create", {
        data: {
          name: `Line-item actions edit ${width}`,
          organizationId: fixtures.orgA.id,
          clientId: fixtures.clientA.id,
          frequency: "MONTHLY",
          anchorDay: 1,
          nextIssueDate: new Date(),
          invoiceNumberPrefix: `LIA-${width}-${Date.now()}-`,
          nextSequence: 1,
          currency: "USD",
          status: "ACTIVE",
          lineItems: {
            create: [
              { ...FIRST, position: 0 },
              { ...SECOND, position: 1 },
            ],
          },
        },
      });
      scheduleIds.push(schedule.id);

      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/recurring-invoices/${schedule.id}/edit`);
      await expect(row(page, 1).getByLabel("Description")).toHaveValue(FIRST.description);
      await expect(row(page, 2).getByLabel("Description")).toHaveValue(SECOND.description);

      await exerciseActions(page);
    });
  }
});
