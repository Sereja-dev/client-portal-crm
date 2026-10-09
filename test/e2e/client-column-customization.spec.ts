import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Tables Improvement Slice E3B — Column Customization V1, Clients
 * pilot. Reuses the shared E1/E2/E3A primitive (storage/hook/provider/
 * ColumnVisibilityControl) completely unmodified except the surface
 * union widening -- this file proves Clients' own integration of it:
 * placement, default columns, mandatory protection, hide/persistence,
 * sort preservation (Sort-by select only -- Clients has no clickable
 * sortable headers), Saved Views independence, stale custom-status
 * fail-closed compatibility, tag-filter compatibility, mobile non-
 * impact, first-load hydration safety, and no-results compatibility.
 * Domain-layer correctness (custom-status resolution, the fail-closed
 * query itself, tag filtering, Saved Views lifecycle) is already
 * exhaustively covered elsewhere (test/e2e/clients-stale-status-filter.spec.ts,
 * test/e2e/tags.spec.ts, test/e2e/client-saved-views.spec.ts) and is
 * not re-derived here. Clients has no bulk selection, no sticky
 * header, and no Active/Archived state at all (E3B readiness audit
 * §P/§Q/§O), so none of those categories is tested here -- there is
 * nothing of that shape to protect. Each test gets a fresh Playwright
 * browser context (fresh localStorage), so no explicit cross-test
 * column-preference cleanup is needed.
 */

let fixtures: TestFixtures;
let seededClientIds: string[] = [];
let seededDefinitionIds: string[] = [];
let seededTagIds: string[] = [];

