import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Mobile invoice line-item overflow fix — permanent regression coverage
 * for the exact, previously-missed case: a POPULATED itemized line item
 * at ~390px. Proven pre-existing on the unmodified Production baseline
 * (see the narrow responsive audit), root-caused to
 * src/components/invoices/invoice-form.tsx's own top-level Live Preview
 * grid wrapper missing an explicit `grid-cols-1` base below `lg:` —
 * InvoiceLineItemRow itself was never the cause. QuoteForm and
 * RecurringInvoiceForm reuse InvoiceLineItemRow but never this wrapper,
 * and are confirmed unaffected — this file covers only InvoiceForm's own
 * surfaces (new/DRAFT edit/CANCELLED duplicate), never Quote or
 * Recurring.
 *
 * Every test here uses a genuinely POPULATED row (not blank) — the
 * entire point of the original gap was that prior 390px coverage either
 * stayed flat-mode (invoice-live-preview.spec.ts's own 390x900 test) or
 * never combined itemized mode with real values at this width at all.
 */

let fixtures: TestFixtures;

async function actAs(context: BrowserContext, baseURL: string, user: { id: string; email: string }, orgId: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, user, baseURL);
  await context.addCookies([
    { name: "active_organization_id", value: orgId, domain: new URL(baseURL).hostname, path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
  ]);
}

async function expectNoPageOverflow(page: import("@playwright/test").Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
}

test.describe("Mobile invoice line items — 390x900 regression", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("ordinary New Invoice: populated itemized row fits the viewport, every control remains usable", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/invoices/new");

    await page.getByRole("radio", { name: "Itemized" }).check();
    const row1 = page.getByRole("group", { name: "Line item 1" });
    await row1.getByLabel("Description").fill("Consulting");
    await row1.getByLabel("Qty").fill("1.125");
    await row1.getByLabel("Unit price").fill("33.33");

    // The exact, previously-failing assertion — now truthful.
    await expectNoPageOverflow(page);

    await expect(row1.getByLabel("Description")).toBeEditable();
    await expect(row1.getByLabel("Qty")).toBeEditable();
    await expect(row1.getByLabel("Unit price")).toBeEditable();
    await expect(page.getByRole("button", { name: "Remove line item 1" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add line" })).toBeVisible();
    await expect(page.getByTestId("invoice-preview-total")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create invoice" })).toBeVisible();
  });

  test("DRAFT edit: a populated itemized row fits the viewport, editing a value keeps it that way, row actions stay reachable", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const draft = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber: `E2E-RESPONSIVE-DRAFT-${fixtures.runId}`,
        status: "DRAFT",
        amount: "37.50",
        subtotal: "37.50",
        discountAmount: "0.00",
        taxAmount: "0.00",
        currency: "USD",
        clientId: fixtures.clientA.id,
        organizationId: fixtures.orgA.id,
        issueDate: new Date(),
        lineItems: { create: [{ description: "Consulting", quantity: "1.125", unitPrice: "33.33", lineTotal: "37.50", position: 0 }] },
      },
    });

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/invoices/${draft.id}/edit`);

    const row1 = page.getByRole("group", { name: "Line item 1" });
    await expect(row1.getByLabel("Description")).toHaveValue("Consulting");
    await expectNoPageOverflow(page);

    await row1.getByLabel("Unit price").fill("40.00");
    await expectNoPageOverflow(page);

    const preview = page.getByTestId("invoice-preview");
    await expect(preview).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove line item 1" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();

    await dbQuery("invoice", "deleteMany", { where: { id: draft.id } });
  });

  test("CANCELLED duplicate: the prefilled populated itemized row fits the viewport and the form stays usable", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const cancelled = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber: `E2E-RESPONSIVE-CANCEL-${fixtures.runId}`,
        status: "CANCELLED",
        amount: "37.50",
        subtotal: "37.50",
        discountAmount: "0.00",
        taxAmount: "0.00",
        currency: "USD",
        clientId: fixtures.clientA.id,
        organizationId: fixtures.orgA.id,
        issueDate: new Date(),
        lineItems: { create: [{ description: "Consulting", quantity: "1.125", unitPrice: "33.33", lineTotal: "37.50", position: 0 }] },
      },
    });

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/invoices/${cancelled.id}/duplicate`);

    const row1 = page.getByRole("group", { name: "Line item 1" });
    await expect(row1.getByLabel("Description")).toHaveValue("Consulting");
    await expectNoPageOverflow(page);
    await expect(page.getByRole("button", { name: "Create duplicate" })).toBeVisible();

    await dbQuery("invoice", "deleteMany", { where: { id: cancelled.id } });
  });

  test("multi-row: two populated rows fit the viewport, reorder and remove both stay reachable with no overflow after either action", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/invoices/new");

    await page.getByRole("radio", { name: "Itemized" }).check();
    const row1 = page.getByRole("group", { name: "Line item 1" });
    await row1.getByLabel("Description").fill("Consulting");
    await row1.getByLabel("Qty").fill("1.125");
    await row1.getByLabel("Unit price").fill("33.33");

    await page.getByRole("button", { name: "Add line" }).click();
    const row2 = page.getByRole("group", { name: "Line item 2" });
    await row2.getByLabel("Description").fill("Hosting");
    await row2.getByLabel("Qty").fill("1");
    await row2.getByLabel("Unit price").fill("29.99");

    await expectNoPageOverflow(page);
    await expect(page.getByRole("button", { name: "Move line item 2 up" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move line item 1 down" })).toBeVisible();

    await page.getByRole("button", { name: "Move line item 2 up" }).click();
    await expectNoPageOverflow(page);
    await expect(page.getByRole("group", { name: "Line item 1" }).getByLabel("Description")).toHaveValue("Hosting");

    // After the reorder above, row 1 is now "Hosting" and row 2 is now
    // "Consulting" — removing row 2 leaves "Hosting" as the sole row.
    await page.getByRole("button", { name: "Remove line item 2" }).click();
    await expectNoPageOverflow(page);
    await expect(page.getByRole("group", { name: "Line item 2" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Line item 1" }).getByLabel("Description")).toHaveValue("Hosting");
  });
});
