import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Tables Improvement Slice E2 — Column Customization V1, Contracts
 * pilot. Reuses the shared E1 primitive (storage/hook/provider/
 * ColumnVisibilityControl) completely unmodified except the surface
 * union widening -- this file proves Contracts' own integration of it:
 * placement, default columns, mandatory protection, hide/persistence,
 * bulk-selection interaction, active-sort preservation, Saved Views
 * independence, Active/Archived continuity, stale-entity-filter
 * non-interference, mobile non-impact, and hydration safety. Domain-
 * layer correctness (bulk archive itself, stale-filter fail-closed
 * semantics, sorting, sticky header) is already exhaustively covered
 * elsewhere (contracts-bulk-workflow.spec.ts, contract-stale-entity-
 * filter.spec.ts, contracts-table-workflow.spec.ts) and is not
 * re-derived here. Each test gets a fresh Playwright browser context
 * (fresh localStorage), so no explicit cross-test column-preference
 * cleanup is needed.
 */

let fixtures: TestFixtures;
let seededContractIds: string[] = [];

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

async function seedContract(overrides: Record<string, unknown> = {}): Promise<{ id: string; contractNumber: string }> {
  const contractNumber = (overrides.contractNumber as string) ?? uniqueNumber("E2E-COL-C");
  const created = await dbQuery<{ id: string; contractNumber: string }>("contract", "create", {
    data: {
      title: "Column Customization Test Contract",
      body: "This agreement is entered into by and between the parties.",
      status: "DRAFT",
      issueDate: "2026-06-01T00:00:00.000Z",
      organizationId: fixtures.orgA.id,
      clientId: fixtures.clientA.id,
      createdByUserId: fixtures.owner.id,
      ...overrides,
      contractNumber,
    },
  });
  seededContractIds.push(created.id);
  return created;
}

async function cleanupSeededContracts(): Promise<void> {
  if (seededContractIds.length > 0) {
    await dbQuery("contract", "deleteMany", { where: { id: { in: seededContractIds } } });
    seededContractIds = [];
  }
}

