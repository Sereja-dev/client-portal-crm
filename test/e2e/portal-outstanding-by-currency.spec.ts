import { test, expect, type Locator, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Client Portal home: the "Outstanding amount" card shows each currency's open
 * total with its currency code, never a combined figure and never an implied
 * USD. State is created for the fixture Portal user's own Client; noise rows
 * (other client, other organization, DRAFT/PAID/CANCELLED) must not show up.
 */

let fixtures: TestFixtures;
let counter = 0;
const extraClientIds: string[] = [];

async function createInvoice(clientId: string, organizationId: string, amount: string, currency: string, status: string): Promise<void> {
  counter += 1;
  await dbQuery("invoice", "create", {
    data: {
      invoiceNumber: `POC-${Date.now()}-${counter}`,
      clientId,
      organizationId,
      amount,
      currency,
      status,
      issueDate: new Date().toISOString(),
      ...(status === "PAID" ? { paidAt: new Date().toISOString() } : {}),
    },
  });
}

async function resetOwnInvoices(): Promise<void> {
  await dbQuery("invoice", "deleteMany", { where: { clientId: fixtures.clientA.id } });
}

function outstandingCard(page: Page): Locator {
  return page.getByRole("link", { name: /Outstanding amount/ });
}

async function openOverview(page: Page): Promise<void> {
  await page.goto("/portal");
  await expect(outstandingCard(page)).toBeVisible();
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
}

test.describe("Portal outstanding amount is shown per currency", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL!);
    await resetOwnInvoices();
  });

  test.afterAll(async () => {
    await resetOwnInvoices();
    if (extraClientIds.length > 0) {
      await dbQuery("invoice", "deleteMany", { where: { clientId: { in: extraClientIds } } });
      await dbQuery("client", "deleteMany", { where: { id: { in: extraClientIds } } });
    }
    await cleanupTestData(fixtures);
  });

  test("no open invoices: 'No open invoices', with no currency implied", async ({ page }) => {
    await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "50.00", "USD", "PAID");
    await openOverview(page);

    await expect(outstandingCard(page)).toContainText("No open invoices");
    const text = await outstandingCard(page).innerText();
    expect(text).not.toMatch(/\$|USD|EUR/);
    await expect(page.getByRole("link", { name: /Open invoices/ })).toContainText("0");
  });

  test("one non-USD currency: EUR 10.10 + EUR 20.20 shows EUR 30.30, never USD or a dollar sign", async ({ page }) => {
    await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "10.10", "EUR", "SENT");
    await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "20.20", "EUR", "OVERDUE");
    await openOverview(page);

    await expect(outstandingCard(page)).toContainText(/EUR\s30\.30/);
    const text = await outstandingCard(page).innerText();
    expect(text).not.toMatch(/\$|USD/);
    await expect(page.getByRole("link", { name: /Open invoices/ })).toContainText("2");
  });

  test("multiple currencies stay separate and ordered; other clients, other organizations and non-open statuses never count", async ({ page }) => {
    await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "100.10", "USD", "SENT");
    await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "10.10", "EUR", "SENT");
    await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "20.20", "EUR", "OVERDUE");
    // noise that must not show
    await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "999.00", "GBP", "DRAFT");
    await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "888.00", "GBP", "PAID");
    await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "777.00", "GBP", "CANCELLED");
    const other = await dbQuery<{ id: string }>("client", "create", { data: { name: "POC other client", organizationId: fixtures.orgA.id, userId: fixtures.owner.id } });
    extraClientIds.push(other.id);
    await createInvoice(other.id, fixtures.orgA.id, "4000.00", "USD", "SENT");
    await createInvoice(fixtures.clientB.id, fixtures.orgB.id, "5000.00", "USD", "SENT");
    await openOverview(page);

    const card = outstandingCard(page);
    await expect(card).toContainText(/EUR\s30\.30/);
    await expect(card).toContainText(/USD\s100\.10/);
    const text = (await card.innerText()).replace(/\s+/g, " ");
    expect(text.indexOf("EUR")).toBeLessThan(text.indexOf("USD"));
    expect(text).not.toMatch(/130\.40|GBP|4,000|5,000/);
    await expect(page.getByRole("link", { name: /Open invoices/ })).toContainText("3");
  });

  test("currencies that share a symbol are told apart by code (AUD, CAD, USD)", async ({ page }) => {
    await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "10.00", "USD", "SENT");
    await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "10.00", "CAD", "SENT");
    await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "10.00", "AUD", "SENT");
    await openOverview(page);

    const text = (await outstandingCard(page).innerText()).replace(/\s+/g, " ");
    expect(text).toMatch(/AUD\s10\.00.*CAD\s10\.00.*USD\s10\.00/);
  });

  for (const width of [320, 390]) {
    test(`${width}px: several currencies stay readable inside the card with no page-level horizontal overflow`, async ({ page }) => {
      await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "1234567.89", "USD", "SENT");
      await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "2345678.90", "EUR", "SENT");
      await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "345678.91", "GBP", "OVERDUE");
      await page.setViewportSize({ width, height: 900 });
      await openOverview(page);

      const card = outstandingCard(page);
      await expect(card).toContainText(/EUR\s2,345,678\.90/);
      await expect(card).toContainText(/GBP\s345,678\.91/);
      await expect(card).toContainText(/USD\s1,234,567\.89/);
      await expectNoPageOverflow(page);
      const fit = await card.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, right: el.getBoundingClientRect().right, viewport: document.documentElement.clientWidth }));
      expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth + 1);
      expect(fit.right).toBeLessThanOrEqual(fit.viewport + 0.5);
    });
  }
});
