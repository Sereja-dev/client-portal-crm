import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Tables Improvement Slice E3A — Column Customization V1, Quotes
 * pilot. Reuses the shared E1/E2 primitive (storage/hook/provider/
 * ColumnVisibilityControl) completely unmodified except the surface
 * union widening -- this file proves Quotes' own integration of it:
 * placement, default columns, mandatory protection, hide/persistence,
 * active-sort preservation (Sort-by select only -- Quotes has no
 * clickable sortable headers), Saved Views independence, Active/
 * Archived continuity, derived-status (EXPIRED/CONVERTED) non-
 * interference, mobile non-impact, and first-load hydration safety.
 * Domain-layer correctness (status derivation, target derivation,
 * sorting, lifecycle actions) is already exhaustively covered
 * elsewhere (test/e2e/quotes.spec.ts, quote-saved-views.spec.ts) and
 * is not re-derived here. Quotes has no bulk selection and no sticky
 * header at all (E3A readiness audit §P/§Q), so neither category is
 * tested here -- there is nothing of that shape to protect. Each test
 * gets a fresh Playwright browser context (fresh localStorage), so no
 * explicit cross-test column-preference cleanup is needed.
 */

let fixtures: TestFixtures;
let seededQuoteIds: string[] = [];
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

async function seedQuote(overrides: Record<string, unknown> = {}): Promise<{ id: string; number: string }> {
  const number = (overrides.number as string) ?? uniqueNumber("E2E-COL-Q");
  const created = await dbQuery<{ id: string; number: string }>("quote", "create", {
    data: {
      status: "DRAFT",
      subtotal: "10.00",
      discountAmount: "0.00",
      taxAmount: "0.00",
      total: "10.00",
      organizationId: fixtures.orgA.id,
      createdByUserId: fixtures.owner.id,
      clientId: fixtures.clientA.id,
      ...overrides,
      number,
    },
  });
  seededQuoteIds.push(created.id);
  return created;
}

async function cleanupSeeded(): Promise<void> {
  if (seededQuoteIds.length > 0) {
    await dbQuery("quote", "deleteMany", { where: { id: { in: seededQuoteIds } } });
    seededQuoteIds = [];
  }
  if (seededInvoiceIds.length > 0) {
    await dbQuery("invoice", "deleteMany", { where: { id: { in: seededInvoiceIds } } });
    seededInvoiceIds = [];
  }
}

/** Idempotent -- see invoice-column-customization.spec.ts's own identical reasoning. */
async function openColumnsPanel(page: Page): Promise<void> {
  const panel = page.getByRole("group", { name: "Column visibility" });
  if (await panel.isVisible()) {
    return;
  }
  await page.getByRole("button", { name: "Columns" }).click();
  await expect(panel).toBeVisible();
}