function uniqueName(prefix: string): string {
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

async function seedClient(overrides: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
  const name = (overrides.name as string) ?? uniqueName("E2E-COL-Client");
  const created = await dbQuery<{ id: string; name: string }>("client", "create", {
    data: {
      organizationId: fixtures.orgA.id,
      userId: fixtures.owner.id,
      ...overrides,
      name,
    },
  });
  seededClientIds.push(created.id);
  return created;
}

async function seedTagWithAssignment(entityId: string, name: string): Promise<{ id: string; name: string }> {
  const tag = await dbQuery<{ id: string; name: string }>("tag", "create", {
    data: { organizationId: fixtures.orgA.id, name, normalizedName: name.toLowerCase(), color: "INFO" },
  });
  seededTagIds.push(tag.id);
  await dbQuery("tagAssignment", "create", {
    data: { organizationId: fixtures.orgA.id, tagId: tag.id, entityType: "CLIENT", entityId },
  });
  return tag;
}

async function cleanupSeeded(): Promise<void> {
  if (seededTagIds.length > 0) {
    await dbQuery("tagAssignment", "deleteMany", { where: { tagId: { in: seededTagIds } } });
    await dbQuery("tag", "deleteMany", { where: { id: { in: seededTagIds } } });
    seededTagIds = [];
  }
  if (seededClientIds.length > 0) {
    await dbQuery("client", "deleteMany", { where: { id: { in: seededClientIds } } });
    seededClientIds = [];
  }
  if (seededDefinitionIds.length > 0) {
    await dbQuery("customStatusDefinition", "deleteMany", { where: { id: { in: seededDefinitionIds } } });
    seededDefinitionIds = [];
  }
}

/** Idempotent -- see invoice/contract/quote-column-customization.spec.ts's own identical reasoning. */
async function openColumnsPanel(page: Page): Promise<void> {
  const panel = page.getByRole("group", { name: "Column visibility" });
  if (await panel.isVisible()) {
    return;
  }
  await page.getByRole("button", { name: "Columns" }).click();
  await expect(panel).toBeVisible();
}

test.describe("Client Column Customization (Tables Improvement Slice E3B)", () => {
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

  test("placement: Saved Views, Columns control, and Search/Status/Tag/Sort all present together; existing Client list semantics unchanged", async ({ page }) => {
    const client = await seedClient();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/clients");

    await expect(page.getByRole("button", { name: "Save current view" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Columns" })).toBeVisible();
    await expect(page.locator("form").getByLabel("Search")).toBeVisible();
    await expect(page.getByLabel("Status")).toBeVisible();
    await expect(page.getByLabel("Tag")).toBeVisible();
    await expect(page.getByLabel("Sort by")).toBeVisible();

    const row = page.getByRole("row", { name: new RegExp(client.name) });
    await expect(row).toBeVisible();
  });

  test("default state (fresh browser, no stored preference): all eight canonical Client desktop columns are present, matching today's table exactly", async ({ page }) => {
    await seedClient();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/clients");

    const headerNames = await page.getByRole("columnheader").allTextContents();
    expect(headerNames.map((t) => t.trim())).toEqual([
      "Name",
      "Company",
      "Email",
      "Phone",
      "Status",
      "Tags",
      "Created",
      "Actions",
    ]);
  });

  test("picker: mandatory Name/Status/Actions checked+disabled+'Always shown'; optional Company/Email/Phone/Tags/Created toggleable", async ({ page }) => {
    await seedClient();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/clients");

    await openColumnsPanel(page);
    const panel = page.getByRole("group", { name: "Column visibility" });

    for (const label of ["Name", "Status", "Actions"]) {
      const checkbox = page.getByRole("checkbox", { name: new RegExp(label) });
      await expect(checkbox).toBeChecked();
      await expect(checkbox).toBeDisabled();
    }
    await expect(page.getByText("Always shown")).toHaveCount(3);

    for (const label of ["Company", "Email", "Phone", "Tags", "Created"]) {
      const checkbox = page.getByRole("checkbox", { name: label, exact: true });
      await expect(checkbox).toBeChecked();
      await expect(checkbox).toBeEnabled();
    }

    // Exactly 8 checkboxes -- no selection/bulk checkbox exists on Clients.
    await expect(panel.getByRole("checkbox")).toHaveCount(8);
  });

  test("hide Phone: header and cells disappear, mandatory columns remain, and the preference survives a reload; Reset restores it", async ({ page }) => {
    const client = await seedClient({ phone: "555-0100" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/clients");

    const row = page.getByRole("row", { name: new RegExp(client.name) });
    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Phone", exact: true }).uncheck();

    await expect(page.getByRole("columnheader", { name: "Phone" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Actions" })).toBeVisible();
    // 8 columns - 1 hidden = 7 cells.
    await expect(row.getByRole("cell")).toHaveCount(7);

    await page.reload();
    await expect(page.getByRole("columnheader", { name: "Phone" })).toHaveCount(0);
    await expect(row.getByRole("cell")).toHaveCount(7);

    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page.getByRole("columnheader", { name: "Phone" })).toBeVisible();
  });

  test("hiding the currently-sorted column (Created) does not reset or alter the active sort -- Clients sorts only via the Sort-by select", async ({ page }) => {
    const older = await seedClient({ name: uniqueName("E2E-COL-C-SORT-OLD"), createdAt: "2020-01-01T00:00:00.000Z" });
    const newer = await seedClient({ name: uniqueName("E2E-COL-C-SORT-NEW"), createdAt: "2026-01-01T00:00:00.000Z" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/clients?q=E2E-COL-C-SORT&sort=createdAt:desc`);

    await expect(page.getByLabel("Sort by")).toHaveValue("createdAt:desc");
    const rowsBefore = await page.getByRole("row").allTextContents();
    expect(rowsBefore.findIndex((t) => t.includes(newer.name))).toBeLessThan(
      rowsBefore.findIndex((t) => t.includes(older.name)),
    );

    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Created", exact: true }).uncheck();

    await expect(page.getByRole("columnheader", { name: "Created" })).toHaveCount(0);
    await expect(page).toHaveURL(/sort=createdAt(%3A|:)desc/);
    await expect(page.getByLabel("Sort by")).toHaveValue("createdAt:desc");
    const rowsAfter = await page.getByRole("row").allTextContents();
    expect(rowsAfter.findIndex((t) => t.includes(newer.name))).toBeLessThan(
      rowsAfter.findIndex((t) => t.includes(older.name)),
    );

    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
  });

  test("Saved Views independence: hiding a column does not alter a Saved View, and applying a Saved View does not alter column visibility", async ({ page }) => {
    const marker = uniqueName("E2E-COL-C-SV");
    const matching = await seedClient({ name: `${marker}-001` });
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto("/clients");
    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Phone", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Phone" })).toHaveCount(0);

    await page.goto(`/clients?q=${marker}`);
    await expect(page.getByRole("row", { name: new RegExp(matching.name) })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Phone" })).toHaveCount(0);

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto("/clients");
    const savedViewsSelect = page.getByRole("combobox", { name: "Saved views" });
    await savedViewsSelect.selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(new RegExp(`q=${marker}`));
    await expect(page.getByRole("row", { name: new RegExp(matching.name) })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Phone" })).toHaveCount(0);

    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page.getByRole("columnheader", { name: "Phone" })).toBeVisible();
    await expect(savedViewsSelect.getByRole("option", { name: viewName, exact: true })).toHaveCount(1);

    // Cleanup the temporary Saved View. Scoped to the confirm dialog --
    // an unscoped "Delete" also matches the seeded Client's own
    // row-level DeleteButton elsewhere on the page.
    await savedViewsSelect.selectOption({ label: viewName });
    await page.getByRole("button", { name: "Delete saved view" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  });

  test("stale custom-status compatibility: Column Customization remains usable while an unresolved status key is active, and never broadens or clears the stale intent", async ({ page }) => {
    const STALE_KEY = "totally-made-up-status-key-e3b";
    await seedClient({ status: "ACTIVE" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/clients?status=${STALE_KEY}`);

    await expect(page).toHaveURL(new RegExp(`status=${STALE_KEY}`));
    // Scoped to the filter bar's own <form> -- the Columns panel (a
    // portal to document.body, outside this form) also has a "Status"
    // checkbox label ("Status Always shown"), which an unscoped
    // getByLabel("Status") would ambiguously match once that panel is
    // open.
    const statusSelect = page.locator("form").getByLabel("Status");
    await expect(statusSelect).toHaveValue(STALE_KEY);
    await expect(statusSelect.locator("option", { hasText: "Unavailable status" })).toHaveCount(1);
    await expect(page.getByText("No matching clients")).toBeVisible();

    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Phone", exact: true }).uncheck();
    await expect(page).toHaveURL(new RegExp(`status=${STALE_KEY}`));
    await expect(statusSelect).toHaveValue(STALE_KEY);

    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page).toHaveURL(new RegExp(`status=${STALE_KEY}`));
    await expect(statusSelect).toHaveValue(STALE_KEY);
    await expect(page.getByText("No matching clients")).toBeVisible();
  });

  test("tag-filter compatibility: hiding the Tags column does not hide the Tag filter control, and the filter still narrows correctly", async ({ page }) => {
    const marker = uniqueName("E2E-COL-C-TAG");
    const tagged = await seedClient({ name: `${marker}-tagged` });
    const untagged = await seedClient({ name: `${marker}-untagged` });
    const tag = await seedTagWithAssignment(tagged.id, uniqueName("E2E-COL-C-Tag"));

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/clients?q=${marker}`);
    await expect(page.getByRole("row", { name: new RegExp(tagged.name) })).toContainText(tag.name);

    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Tags", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Tags" })).toHaveCount(0);

    // Scoped to the filter bar's own <form> -- the Columns panel's own
    // "Tags" checkbox label is a substring match for "Tag" under
    // getByLabel's default non-exact matching, once that panel is open.
    const tagSelect = page.locator("form").getByLabel("Tag");
    await expect(tagSelect).toBeVisible();
    await tagSelect.selectOption({ label: tag.name });
    await expect(page).toHaveURL(/tag=/);
    await expect(page.getByRole("row", { name: new RegExp(tagged.name) })).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(untagged.name) })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Tags" })).toHaveCount(0);

    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
  });

  test("390x900 mobile: hiding Phone on desktop does not remove the mobile RecordCard's own Phone field, and the Columns trigger is absent", async ({ page }) => {
    const client = await seedClient({ phone: "555-0199" });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/clients");
    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Phone", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Phone" })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.reload();

    await expect(page.getByRole("table")).toBeHidden();
    await expect(page.getByRole("button", { name: "Columns" })).toHaveCount(0);

    const card = page.locator("li", { hasText: client.name });
    await expect(card.getByText("Phone", { exact: true })).toBeVisible();
    await expect(card.getByText("Company", { exact: true })).toBeVisible();
    await expect(card.getByText("Email", { exact: true })).toBeVisible();
    await expect(card.getByText("Status", { exact: true })).toBeVisible();
    await expect(card.getByText("Tags", { exact: true })).toBeVisible();
    await expect(card.getByText("Created", { exact: true })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test("no-results compatibility: the Columns control remains present and functional when a filter yields zero matching clients", async ({ page }) => {
    const marker = uniqueName("E2E-COL-C-NORESULTS");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/clients?q=${marker}`);

    await expect(page.getByText("No matching clients")).toBeVisible();
    await expect(page.getByRole("button", { name: "Columns" })).toBeVisible();

    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Phone", exact: true }).uncheck();
    await expect(page.getByText("No matching clients")).toBeVisible();

    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
  });

  test("hydration safety: first-ever load of /clients in a fresh browser context, with a hidden-column preference already persisted, produces no React hydration mismatch", async ({ page }) => {
    // Listener registration MUST precede the first navigation -- the
    // Contracts hydration defect investigation proved that attaching
    // listeners only around a later reload() silently misses a
    // first-load-only error. Every other Client Column Customization
    // test in this file navigates AFTER its own `beforeEach`'s
    // `actAsOwner` call with no prior page load in the same browser
    // context, so this is already each test's own first navigation --
    // this test makes that property, and a PRE-SEEDED hidden-column
    // preference (proving the new ClientDesktopTable Client Component
    // boundary itself doesn't reintroduce a hydration mismatch, and that
    // `client.createdAt.toLocaleDateString()` still runs server-side
    // only), an explicit assertion.
    const client = await seedClient();

    await page.addInitScript(
      ({ key, value }) => {
        window.localStorage.setItem(key, value);
      },
      {
        key: `aqenra:table-columns:v1:${fixtures.orgA.id}:${fixtures.owner.id}:clients`,
        value: JSON.stringify({ version: 1, hiddenIds: ["phone"] }),
      },
    );

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/clients");

    const row = page.getByRole("row", { name: new RegExp(client.name) });
    await expect(row).toBeVisible();
    // The pre-seeded preference actually took effect on first paint --
    // not a vacuous pass because the column was never really hidden.
    await expect(page.getByRole("columnheader", { name: "Phone" })).toHaveCount(0);

    const hydrationRelated = [...consoleErrors, ...pageErrors].filter((text) =>
      /hydrat|#418|did not match|server-rendered/i.test(text),
    );
    expect(hydrationRelated).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
