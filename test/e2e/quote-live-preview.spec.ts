import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { selectSearchableOption } from "../support/select-searchable-option";
import { selectCurrencyOption } from "../support/select-currency-option";

/**
 * Forms Improvement Slice B2 — the new document-style live preview panel
 * added alongside QuoteForm (create/edit/duplicate/SENT-live-editing).
 * Per-field CRUD/lifecycle/duplicate/convert/archive behavior is already
 * exhaustively covered by test/e2e/quotes.spec.ts and
 * test/e2e/quote-client-target-selector.spec.ts — re-run in full
 * alongside this file, not repeated here. This file covers only the new
 * preview panel's own behavior: create-mode live updates across both
 * target branches, edit-mode fidelity to stored values, SENT-live
 * gating, and the 390x900 responsive layout. Mirrors
 * invoice-live-preview.spec.ts's own structure exactly, adapted to
 * Quote's own data model (Lead/Client dual target, no Project, Valid
 * until instead of Due date, no internal notes).
 */

let fixtures: TestFixtures;
let extraQuoteIds: string[] = [];
let extraLeadIds: string[] = [];

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

test.describe("Quote Live Preview (Forms Improvement Slice B2)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterEach(async () => {
    if (extraQuoteIds.length > 0) {
      await dbQuery("quote", "deleteMany", { where: { id: { in: extraQuoteIds } } });
      extraQuoteIds = [];
    }
    if (extraLeadIds.length > 0) {
      await dbQuery("lead", "deleteMany", { where: { id: { in: extraLeadIds } } });
      extraLeadIds = [];
    }
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("new quote: preview starts with truthful placeholders, then updates live for both the Lead and the Client target branch, number/title/dates/line-items/currency/discount/tax/notes", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const lead = await dbQuery<{ id: string; name: string }>("lead", "create", {
      data: { name: `E2E Preview Lead ${fixtures.runId}`, organizationId: fixtures.orgA.id },
    });
    extraLeadIds.push(lead.id);

    await page.goto("/quotes/new");

    const preview = page.getByTestId("quote-preview");
    await expect(preview).toBeVisible();
    // No target type chosen yet, no line items yet — truthful
    // placeholders, never a thrown error or a fabricated $0.00.
    await expect(preview.getByText("No lead or client selected yet")).toBeVisible();
    await expect(preview.getByText("Add a valid amount or line item to see totals.")).toBeVisible();

    const number = `E2E-PREVIEW-${fixtures.runId}`;
    await page.getByLabel("Quote number").fill(number);
    await expect(preview.getByText(number)).toBeVisible();

    await page.getByLabel("Title").fill("Website redesign");
    await expect(preview.getByText("Website redesign")).toBeVisible();

    // Lead branch.
    await page.getByRole("radio", { name: "Lead" }).check();
    await expect(preview.getByText("No lead selected yet")).toBeVisible();
    await page.getByLabel("Select lead").selectOption({ label: lead.name });
    await expect(preview.getByText(lead.name)).toBeVisible();
    await expect(preview.getByText("Lead", { exact: true })).toBeVisible();

    await page.getByLabel("Issue date").fill("2026-06-01");
    await page.getByLabel("Valid until").fill("2026-07-01");

    const row1 = page.getByRole("group", { name: "Line item 1" });
    await row1.getByLabel("Description").fill("Design work");
    await row1.getByLabel("Qty").fill("2");
    await row1.getByLabel("Unit price").fill("50.00");
    await expect(preview.getByTestId("quote-preview-total")).toHaveText("$100.00");
    await expect(preview.getByText("Design work")).toBeVisible();

    // Switching the target type clears the Lead side (QuoteForm's own
    // existing mutual-exclusivity behavior, unchanged) — the preview
    // must follow, never keep showing the stale Lead name.
    await page.getByRole("radio", { name: "Client" }).check();
    await expect(preview.getByText("No client selected yet")).toBeVisible();
    await expect(preview.getByText(lead.name)).not.toBeVisible();
    await selectSearchableOption(page, "Select client", fixtures.clientA.name, fixtures.clientA.name);
    await expect(preview.getByText(fixtures.clientA.name)).toBeVisible();
    await expect(preview.getByText("Client", { exact: true })).toBeVisible();

    await selectCurrencyOption(page, "Currency", "AED");
    await expect(preview.getByText("AED", { exact: true })).toBeVisible();

    await page.getByLabel("Discount type").selectOption("PERCENTAGE");
    await page.getByLabel("Discount (%)").fill("10");
    await page.getByLabel("Tax rate (%)").fill("5");

    // $100 - 10% = $90, + 5% tax = $94.50 — the preview's own canonical
    // totals, never hand-computed in this test.
    await expect(preview.getByTestId("quote-preview-total")).not.toHaveText("$100.00");
    await expect(preview.getByText(/Discount \(10%\)/)).toBeVisible();
    await expect(preview.getByText(/TAX \(5%\)/)).toBeVisible();

    await page.getByLabel("Notes").fill("Thanks for considering us.");
    await expect(preview.getByText("Thanks for considering us.")).toBeVisible();

    // Submit behavior itself is unchanged — still a normal create.
    await page.getByRole("button", { name: "Create quote" }).click();
    await expect(page).toHaveURL(/\/quotes(\?|$)/);
    extraQuoteIds.push((await dbQuery<{ id: string }>("quote", "findFirstOrThrow", { where: { number } })).id);
  });

  test("edit an existing DRAFT: preview initially matches the quote's own stored currency/target/total, editing updates it live", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const number = `E2E-PREVIEW-EDIT-${Date.now()}`;
    const draft = await dbQuery<{ id: string }>("quote", "create", {
      data: {
        number,
        status: "DRAFT",
        organizationId: fixtures.orgA.id,
        createdByUserId: fixtures.owner.id,
        clientId: fixtures.clientA.id,
        currency: "EUR",
        subtotal: "321.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        total: "321.00",
        items: { create: [{ description: "Seeded item", quantity: "1", unitPrice: "321.00", lineTotal: "321.00", position: 0 }] },
      },
    });
    extraQuoteIds.push(draft.id);

    await page.goto(`/quotes/${draft.id}/edit`);
    const preview = page.getByTestId("quote-preview");
    await expect(preview).toBeVisible();

    // Stored target/currency/total are reflected immediately, before any
    // edit — never a blank/first-option flash.
    await expect(preview.getByText(fixtures.clientA.name)).toBeVisible();
    await expect(preview.getByText("EUR", { exact: true })).toBeVisible();
    await expect(preview.getByTestId("quote-preview-total")).not.toContainText("$");

    const row1 = page.getByRole("group", { name: "Line item 1" });
    await row1.getByLabel("Unit price").fill("500.00");
    await expect(preview.getByTestId("quote-preview-total")).not.toContainText("321");

    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/quotes(\?|$)/);

    const persisted = await dbQuery<{ currency: string; total: string }>("quote", "findUniqueOrThrow", {
      where: { id: draft.id },
    });
    expect(persisted.currency).toBe("EUR");
  });

  test("SENT-live: preview is absent before edit confirmation, appears after confirming Edit quote, and shows the unsaved pending values", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const number = `E2E-PREVIEW-SENT-${Date.now()}`;
    const quote = await dbQuery<{ id: string }>("quote", "create", {
      data: {
        number,
        status: "SENT",
        sentAt: new Date().toISOString(),
        validUntil: "2099-01-01T00:00:00.000Z",
        organizationId: fixtures.orgA.id,
        createdByUserId: fixtures.owner.id,
        clientId: fixtures.clientA.id,
        subtotal: "10.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        total: "10.00",
        items: { create: [{ description: "Seeded item", quantity: "1", unitPrice: "10.00", lineTotal: "10.00", position: 0 }] },
      },
    });
    extraQuoteIds.push(quote.id);

    await page.goto(`/quotes/${quote.id}/edit`);

    // Before confirmation: the existing read-only SENT presentation — no
    // live preview panel at all, QuoteForm itself isn't rendered yet.
    await expect(page.getByRole("heading", { name: number })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit quote" })).toBeVisible();
    await expect(page.getByTestId("quote-preview")).toHaveCount(0);

    await page.getByRole("button", { name: "Edit quote" }).click();
    await expect(page.getByText(/saving changes will move it back to draft/i)).toBeVisible();
    await page.getByRole("button", { name: "Edit anyway" }).click();

    // After confirmation: QuoteForm now renders, and the live preview
    // appears automatically with it — no special-case wiring needed, and
    // it shows the current (still-unsaved) pending values.
    const preview = page.getByTestId("quote-preview");
    await expect(preview).toBeVisible();
    await expect(preview.getByText(fixtures.clientA.name)).toBeVisible();

    const row1 = page.getByRole("group", { name: "Line item 1" });
    await row1.getByLabel("Unit price").fill("25.00");
    await expect(preview.getByTestId("quote-preview-total")).toHaveText("$25.00");
  });

  test("390x900: the new quote form and its preview both fit, no page-level horizontal overflow, controls remain usable", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/quotes/new");

    await expect(page.getByRole("heading", { name: "Add quote", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Quote number")).toBeVisible();
    await expect(page.getByTestId("quote-preview")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create quote" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);

    await page.getByRole("radio", { name: "Client" }).check();
    await selectSearchableOption(page, "Select client", fixtures.clientA.name, fixtures.clientA.name);
    const clientOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(clientOverflow).toBe(false);

    const row1 = page.getByRole("group", { name: "Line item 1" });
    await row1.getByLabel("Description").fill("Design work");
    await row1.getByLabel("Qty").fill("1");
    await row1.getByLabel("Unit price").fill("42.00");
    await expect(page.getByTestId("quote-preview-total")).toHaveText("$42.00");
  });
});