/** Mirrors invoice-column-customization.spec.ts's own identical helper -- strips SortableHeader's decorative arrow + sr-only sort-state suffix. */
function cleanHeaderText(text: string): string {
  return text
    .replace(/[▲▼⇅]/g, "")
    .replace(/,\s*(sorted (ascending|descending)|not sorted)$/, "")
    .trim();
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

test.describe("Contract Column Customization (Tables Improvement Slice E2)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test.afterEach(async () => {
    await cleanupSeededContracts();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("placement: quick chips, Saved Views, Columns control, and Search/filter/sort all present together; checkbox column present on Active", async ({ page }) => {
    const contract = await seedContract();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/contracts");

    await expect(page.getByRole("link", { name: "Draft" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0); // no saved views yet, control itself still renders "Save current view"
    await expect(page.getByRole("button", { name: "Save current view" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Columns" })).toBeVisible();
    // Scoped to the filter bar's own <form> -- the page also has an
    // unrelated global "Search" (Cmd+K palette) trigger elsewhere.
    await expect(page.locator("form").getByLabel("Search")).toBeVisible();
    await expect(page.getByLabel("Sort by")).toBeVisible();

    const row = page.getByRole("row", { name: new RegExp(contract.contractNumber) });
    await expect(row).toBeVisible();
    await expect(row.getByRole("checkbox", { name: `Select contract ${contract.contractNumber}` })).toBeVisible();
  });

  test("default state: all seven canonical Contract desktop columns are present, matching today's table exactly", async ({ page }) => {
    await seedContract();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/contracts");

    // The bulk-selection checkbox <th> is also role=columnheader (plain
    // HTML semantics), but has no text content -- it's a selection
    // control, not a data column (see contract-list-with-selection.tsx's
    // own identical comment) -- filtered out here before comparing.
    const headerNames = await page.getByRole("columnheader").allTextContents();
    expect(headerNames.map((t) => cleanHeaderText(t)).filter((t) => t.length > 0)).toEqual([
      "Contract #",
      "Title",
      "Client",
      "Project",
      "Status",
      "Issue date",
      "Actions",
    ]);
  });

  test("picker: mandatory Contract #/Status/Actions checked+disabled+'Always shown'; optional Title/Client/Project/Issue date toggleable; checkbox never appears", async ({ page }) => {
    await seedContract();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/contracts");

    await openColumnsPanel(page);
    const panel = page.getByRole("group", { name: "Column visibility" });

    for (const label of ["Contract #", "Status", "Actions"]) {
      const checkbox = page.getByRole("checkbox", { name: new RegExp(label) });
      await expect(checkbox).toBeChecked();
      await expect(checkbox).toBeDisabled();
    }
    await expect(page.getByText("Always shown")).toHaveCount(3);

    for (const label of ["Title", "Client", "Project", "Issue date"]) {
      const checkbox = page.getByRole("checkbox", { name: label, exact: true });
      await expect(checkbox).toBeChecked();
      await expect(checkbox).toBeEnabled();
    }

    // Exactly 7 checkboxes in the panel -- the bulk-selection checkbox
    // is never represented here.
    await expect(panel.getByRole("checkbox")).toHaveCount(7);
  });

  test("hide Project: header and cells disappear, checkbox column alignment unaffected, mandatory columns remain, and the preference survives a reload", async ({ page }) => {
    const contract = await seedContract();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/contracts");

    const row = page.getByRole("row", { name: new RegExp(contract.contractNumber) });
    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Project", exact: true }).uncheck();

    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Contract #" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Actions" })).toBeVisible();
    // Checkbox column (1) + Contract #/Title/Client/Status/Issue date/Actions (6) = 7.
    await expect(row.getByRole("checkbox", { name: `Select contract ${contract.contractNumber}` })).toBeVisible();
    await expect(row.getByRole("cell")).toHaveCount(7);

    await page.reload();
    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);
    await expect(row.getByRole("cell")).toHaveCount(7);
  });

  test("bulk interaction: hiding an optional column does not affect selection, BulkActionBar, or the selected count", async ({ page }) => {
    const prefix = uniqueNumber("E2E-COL-BULK");
    const first = await seedContract({ contractNumber: `${prefix}-0` });
    const second = await seedContract({ contractNumber: `${prefix}-1` });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/contracts?q=${prefix}`);

    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Title", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Title" })).toHaveCount(0);

    await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
    await page.getByRole("checkbox", { name: `Select contract ${first.contractNumber}` }).check();
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("1 selected");

    await page.getByRole("checkbox", { name: `Select contract ${second.contractNumber}` }).check();
    await expect(bar).toContainText("2 selected");

    await bar.getByRole("button", { name: "Clear selection" }).click();
    await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
    // Column preference is untouched by the whole selection interaction.
    await expect(page.getByRole("columnheader", { name: "Title" })).toHaveCount(0);
  });

  test("hiding the currently-sorted column (Issue date) does not reset or alter the active sort", async ({ page }) => {
    const earlier = await seedContract({ issueDate: "2026-01-10T00:00:00.000Z", contractNumber: uniqueNumber("E2E-COL-SORT-EARLY") });
    const later = await seedContract({ issueDate: "2026-06-10T00:00:00.000Z", contractNumber: uniqueNumber("E2E-COL-SORT-LATE") });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/contracts?q=E2E-COL-SORT&sort=issueDate:asc`);

    await expect(page.getByLabel("Sort by")).toHaveValue("issueDate:asc");
    await expect(page.getByRole("columnheader", { name: /Issue date/ })).toHaveAttribute("aria-sort", "ascending");
    const rowsBefore = await page.getByRole("row").allTextContents();
    expect(rowsBefore.findIndex((t) => t.includes(earlier.contractNumber))).toBeLessThan(
      rowsBefore.findIndex((t) => t.includes(later.contractNumber)),
    );

    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Issue date", exact: true }).uncheck();

    await expect(page.getByRole("columnheader", { name: "Issue date" })).toHaveCount(0);
    await expect(page).toHaveURL(/sort=issueDate(%3A|:)asc/);
    await expect(page.getByLabel("Sort by")).toHaveValue("issueDate:asc");
    const rowsAfter = await page.getByRole("row").allTextContents();
    expect(rowsAfter.findIndex((t) => t.includes(earlier.contractNumber))).toBeLessThan(
      rowsAfter.findIndex((t) => t.includes(later.contractNumber)),
    );

    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
  });

  test("Saved Views independence: hiding a column does not alter a Saved View, and applying a Saved View does not alter column visibility", async ({ page }) => {
    const marker = uniqueNumber("E2E-COL-SV");
    const matching = await seedContract({ contractNumber: `${marker}-001`, status: "SENT" });
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto("/contracts");
    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Project", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);

    await page.goto(`/contracts?q=${marker}&status=SENT`);
    await expect(page.getByRole("row", { name: new RegExp(matching.contractNumber) })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto("/contracts?status=ACCEPTED");
    const savedViewsSelect = page.getByRole("combobox", { name: "Saved views" });
    await savedViewsSelect.selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(/status=SENT/);
    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);

    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page.getByRole("columnheader", { name: "Project" })).toBeVisible();
    await expect(savedViewsSelect.getByRole("option", { name: viewName, exact: true })).toHaveCount(1);

    // Cleanup the temporary Saved View.
    await savedViewsSelect.selectOption({ label: viewName });
    await page.getByRole("button", { name: "Delete saved view" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  });

  test("Active/Archived continuity: a column hidden on Active remains hidden on Archived (one shared namespace), and the checkbox column is absent on Archived", async ({ page }) => {
    const archived = await seedContract({ status: "TERMINATED", archivedAt: new Date().toISOString() });
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto("/contracts");
    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Project", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);

    await page.goto("/contracts?archived=1");
    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Contract #" })).toBeVisible();

    const row = page.getByRole("row", { name: new RegExp(archived.contractNumber) });
    await expect(row).toBeVisible();
    await expect(row.getByRole("checkbox")).toHaveCount(0);
    await expect(row.getByRole("link", { name: "View" })).toBeVisible();
    await row.getByRole("button", { name: `More actions for contract ${archived.contractNumber}` }).click();
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
  });

  test("stale entity filter regression: Columns remains usable with a stale client filter, and toggling/resetting a column never clears the stale intent", async ({ page }) => {
    const STALE_UUID = "00000000-0000-0000-0000-000000000000";
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/contracts?client=${STALE_UUID}`);

    await expect(page).toHaveURL(new RegExp(`client=${STALE_UUID}`));
    await expect(page.getByText("No matching contracts")).toBeVisible();

    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Project", exact: true }).uncheck();
    await expect(page).toHaveURL(new RegExp(`client=${STALE_UUID}`));

    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page).toHaveURL(new RegExp(`client=${STALE_UUID}`));
    await expect(page.getByText("No matching contracts")).toBeVisible();
  });

  test("390x900 mobile: hiding Project on desktop does not remove it from the mobile RecordCard (when the Contract has a project), and the Columns trigger is absent", async ({ page }) => {
    const contract = await seedContract({ projectId: fixtures.project.id });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/contracts");
    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Project", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.reload();

    await expect(page.getByRole("table")).toBeHidden();
    await expect(page.getByRole("button", { name: "Columns" })).toHaveCount(0);

    const card = page.locator("li", { hasText: contract.contractNumber });
    await expect(card.getByText("Project", { exact: true })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test("hydration safety: reloading with a hidden column persisted produces no hydration mismatch and the table settles correctly", async ({ page }) => {
    await seedContract();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/contracts");

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
