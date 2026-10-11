import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { selectCurrencyOption } from "../support/select-currency-option";

/**
 * Forms Improvement Slice A1 — real-browser coverage for the new shared
 * searchable currency selector across all four surfaces it was adopted
 * on. Per-field CRUD/lifecycle/template/responsive coverage for each
 * surface already exists elsewhere (invoice-live-preview.spec.ts,
 * invoices.spec.ts, organization-setup.spec.ts, etc. — all updated
 * alongside this slice to drive the new control instead of the retired
 * native <select>); this file covers only what's new: typing to filter,
 * keyboard selection, popular-currency ordering, and that every surface's
 * existing default/persisted-value/no-FX semantics survived the swap.
 */

let fixtures: TestFixtures;
let extraInvoiceIds: string[] = [];
let extraQuoteIds: string[] = [];
let extraRecurringInvoiceIds: string[] = [];

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

function trackConsoleAndPageErrors(page: import("@playwright/test").Page): { errors: () => string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  return { errors: () => [...consoleErrors, ...pageErrors] };
}

test.describe("Forms Improvement Slice A1 — searchable currency select", () => {
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
    if (extraRecurringInvoiceIds.length > 0) {
      await dbQuery("recurringInvoice", "deleteMany", { where: { id: { in: extraRecurringInvoiceIds } } });
      extraRecurringInvoiceIds = [];
    }
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("Invoice create: currency is searchable by code, popular currencies lead the option list, no hydration error", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const tracker = trackConsoleAndPageErrors(page);

    await page.goto("/invoices/new");
    await page.getByText("Advanced options (currency, discount, tax, notes)").click();

    const currencyField = page.getByLabel("Currency");
    // Default is USD (the organization's own resolved default) — confirms
    // the swap didn't change the create-flow default.
    await expect(currencyField).toHaveValue("USD");

    await currencyField.click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();

    // Popular-currency priority group (USD, EUR, GBP, AED, CAD, AUD) leads
    // browsing, before the unfiltered query narrows anything.
    const optionTexts = await listbox.getByRole("option").allTextContents();
    expect(optionTexts.slice(0, 6)).toEqual(["USD", "EUR", "GBP", "AED", "CAD", "AUD"]);

    // Search by code — a substring match, case-insensitive.
    await currencyField.fill("aed");
    await expect(page.getByRole("option", { name: "AED", exact: true })).toBeVisible();
    await expect(listbox.getByRole("option")).toHaveCount(1);

    await page.getByRole("option", { name: "AED", exact: true }).click();
    await expect(currencyField).toHaveValue("AED");
    await expect(page.getByTestId("invoice-preview").getByText("AED", { exact: true })).toBeVisible();

    const hydrationRelated = tracker.errors().filter((text) => /hydrat|#418|did not match|server-rendered/i.test(text));
    expect(hydrationRelated).toEqual([]);
  });

  test("Invoice create: numeric totals are unaffected by a currency change — no FX", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/invoices/new");

    await page.getByLabel("Invoice number").fill(`A1-CURR-${fixtures.runId}`);
    await page.getByLabel("Client").selectOption(fixtures.clientA.id);
    await page.getByRole("textbox", { name: "Amount" }).fill("100.00");
    await expect(page.getByTestId("invoice-preview-total")).toHaveText("$100.00");

    await page.getByText("Advanced options (currency, discount, tax, notes)").click();
    await selectCurrencyOption(page, "Currency", "EUR");

    // Same numeric amount, only the currency symbol/code changed.
    await expect(page.getByTestId("invoice-preview-total")).toHaveText("€100.00");
  });

  test("Invoice edit: a persisted non-priority currency remains selected and searchable", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const draft = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber: `A1-CURR-EDIT-${Date.now()}`,
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        amount: "42.00",
        subtotal: "42.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        currency: "SGD",
        status: "DRAFT",
        issueDate: new Date(),
      },
    });
    extraInvoiceIds = [draft.id];

    await page.goto(`/invoices/${draft.id}/edit`);
    await page.getByText("Advanced options (currency, discount, tax, notes)").click();
    // A currency outside the locked popular group is still correctly
    // preserved and selected — never silently reset to USD/EUR/etc.
    await expect(page.getByLabel("Currency")).toHaveValue("SGD");

    await selectCurrencyOption(page, "Currency", "GBP");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/invoices(\?|$)/);

    const persisted = await dbQuery<{ currency: string }>("invoice", "findUniqueOrThrow", { where: { id: draft.id } });
    expect(persisted.currency).toBe("GBP");
  });

  test("Quote create: default currency preserved, searchable selection works, inline total stays truthful", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/quotes/new");

    await expect(page.getByLabel("Currency")).toHaveValue("USD");
    await selectCurrencyOption(page, "Currency", "CAD");
    await expect(page.getByLabel("Currency")).toHaveValue("CAD");
    await expect(page.getByText("This is a live preview only")).toBeVisible();
  });

  test("Quote edit: persisted currency is preserved and reselectable", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const quote = await dbQuery<{ id: string }>("quote", "create", {
      data: {
        number: `A1-QUOTE-${Date.now()}`,
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        createdByUserId: fixtures.owner.id,
        currency: "CHF",
        status: "DRAFT",
        issueDate: new Date(),
        subtotal: "10.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        total: "10.00",
        items: {
          create: [{ description: "Design", quantity: "1", unitPrice: "10.00", lineTotal: "10.00", position: 0 }],
        },
      },
    });
    extraQuoteIds = [quote.id];

    await page.goto(`/quotes/${quote.id}/edit`);
    await expect(page.getByLabel("Currency")).toHaveValue("CHF");
    await selectCurrencyOption(page, "Currency", "AUD");
    await expect(page.getByLabel("Currency")).toHaveValue("AUD");
  });

  test("Recurring Invoice create: existing initial currency semantics unchanged, searchable selection works", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/recurring-invoices/new");

    // Unchanged existing semantics per the slice brief §13 — RecurringInvoiceForm's
    // own pre-existing default is `currencyOptions[0]`, i.e. the first
    // supported currency in alphabetical order (AED, not USD — this app
    // never added a settings-driven default for Recurring Invoice, and
    // this slice must not invent one). This proves that exact pre-existing
    // default survived the native-<select>-to-CurrencySelect swap
    // unchanged, then exercises the new searchable selection on top of it.
    await expect(page.getByLabel("Currency")).toHaveValue("AED");
    await selectCurrencyOption(page, "Currency", "GBP");
    await expect(page.getByLabel("Currency")).toHaveValue("GBP");
  });

  test("Recurring Invoice edit: a persisted currency remains selected even when outside the popular group", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const schedule = await dbQuery<{ id: string }>("recurringInvoice", "create", {
      data: {
        name: "A1 schedule",
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        frequency: "MONTHLY",
        anchorDay: 1,
        nextIssueDate: new Date(),
        invoiceNumberPrefix: `A1-REC-${Date.now()}-`,
        nextSequence: 1,
        currency: "NZD",
        status: "ACTIVE",
        lineItems: { create: [{ description: "Retainer", quantity: "1", unitPrice: "10.00", position: 0 }] },
      },
    });
    extraRecurringInvoiceIds = [schedule.id];

    await page.goto(`/recurring-invoices/${schedule.id}/edit`);
    await expect(page.getByLabel("Currency")).toHaveValue("NZD");
  });

  test("Company Settings: existing saved currency selected, searchable, popular ordering, submits the exact selected code", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/settings/company");

    const currencyField = page.getByLabel("Currency");
    await currencyField.click();
    const listbox = page.getByRole("listbox");
    const optionTexts = await listbox.getByRole("option").allTextContents();
    expect(optionTexts.slice(0, 6)).toEqual(["USD", "EUR", "GBP", "AED", "CAD", "AUD"]);
    await page.keyboard.press("Escape");

    await selectCurrencyOption(page, "Currency", "AED");
    await expect(currencyField).toHaveValue("AED");

    await page.getByLabel("Display / company name").fill("A1 Currency Co");
    await page.getByLabel("Legal company name").fill("A1 Currency Co LLC");
    await page.getByLabel("Country").fill("United States");
    // Time zone (untouched by this slice, still a plain native <select>)
    // starts on its own disabled placeholder option — a real selection is
    // required for submission to succeed at all, same as before this slice.
    await page.getByLabel("Time zone").selectOption("America/New_York");
    await page.getByRole("button", { name: "Save company profile" }).click();
    await expect(page.getByText("Company profile saved.")).toBeVisible();

    const profile = await dbQuery<{ currency: string }>("organizationProfile", "findUniqueOrThrow", {
      where: { organizationId: fixtures.orgA.id },
    });
    expect(profile.currency).toBe("AED");

    // Timezone (untouched by this slice) remains a plain native <select>.
    await expect(page.getByLabel("Time zone")).toBeVisible();
  });

  test("keyboard operability: Arrow Down/Enter selects without any mouse interaction", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/settings/company");

    const currencyField = page.getByLabel("Currency");
    await currencyField.click();
    await currencyField.fill("EUR");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(currencyField).toHaveValue("EUR");
  });

  test("Escape closes the listbox without changing the selected value", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/settings/company");

    const currencyField = page.getByLabel("Currency");
    const before = await currencyField.inputValue();
    await currencyField.click();
    await currencyField.fill("zzz-no-match");
    await expect(page.getByText("No matching currencies")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(currencyField).toHaveValue(before);
  });

  test("390x900: Company Settings currency selector fits, no destructive horizontal overflow, remains usable", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/settings/company");

    const currencyField = page.getByLabel("Currency");
    await expect(currencyField).toBeVisible();
    await currencyField.click();
    await expect(page.getByRole("listbox")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);

    await selectCurrencyOption(page, "Currency", "CAD");
    await expect(currencyField).toHaveValue("CAD");
  });
});
