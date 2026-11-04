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

async function createInvoice(clientId: string, organizationId: string, amount: string, currency: string, status: string, invoiceNumber?: string): Promise<void> {
  counter += 1;
  await dbQuery("invoice", "create", {
    data: {
      invoiceNumber: invoiceNumber ?? `POC-${Date.now()}-${counter}`,
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

type OverflowReport = {
  viewport: number;
  clientWidth: number;
  scrollWidth: number;
  documentOverflow: boolean;
  /** Elements whose right edge passes the viewport and that are not inside a horizontal scroller (for example the Portal nav strip). */
  offenders: { tag: string; className: string; testId: string | null; right: number; width: number; container: { tag: string; right: number } | null }[];
};

async function measureOverflow(page: Page): Promise<OverflowReport> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const inScroller = (el: Element) => {
      for (let node = el.parentElement; node && node !== doc; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden") return true;
      }
      return false;
    };
    const offenders = Array.from(document.body.querySelectorAll("*"))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.right > doc.clientWidth + 0.5 && !inScroller(el);
      })
      .slice(0, 6)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const parent = el.parentElement;
        return {
          tag: el.tagName.toLowerCase(),
          className: (el.getAttribute("class") ?? "").slice(0, 80),
          testId: el.getAttribute("data-testid"),
          right: Math.round(rect.right * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
          container: parent ? { tag: parent.tagName.toLowerCase(), right: Math.round(parent.getBoundingClientRect().right * 10) / 10 } : null,
        };
      });
    return {
      viewport: window.innerWidth,
      clientWidth: doc.clientWidth,
      scrollWidth: doc.scrollWidth,
      documentOverflow: doc.scrollWidth > doc.clientWidth + 1,
      offenders,
    };
  });
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const report = await measureOverflow(page);
  // The message names the offending elements so a CI failure explains itself.
  expect(report.documentOverflow, `document-level horizontal overflow: ${JSON.stringify(report)}`).toBe(false);
}

/**
 * Every Recent invoices row (invoice number, amount, status) must stay inside
 * the card's own content box. Measured on the content elements themselves, not
 * the row wrapper, and only after the rows have rendered.
 */
async function expectRecentInvoicesInsideCard(page: Page, expected: { number: string; amount: RegExp; status: string }[]): Promise<void> {
  const heading = page.getByRole("heading", { name: "Recent invoices" });
  await expect(heading).toBeVisible();
  const card = page.locator("section").filter({ has: heading });
  const rows = card.getByRole("listitem");
  await expect(rows).toHaveCount(expected.length);
  for (const [index, want] of expected.entries()) {
    const row = rows.nth(index);
    await expect(row.getByRole("link", { name: want.number, exact: true })).toBeVisible();
    await expect(row).toContainText(want.amount);
    await expect(row).toContainText(want.status);
  }
  const report = await card.evaluate((section) => {
    const style = getComputedStyle(section);
    const box = section.getBoundingClientRect();
    const contentLeft = box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    const contentRight = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    const round = (value: number) => Math.round(value * 10) / 10;
    const outside: { part: string; row: number; left: number; right: number; contentLeft: number; contentRight: number }[] = [];
    section.querySelectorAll("li").forEach((li, row) => {
      const link = li.querySelector("a");
      const amount = li.querySelector("div > span:first-child");
      const status = li.querySelector("div > span:last-child");
      for (const [part, element] of [["invoice number", link], ["amount", amount], ["status", status]] as const) {
        if (!element) {
          outside.push({ part: `${part} (missing)`, row, left: 0, right: 0, contentLeft: round(contentLeft), contentRight: round(contentRight) });
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.left < contentLeft - 0.5 || rect.right > contentRight + 0.5) {
          outside.push({ part, row, left: round(rect.left), right: round(rect.right), contentLeft: round(contentLeft), contentRight: round(contentRight) });
        }
      }
    });
    return { outside, viewport: window.innerWidth };
  });
  expect(report.outside, `Recent invoices content extends past its card: ${JSON.stringify(report)}`).toEqual([]);
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

  for (const width of [320, 390, 1280]) {
    test(`${width}px: several currencies stay readable, and the card and Recent invoices stay inside their boundaries with no page-level horizontal overflow`, async ({ page }) => {
      // Long, unbroken invoice numbers (POC-<13-digit timestamp>-n) with 6-7 digit amounts are the
      // worst case for the Recent invoices rows; they must stay inside their card.
      const stamp = Date.now();
      await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "1234567.89", "USD", "SENT", `POC-${stamp}-1`);
      await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "2345678.90", "EUR", "SENT", `POC-${stamp}-2`);
      await createInvoice(fixtures.clientA.id, fixtures.orgA.id, "345678.91", "GBP", "OVERDUE", `POC-${stamp}-3`);
      await page.setViewportSize({ width, height: 900 });
      await openOverview(page);

      const card = outstandingCard(page);
      await expect(card).toContainText(/EUR\s2,345,678\.90/);
      await expect(card).toContainText(/GBP\s345,678\.91/);
      await expect(card).toContainText(/USD\s1,234,567\.89/);
      await expectRecentInvoicesInsideCard(page, [
        { number: `POC-${stamp}-3`, amount: /£345,678\.91/, status: "Overdue" },
        { number: `POC-${stamp}-2`, amount: /€2,345,678\.90/, status: "Sent" },
        { number: `POC-${stamp}-1`, amount: /\$1,234,567\.89/, status: "Sent" },
      ]);
      await expectNoPageOverflow(page);
      const fit = await card.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, right: el.getBoundingClientRect().right, viewport: document.documentElement.clientWidth }));
      expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth + 1);
      expect(fit.right).toBeLessThanOrEqual(fit.viewport + 0.5);
    });
  }
});
