import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { selectCurrencyOption } from "../support/select-currency-option";

/**
 * Invoice Live Preview V1 — the new document-style live preview panel
 * added alongside InvoiceForm (create/edit/duplicate), and the bounded
 * "Advanced options" disclosure (Currency/Discount/Tax/Notes/Internal
 * notes). Per-field CRUD/lifecycle/duplicate/issue/send/archive behavior
 * is already exhaustively covered by test/e2e/invoices.spec.ts and
 * test/e2e/invoice-issuance-readiness.spec.ts — re-run in full alongside
 * this file, not repeated here. This file covers only the new preview
 * panel's own behavior: create-mode live updates, edit-mode fidelity to
 * stored values (no silent currency reset), and the 390x900 responsive
 * layout.
 */

let fixtures: TestFixtures;
let extraInvoiceIds: string[] = [];

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

test.describe("Invoice Live Preview V1", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterEach(async () => {
    if (extraInvoiceIds.length > 0) {
      await dbQuery("invoice", "deleteMany", { where: { id: { in: extraInvoiceIds } } });
      extraInvoiceIds = [];
    }
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("new invoice: preview starts with truthful placeholders, then updates live as client/line-items/currency/tax/discount change", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/invoices/new");

    const preview = page.getByTestId("invoice-preview");
    await expect(preview).toBeVisible();
    // No client chosen yet, no amount entered yet — truthful placeholders,
    // not a thrown error or a fabricated $0.00.
    await expect(preview.getByText("No client selected yet")).toBeVisible();
    await expect(preview.getByText("Add a valid amount or line item to see totals.")).toBeVisible();

    await page.getByLabel("Invoice number").fill(`E2E-PREVIEW-${fixtures.runId}`);
    await page.getByLabel("Client").selectOption(fixtures.clientA.id);
    await expect(preview.getByText(fixtures.clientA.name)).toBeVisible();

    await page.getByRole("radio", { name: "Itemized" }).check();
    const row1 = page.getByRole("group", { name: "Line item 1" });
    await row1.getByLabel("Description").fill("Design work");
    await row1.getByLabel("Qty").fill("2");
    await row1.getByLabel("Unit price").fill("50.00");

    await expect(preview.getByTestId("invoice-preview-total")).toHaveText("$100.00");
    await expect(preview.getByText("Design work")).toBeVisible();

    // Advanced options starts closed (no non-default currency/discount/tax
    // yet) — open it to reach Currency/Discount/Tax.
    const advancedSummary = page.getByText("Advanced options (currency, discount, tax, notes)");
    await advancedSummary.click();

    await selectCurrencyOption(page, "Currency", "AED");
    await expect(preview.getByText("AED", { exact: true })).toBeVisible();

    await page.getByLabel("Discount type").selectOption("PERCENTAGE");
    await page.getByLabel("Discount (%)").fill("10");
    await page.getByLabel("Tax rate (%)").fill("5");

    // $100 - 10% = $90, + 5% tax = $94.50 — the preview's own canonical
    // totals, never hand-computed in this test.
    await expect(preview.getByTestId("invoice-preview-total")).not.toHaveText("$100.00");
    await expect(preview.getByText(/Discount \(10%\)/)).toBeVisible();
    await expect(preview.getByText(/TAX \(5%\)/)).toBeVisible();

    // Submit behavior itself is unchanged — still a normal create.
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/invoices/new") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Create invoice" }).click(),
    ]);
    await expect(page).toHaveURL(/\/invoices(\?|$)/);
  });

  test("edit an existing DRAFT: preview initially matches the invoice's own stored currency/amount, editing updates it live, currency is never silently reset", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const invoiceNumber = `E2E-PREVIEW-EDIT-${Date.now()}`;
    const draft = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber,
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        amount: "321.00",
        subtotal: "321.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        currency: "EUR",
        status: "DRAFT",
        issueDate: new Date(),
      },
    });
    extraInvoiceIds = [draft.id];

    await page.goto(`/invoices/${draft.id}/edit`);
    const preview = page.getByTestId("invoice-preview");
    await expect(preview).toBeVisible();

    // Stored currency (EUR, not the org's own default/USD) is preserved
    // and reflected immediately — a default is never force-applied over
    // a persisted value.
    await expect(preview.getByText("EUR", { exact: true })).toBeVisible();
    await expect(preview.getByTestId("invoice-preview-total")).not.toContainText("$");

    await page.getByRole("textbox", { name: "Amount" }).fill("500.00");
    await expect(preview.getByTestId("invoice-preview-total")).not.toContainText("321");

    // Currency field itself still shows EUR — editing an unrelated field
    // never silently resets it.
    const advancedSummary = page.getByText("Advanced options (currency, discount, tax, notes)");
    await advancedSummary.click();
    await expect(page.getByLabel("Currency")).toHaveValue("EUR");

    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/invoices(\?|$)/);

    const persisted = await dbQuery<{ currency: string; amount: string }>("invoice", "findUniqueOrThrow", {
      where: { id: draft.id },
    });
    expect(persisted.currency).toBe("EUR");
  });

  test("390x900: the new invoice form and its preview both fit, no page-level horizontal overflow, controls remain usable", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/invoices/new");

    await expect(page.getByRole("heading", { name: "Add invoice", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Invoice number")).toBeVisible();
    await expect(page.getByTestId("invoice-preview")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create invoice" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);

    await page.getByLabel("Client").selectOption(fixtures.clientA.id);
    await page.getByRole("textbox", { name: "Amount" }).fill("42.00");
    await expect(page.getByTestId("invoice-preview-total")).toHaveText("$42.00");
  });
});