test.describe("Quote Column Customization (Tables Improvement Slice E3A)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test.afterEach(async () => {
    await cleanupSeeded();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("placement: Saved Views, Columns control, and Search/filter/sort all present together; existing Quote list semantics unchanged", async ({ page }) => {
    const quote = await seedQuote();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/quotes");

    await expect(page.getByRole("button", { name: "Save current view" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Columns" })).toBeVisible();
    await expect(page.locator("form").getByLabel("Search")).toBeVisible();
    await expect(page.getByLabel("Sort by")).toBeVisible();

    const row = page.getByRole("row", { name: new RegExp(quote.number) });
    await expect(row).toBeVisible();
  });

  test("default state (fresh browser, no stored preference): all eight canonical Quote desktop columns are present, matching today's table exactly", async ({ page }) => {
    await seedQuote();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/quotes");

    const headerNames = await page.getByRole("columnheader").allTextContents();
    expect(headerNames.map((t) => t.trim())).toEqual([
      "Quote #",
      "Target",
      "Title",
      "Status",
      "Total",
      "Issue date",
      "Valid until",
      "Actions",
    ]);
  });

  test("picker: mandatory Quote #/Status/Actions checked+disabled+'Always shown'; optional Target/Title/Total/Issue date/Valid until toggleable", async ({ page }) => {
    await seedQuote();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/quotes");

    await openColumnsPanel(page);
    const panel = page.getByRole("group", { name: "Column visibility" });

    for (const label of ["Quote #", "Status", "Actions"]) {
      const checkbox = page.getByRole("checkbox", { name: new RegExp(label) });
      await expect(checkbox).toBeChecked();
      await expect(checkbox).toBeDisabled();
    }
    await expect(page.getByText("Always shown")).toHaveCount(3);

    for (const label of ["Target", "Title", "Total", "Issue date", "Valid until"]) {
      const checkbox = page.getByRole("checkbox", { name: label, exact: true });
      await expect(checkbox).toBeChecked();
      await expect(checkbox).toBeEnabled();
    }

    // Exactly 8 checkboxes -- no selection/bulk checkbox exists on Quotes.
    await expect(panel.getByRole("checkbox")).toHaveCount(8);
  });

  test("hide Title: header and cells disappear, mandatory columns remain, and the preference survives a reload; Reset restores it", async ({ page }) => {
    const quote = await seedQuote({ title: "Hide me" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/quotes");

    const row = page.getByRole("row", { name: new RegExp(quote.number) });
    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Title", exact: true }).uncheck();

    await expect(page.getByRole("columnheader", { name: "Title" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Quote #" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Actions" })).toBeVisible();
    // 8 columns - 1 hidden = 7 cells.
    await expect(row.getByRole("cell")).toHaveCount(7);

    await page.reload();
    await expect(page.getByRole("columnheader", { name: "Title" })).toHaveCount(0);
    await expect(row.getByRole("cell")).toHaveCount(7);

    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page.getByRole("columnheader", { name: "Title" })).toBeVisible();
  });

  test("hiding the currently-sorted column (Total) does not reset or alter the active sort -- Quotes sorts only via the Sort-by select", async ({ page }) => {
    const small = await seedQuote({ total: "10.00", number: uniqueNumber("E2E-COL-Q-SORT-SMALL") });
    const large = await seedQuote({ total: "9999.00", number: uniqueNumber("E2E-COL-Q-SORT-LARGE") });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/quotes?q=E2E-COL-Q-SORT&sort=total:desc`);

    await expect(page.getByLabel("Sort by")).toHaveValue("total:desc");
    const rowsBefore = await page.getByRole("row").allTextContents();
    expect(rowsBefore.findIndex((t) => t.includes(large.number))).toBeLessThan(
      rowsBefore.findIndex((t) => t.includes(small.number)),
    );

    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Total", exact: true }).uncheck();

    await expect(page.getByRole("columnheader", { name: "Total" })).toHaveCount(0);
    await expect(page).toHaveURL(/sort=total(%3A|:)desc/);
    await expect(page.getByLabel("Sort by")).toHaveValue("total:desc");
    const rowsAfter = await page.getByRole("row").allTextContents();
    expect(rowsAfter.findIndex((t) => t.includes(large.number))).toBeLessThan(
      rowsAfter.findIndex((t) => t.includes(small.number)),
    );

    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
  });

  test("Saved Views independence: hiding a column does not alter a Saved View, and applying a Saved View does not alter column visibility", async ({ page }) => {
    const marker = uniqueNumber("E2E-COL-Q-SV");
    const matching = await seedQuote({ number: `${marker}-001`, status: "SENT", sentAt: new Date().toISOString() });
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto("/quotes");
    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Title", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Title" })).toHaveCount(0);

    await page.goto(`/quotes?q=${marker}&status=SENT`);
    await expect(page.getByRole("row", { name: new RegExp(matching.number) })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Title" })).toHaveCount(0);

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto("/quotes?status=DECLINED");
    const savedViewsSelect = page.getByRole("combobox", { name: "Saved views" });
    await savedViewsSelect.selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(/status=SENT/);
    await expect(page.getByRole("columnheader", { name: "Title" })).toHaveCount(0);

    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page.getByRole("columnheader", { name: "Title" })).toBeVisible();
    await expect(savedViewsSelect.getByRole("option", { name: viewName, exact: true })).toHaveCount(1);

    // Cleanup the temporary Saved View.
    await savedViewsSelect.selectOption({ label: viewName });
    await page.getByRole("button", { name: "Delete saved view" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
  });

  test("Active/Archived continuity: a column hidden on Active remains hidden on Archived (one shared namespace)", async ({ page }) => {
    // APPROVED (not the default DRAFT) so the row's Actions cell shows
    // "View", not "Edit" -- this test only cares about column
    // visibility continuity, so picking the non-default status avoids
    // conflating that with the unrelated DRAFT-vs-other action-label rule.
    const archived = await seedQuote({ status: "APPROVED", approvedAt: new Date().toISOString(), archivedAt: new Date().toISOString() });
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto("/quotes");
    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Title", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Title" })).toHaveCount(0);

    await page.goto("/quotes?archived=1");
    await expect(page.getByRole("columnheader", { name: "Title" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Quote #" })).toBeVisible();

    const row = page.getByRole("row", { name: new RegExp(archived.number) });
    await expect(row).toBeVisible();
    await expect(row.getByRole("link", { name: "View" })).toBeVisible();
  });

  test("derived statuses: EXPIRED and CONVERTED still render correctly while an unrelated optional column (Title) is hidden", async ({ page }) => {
    const suffix = uniqueNumber("E2E-COL-Q-STATUS");
    const expired = await seedQuote({
      number: `${suffix}-EXPIRED`,
      status: "SENT",
      sentAt: new Date().toISOString(),
      validUntil: "2020-01-01T00:00:00.000Z",
    });
    const invoice = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber: `${suffix}-INV`,
        status: "DRAFT",
        amount: "10.00",
        subtotal: "10.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        organizationId: fixtures.orgA.id,
      },
    });
    seededInvoiceIds.push(invoice.id);
    const converted = await seedQuote({
      number: `${suffix}-CONVERTED`,
      status: "APPROVED",
      approvedAt: new Date().toISOString(),
      convertedInvoiceId: invoice.id,
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/quotes");
    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Title", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Title" })).toHaveCount(0);

    await page.goto(`/quotes?q=${suffix}`);
    await expect(page.getByRole("row", { name: new RegExp(expired.number) }).getByText("Expired", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("row", { name: new RegExp(converted.number) }).getByText("Converted", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Title" })).toHaveCount(0);
  });

  test("390x900 mobile: hiding Title on desktop does not remove the mobile RecordCard's own conditional Title field, and the Columns trigger is absent", async ({ page }) => {
    const quote = await seedQuote({ title: "Mobile title check" });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/quotes");
    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Title", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Title" })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.reload();

    await expect(page.getByRole("table")).toBeHidden();
    await expect(page.getByRole("button", { name: "Columns" })).toHaveCount(0);

    const card = page.locator("li", { hasText: quote.number });
    await expect(card.getByText("Title", { exact: true })).toBeVisible();
    await expect(card.getByText("Target", { exact: true })).toBeVisible();
    await expect(card.getByText("Total", { exact: true })).toBeVisible();
    await expect(card.getByText("Issue date", { exact: true })).toBeVisible();
    await expect(card.getByText("Valid until", { exact: true })).toBeVisible();
    await expect(card.getByText("Status", { exact: true })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test("hydration safety: first-ever load of /quotes in a fresh browser context, with a hidden-column preference already persisted, produces no React hydration mismatch", async ({ page }) => {
    // Listener registration MUST precede the first navigation -- the
    // Contracts hydration defect investigation proved that attaching
    // listeners only around a later reload() silently misses a
    // first-load-only error. Every other Quote Column Customization test
    // in this file navigates AFTER its own `beforeEach`'s `actAsOwner`
    // call with no prior page load in the same browser context, so this
    // is already each test's own first navigation -- this test makes
    // that property, and a PRE-SEEDED hidden-column preference (proving
    // the new QuoteDesktopTable Client Component boundary itself doesn't
    // reintroduce a hydration mismatch), an explicit assertion.
    const quote = await seedQuote({ title: "Hydration check" });

    await page.addInitScript(
      ({ key, value }) => {
        window.localStorage.setItem(key, value);
      },
      {
        key: `aqenra:table-columns:v1:${fixtures.orgA.id}:${fixtures.owner.id}:quotes`,
        value: JSON.stringify({ version: 1, hiddenIds: ["title"] }),
      },
    );

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/quotes");

    const row = page.getByRole("row", { name: new RegExp(quote.number) });
    await expect(row).toBeVisible();
    // The pre-seeded preference actually took effect on first paint --
    // not a vacuous pass because the column was never really hidden.
    await expect(page.getByRole("columnheader", { name: "Title" })).toHaveCount(0);

    const hydrationRelated = [...consoleErrors, ...pageErrors].filter((text) =>
      /hydrat|#418|did not match|server-rendered/i.test(text),
    );
    expect(hydrationRelated).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
