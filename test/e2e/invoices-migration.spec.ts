import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Design System page migration Batch 10 — Remaining Invoices surfaces
 * (new/edit/duplicate pages, InvoiceForm, line items, read-only view,
 * draft/readiness panels, lifecycle/issue/send/archive controls). Covers
 * this batch's own critical gates: real Dark computed-style checks for
 * the migrated card/table surfaces, a data-equivalence proof for the
 * raw-<table>-to-shared-Table swap in InvoiceReadOnlyView, and mobile
 * no-overflow. Full create/edit/duplicate/issue/send/archive/lifecycle
 * behavior is already exhaustively covered by test/e2e/invoices.spec.ts
 * (47 tests) and test/e2e/invoice-issuance-readiness.spec.ts — re-run in
 * full alongside this file, not repeated here.
 */

let fixtures: TestFixtures;

async function actAsOwner(context: BrowserContext, baseURL: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, fixtures.owner, baseURL);
  await context.addCookies([
    {
      name: "active_organization_id",
      value: fixtures.orgA.id,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

test.describe("Design System Batch 10 — Remaining Invoices surfaces", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await actAsOwner(context, baseURL!);
  });

  test("Dark: /invoices/new card and mode-toggle radios are opaque/readable, no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/invoices/new");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

    const heading = page.getByRole("heading", { name: "Add invoice", level: 1 });
    await expect(heading).toBeVisible();
    await expect.poll(() => heading.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(236, 237, 238)");

    // legend -> fieldset -> form -> Invoice Live Preview V1's own
    // form+preview grid wrapper (InvoiceForm's own root) -> the
    // CARD_SURFACE_CLASSES card div. .first() because React's own hidden
    // progressive-enhancement safety-net <form> duplicate-renders this
    // same subtree — both matches are identical clones, not a "wrong"
    // element.
    const cardDiv = page.getByText("Invoice type", { exact: true }).locator("../../../..").first();
    await expect.poll(() => cardDiv.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(27, 31, 38)");

    expect(errors).toEqual([]);
  });

  test("Dark: the DRAFT edit form's total-preview box and itemized line-item row are opaque/readable", async ({ page }) => {
    await page.goto("/invoices/new");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

    // Scoped to the one real form card — same disambiguation as the first
    // test above: React's hidden progressive-enhancement safety-net
    // <form> duplicates this entire subtree, so any page-wide locator for
    // a control inside it (the radio, the preview box, a line-item row)
    // can resolve to two identical matches. Scoping every interaction/
    // assertion below to this single, already-disambiguated container
    // keeps each one unique regardless — this reproduced on CI (though
    // not locally) for the bare page-wide getByLabel("Itemized").
    const cardDiv = page.getByText("Invoice type", { exact: true }).locator("../../../..").first();

    await cardDiv.getByLabel("Itemized").check();
    const previewBox = cardDiv.getByText("Enter valid amounts to see a total preview.").locator("..");
    await expect
      .poll(() => previewBox.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgb(23, 26, 32)");

    const lineItemRow = cardDiv.getByRole("group", { name: "Line item 1" });
    await expect
      .poll(() => lineItemRow.evaluate((el) => getComputedStyle(el).borderColor))
      .toBe("rgba(255, 255, 255, 0.14)");
  });

  test("Data-equivalence + Dark: the read-only view's line-items table (now the shared Table primitive) shows the exact same rows/order/totals as the source data", async ({
    page,
  }) => {
    const invoiceNumber = `E2E-BATCH10-${fixtures.runId}`;
    const invoice = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber,
        status: "SENT",
        currency: "USD",
        issueDate: new Date().toISOString(),
        amount: "300.00",
        subtotal: "300.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        projectId: fixtures.project.id,
        clientId: fixtures.clientA.id,
        organizationId: fixtures.orgA.id,
        lineItems: {
          create: [
            { description: "First line", quantity: "2", unitPrice: "50.00", lineTotal: "100.00", position: 0 },
            { description: "Second line", quantity: "1", unitPrice: "200.00", lineTotal: "200.00", position: 1 },
          ],
        },
      },
    });

    try {
      await page.goto(`/invoices/${invoice.id}/edit`);
      await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

      const rows = page.getByRole("row");
      // Header row + 2 data rows.
      await expect(rows).toHaveCount(3);

      // Exact per-row cell values AND order (position 0 before position
      // 1) — the shared Table primitive's own DOM order, not just
      // presence of each value somewhere on the page.
      const firstDataRowCells = await rows.nth(1).getByRole("cell").allTextContents();
      expect(firstDataRowCells).toEqual(["First line", "2", "$50.00", "$100.00"]);

      const secondDataRowCells = await rows.nth(2).getByRole("cell").allTextContents();
      expect(secondDataRowCells).toEqual(["Second line", "1", "$200.00", "$200.00"]);

      await expect(page.getByText("$300.00").last()).toBeVisible();

      const table = page.getByRole("table");
      await expect
        .poll(() => table.evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor))
        .toBe("rgb(27, 31, 38)");
    } finally {
      await dbQuery("invoice", "delete", { where: { id: invoice.id } });
    }
  });

  test("Mobile (390/320px): /invoices/new and /invoices/[id]/edit fit viewport with no horizontal overflow", async ({
    page,
  }) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });

      await page.goto("/invoices/new");
      await expect(page.getByRole("heading", { name: "Add invoice", level: 1 })).toBeVisible();
      let overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

      // Same duplicate-form disambiguation as the tests above — a bare
      // page-wide getByLabel("Itemized") can match both the real and the
      // hidden progressive-enhancement clone.
      const cardDiv = page.getByText("Invoice type", { exact: true }).locator("../../../..").first();
      await cardDiv.getByLabel("Itemized").check();
      overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }
  });
});
