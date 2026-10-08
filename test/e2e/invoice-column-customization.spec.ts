import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Tables Improvement Slice E1 — Column Customization V1, Invoices
 * pilot. Real browser coverage for the `Columns` picker: default state
 * (every column visible, matching today's table exactly), hide/
 * persistence, mandatory-column protection, Reset to default,
 * independence from Saved Views, active-sort preservation when its own
 * column is hidden, sticky-header compatibility, mobile non-impact, and
 * hydration safety. Domain-layer correctness (sort/filter/pagination
 * themselves, the sticky-header mechanism, the action-menu hierarchy)
 * is already exhaustively covered elsewhere
 * (test/e2e/invoices-table-workflow.spec.ts, invoices.spec.ts,
 * invoice-saved-views.spec.ts) and is not re-derived here — this file
 * only proves Column Customization's own new behavior on top of that
 * already-correct canonical state. Each test gets a fresh Playwright
 * browser context (fresh localStorage) by default, so no explicit
 * cross-test column-preference cleanup is needed.
 */

let fixtures: TestFixtures;
let seededInvoiceIds: string[] = [];

function uniqueNumber(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

async function actAsOwner(page: Page, baseURL: string): Promise<void> {
  await page.context().clearCookies();
  await injectTestSession(page.context(), { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL);
  await page.context().addCookies([
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

async function seedInvoice(overrides: Record<string, unknown>): Promise<{ id: string; invoiceNumber: string }> {
  const invoiceNumber = (overrides.invoiceNumber as string) ?? uniqueNumber("E2E-COL");
  const created = await dbQuery<{ id: string; invoiceNumber: string }>("invoice", "create", {
    data: {
      status: "DRAFT",
      amount: "100.00",
      subtotal: "100.00",
      discountAmount: "0.00",
      taxAmount: "0.00",
      clientId: fixtures.clientA.id,
      organizationId: fixtures.orgA.id,
      ...overrides,
      invoiceNumber,
    },
  });
  seededInvoiceIds.push(created.id);
  return created;
}

async function cleanupSeededInvoices(): Promise<void> {
  if (seededInvoiceIds.length > 0) {
    await dbQuery("invoice", "deleteMany", { where: { id: { in: seededInvoiceIds } } });
    seededInvoiceIds = [];
  }
}

/**
 * `SortableHeader`'s own text content is "<label><arrow glyph><sr-only
 * sort-state suffix>" (e.g. "Amount▼, sorted descending") -- strip both
 * the decorative arrow and the sr-only suffix to compare against a
 * plain label list.
 */
function cleanHeaderText(text: string): string {
  return text
    .replace(/[▲▼⇅]/g, "")
    .replace(/,\s*(sorted (ascending|descending)|not sorted)$/, "")
    .trim();
}

/** Idempotent: a test that already has the panel open (e.g. it never explicitly closed it after an earlier interaction) can safely call this again -- clicking the trigger a second time while already open would otherwise just toggle it closed. */
async function openColumnsPanel(page: Page): Promise<void> {
  const panel = page.getByRole("group", { name: "Column visibility" });
  if (await panel.isVisible()) {
    return;
  }
  await page.getByRole("button", { name: "Columns" }).click();
  await expect(panel).toBeVisible();
}

test.describe("Invoice Column Customization (Tables Improvement Slice E1)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test.afterEach(async () => {
    await cleanupSeededInvoices();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("default state (fresh browser, no stored preference): every current desktop column is present, matching today's table exactly", async ({ page }) => {
    await seedInvoice({ status: "DRAFT" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/invoices");

    const headerNames = await page.getByRole("columnheader").allTextContents();
    expect(headerNames.map((t) => cleanHeaderText(t))).toEqual([
      "Invoice #",
      "Project",
      "Client",
      "Amount",
      "Status",
      "Due date",
      "Created",
      "Actions",
    ]);
    await expect(page.getByRole("button", { name: "Columns" })).toBeVisible();
  });

  test("hide an optional column (Project): header and every row cell disappear, remaining columns stay aligned, and the preference survives a reload", async ({ page }) => {
    const invoice = await seedInvoice({ status: "DRAFT" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/invoices");

    const row = page.getByRole("row", { name: new RegExp(invoice.invoiceNumber) });
    await expect(row).toBeVisible();

    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Project", exact: true }).uncheck();

    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);
    // Every remaining header is still present and in the same relative
    // order -- a column was removed cleanly, nothing else shifted away.
    const headerNames = await page.getByRole("columnheader").allTextContents();
    expect(headerNames.map((t) => cleanHeaderText(t))).toEqual([
      "Invoice #",
      "Client",
      "Amount",
      "Status",
      "Due date",
      "Created",
      "Actions",
    ]);
    // The row itself still renders, with one fewer cell than before.
    await expect(row).toBeVisible();
    await expect(row.getByRole("cell")).toHaveCount(7);

    await page.reload();
    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);
    await expect(row.getByRole("cell")).toHaveCount(7);
  });

  test("mandatory protection: Invoice #, Status, and Actions are checked and disabled in the picker, with an 'Always shown' note", async ({ page }) => {
    await seedInvoice({ status: "DRAFT" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/invoices");

    await openColumnsPanel(page);

    for (const label of ["Invoice #", "Status", "Actions"]) {
      const checkbox = page.getByRole("checkbox", { name: new RegExp(label) });
      await expect(checkbox).toBeChecked();
      await expect(checkbox).toBeDisabled();
    }
    await expect(page.getByText("Always shown")).toHaveCount(3);

    // Every optional column's checkbox is checked but NOT disabled,
    // matching the "all current columns default-visible" rule.
    for (const label of ["Project", "Client", "Amount", "Due date", "Created"]) {
      const checkbox = page.getByRole("checkbox", { name: label, exact: true });
      await expect(checkbox).toBeChecked();
      await expect(checkbox).toBeEnabled();
    }
  });

  test("Reset to default restores every column after one was hidden, and the restored default survives a reload", async ({ page }) => {
    await seedInvoice({ status: "DRAFT" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/invoices");

    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Amount", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Amount" })).toHaveCount(0);

    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page.getByRole("columnheader", { name: "Amount" })).toBeVisible();
    const headerNames = await page.getByRole("columnheader").allTextContents();
    expect(headerNames.length).toBe(8);

    await page.reload();
    const headerNamesAfterReload = await page.getByRole("columnheader").allTextContents();
    expect(headerNamesAfterReload.length).toBe(8);
  });

  test("Saved Views independence: hiding a column does not alter a Saved View, and applying a Saved View does not alter column visibility", async ({ page }) => {
    const marker = uniqueNumber("E2E-COL-SV");
    const matching = await seedInvoice({ invoiceNumber: `${marker}-001`, status: "SENT" });
    await page.setViewportSize({ width: 1280, height: 900 });

    // Hide Project first.
    await page.goto("/invoices");
    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Project", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);

    // Save a view from an unrelated filter state, then apply it from a
    // different one -- a pure filter/sort operation, which must leave
    // the just-hidden column untouched.
    await page.goto(`/invoices?q=${marker}&status=SENT&sort=dueDate:asc`);
    await expect(page.getByRole("row", { name: new RegExp(matching.invoiceNumber) })).toBeVisible();
    // Column preference persisted across this plain navigation too.
    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto("/invoices?status=PAID");
    const savedViewsSelect = page.getByRole("combobox", { name: "Saved views" });
    await savedViewsSelect.selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(/status=SENT/);
    await expect(page).toHaveURL(/sort=dueDate%3Aasc/);
    // Applying the Saved View changed filter/sort state only -- the
    // column preference set before any of this remains exactly as it
    // was, never reset or overwritten by Save/Apply.
    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);

    // The reverse direction: resetting columns must not touch the
    // Saved View record itself.
    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page.getByRole("columnheader", { name: "Project" })).toBeVisible();
    await expect(savedViewsSelect.getByRole("option", { name: viewName, exact: true })).toHaveCount(1);
  });

  test("hiding the currently-sorted column (Amount) does not reset or alter the active sort", async ({ page }) => {
    const small = await seedInvoice({ amount: "10.00", subtotal: "10.00", invoiceNumber: uniqueNumber("E2E-COL-SORT-SMALL") });
    const large = await seedInvoice({ amount: "9999.00", subtotal: "9999.00", invoiceNumber: uniqueNumber("E2E-COL-SORT-LARGE") });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/invoices?q=E2E-COL-SORT&sort=amount:desc`);

    await expect(page.getByLabel("Sort by")).toHaveValue("amount:desc");
    await expect(page.getByRole("columnheader", { name: /Amount/ })).toHaveAttribute("aria-sort", "descending");
    const rowsBefore = await page.getByRole("row").allTextContents();
    expect(rowsBefore.findIndex((t) => t.includes(large.invoiceNumber))).toBeLessThan(
      rowsBefore.findIndex((t) => t.includes(small.invoiceNumber)),
    );

    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Amount", exact: true }).uncheck();

    await expect(page.getByRole("columnheader", { name: "Amount" })).toHaveCount(0);
    // URL/query sort is unchanged -- column visibility never touches it.
    // (The colon may or may not be percent-encoded depending on how the
    // URL was produced -- both are valid, so this matches either.)
    await expect(page).toHaveURL(/sort=amount(%3A|:)desc/);
    // The Sort-by dropdown still shows Amount as the active sort, even
    // though its own header column is no longer rendered.
    await expect(page.getByLabel("Sort by")).toHaveValue("amount:desc");
    // Row order is unchanged.
    const rowsAfter = await page.getByRole("row").allTextContents();
    expect(rowsAfter.findIndex((t) => t.includes(large.invoiceNumber))).toBeLessThan(
      rowsAfter.findIndex((t) => t.includes(small.invoiceNumber)),
    );

    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
  });

  test("sticky header remains pinned and aligned to visible columns after one optional column is hidden", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 });
    const prefix = uniqueNumber("E2E-COL-STICKY");
    const rows = [];
    for (let i = 0; i < 10; i++) {
      rows.push(await seedInvoice({ invoiceNumber: `${prefix}-${i}`, status: "DRAFT" }));
    }
    await page.goto(`/invoices?q=${prefix}`);

    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Created", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Created" })).toHaveCount(0);

    const table = page.locator("table");
    const scrollContainer = table.locator("xpath=..");
    const theadBefore = await page.locator("thead").boundingBox();
    expect(theadBefore).not.toBeNull();

    const wasOutsideViewportBefore = await scrollContainer.evaluate((el) => el.scrollHeight > el.clientHeight);
    await scrollContainer.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });

    const theadAfter = await page.locator("thead").boundingBox();
    expect(theadAfter).not.toBeNull();
    expect(Math.abs(theadAfter!.y - theadBefore!.y)).toBeLessThanOrEqual(2);

    const lastRow = page.getByRole("row", { name: new RegExp(`${rows[9].invoiceNumber}$`) });
    await expect(lastRow).toBeVisible();
    // Header and body still agree on column count after the scroll.
    await expect(lastRow.getByRole("cell")).toHaveCount(7);
    expect(wasOutsideViewportBefore).toBe(true);
  });

  test("390x900 mobile: hiding Project on desktop does not remove it from the mobile RecordCard, and the Columns trigger is absent on mobile", async ({ page }) => {
    const invoice = await seedInvoice({ status: "DRAFT" });

    // Hide Project on desktop first -- the preference is browser-local
    // (same context, same localStorage), not viewport-local.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/invoices");
    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Project", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.reload();

    await expect(page.getByRole("table")).toBeHidden();
    await expect(page.getByRole("button", { name: "Columns" })).toHaveCount(0);

    const card = page.locator("li", { hasText: invoice.invoiceNumber });
    // Mobile RecordCard still shows its full normal, curated field set --
    // "Project" field label is present exactly as before this slice,
    // completely unaffected by the desktop-only preference.
    await expect(card.getByText("Project", { exact: true })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test("hydration safety: reloading with a hidden column persisted produces no hydration mismatch and the table settles correctly", async ({ page }) => {
    await seedInvoice({ status: "DRAFT" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/invoices");

    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Project", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.reload();
    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);
    await expect(page.getByRole("table")).toBeVisible();

    const hydrationRelated = [...consoleErrors, ...pageErrors].filter((text) => /hydrat|#418|did not match|server-rendered/i.test(text));
    expect(hydrationRelated).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
