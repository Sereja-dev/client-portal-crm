import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Tables Improvement Slice E3C — Column Customization V1, Projects
 * pilot. Reuses the shared E1/E2/E3A/E3B primitive (storage/hook/
 * provider/ColumnVisibilityControl) completely unmodified except the
 * surface union widening -- this file proves Projects' own integration
 * of it: placement, default columns, mandatory protection (including
 * that Name -- the sole Project Hub navigation entry point on this
 * list -- can never be hidden), hide/persistence, sort preservation
 * (Sort-by select only -- Projects has no clickable sortable headers),
 * Saved Views independence, stale custom-status fail-closed
 * compatibility, mobile non-impact, first-load hydration safety, and
 * no-results compatibility. Domain-layer correctness (custom-status
 * resolution, the fail-closed query itself, Saved Views lifecycle,
 * the Project Hub page itself) is already exhaustively covered
 * elsewhere (test/e2e/projects-stale-status-filter.spec.ts,
 * test/e2e/project-saved-views.spec.ts, test/e2e/project-hub.spec.ts)
 * and is not re-derived here -- `project-hub.spec.ts`'s own "Projects
 * list: the Name link opens the Hub" test is run as part of this
 * slice's own regression batch rather than duplicated. Projects has no
 * bulk selection, no sticky header, no tag filter, and no Active/
 * Archived state at all (E3C readiness audit §Q/§R/§P), so none of
 * those categories is tested here -- there is nothing of that shape to
 * protect. Each test gets a fresh Playwright browser context (fresh
 * localStorage), so no explicit cross-test column-preference cleanup
 * is needed.
 */

let fixtures: TestFixtures;
let seededProjectIds: string[] = [];

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

async function seedProject(overrides: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
  const name = (overrides.name as string) ?? uniqueName("E2E-COL-Project");
  const created = await dbQuery<{ id: string; name: string }>("project", "create", {
    data: {
      organizationId: fixtures.orgA.id,
      clientId: fixtures.clientA.id,
      ownerId: fixtures.owner.id,
      ...overrides,
      name,
    },
  });
  seededProjectIds.push(created.id);
  return created;
}

async function cleanupSeeded(): Promise<void> {
  if (seededProjectIds.length > 0) {
    await dbQuery("project", "deleteMany", { where: { id: { in: seededProjectIds } } });
    seededProjectIds = [];
  }
}

/** Idempotent -- see invoice/contract/quote/client-column-customization.spec.ts's own identical reasoning. */
async function openColumnsPanel(page: Page): Promise<void> {
  const panel = page.getByRole("group", { name: "Column visibility" });
  if (await panel.isVisible()) {
    return;
  }
  await page.getByRole("button", { name: "Columns" }).click();
  await expect(panel).toBeVisible();
}

test.describe("Project Column Customization (Tables Improvement Slice E3C)", () => {
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

  test("placement: Saved Views, Columns control, and Search/Status/Sort all present together; existing Project list semantics unchanged", async ({ page }) => {
    const project = await seedProject();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/projects");

    await expect(page.getByRole("button", { name: "Save current view" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Columns" })).toBeVisible();
    await expect(page.locator("form").getByLabel("Search")).toBeVisible();
    await expect(page.locator("form").getByLabel("Status")).toBeVisible();
    await expect(page.getByLabel("Sort by")).toBeVisible();

    const row = page.getByRole("row", { name: new RegExp(project.name) });
    await expect(row).toBeVisible();
  });

  test("default state (fresh browser, no stored preference): all seven canonical Project desktop columns are present, matching today's table exactly", async ({ page }) => {
    await seedProject();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/projects");

    const headerNames = await page.getByRole("columnheader").allTextContents();
    expect(headerNames.map((t) => t.trim())).toEqual([
      "Name",
      "Client",
      "Status",
      "Start date",
      "End date",
      "Created",
      "Actions",
    ]);
  });

  test("picker: mandatory Name/Status/Actions checked+disabled+'Always shown'; optional Client/Start date/End date/Created toggleable; Name's own Hub link remains intact", async ({ page }) => {
    const project = await seedProject();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/projects");

    const nameLink = page.getByRole("link", { name: project.name });
    await expect(nameLink).toHaveAttribute("href", `/projects/${project.id}`);

    await openColumnsPanel(page);
    const panel = page.getByRole("group", { name: "Column visibility" });

    for (const label of ["Name", "Status", "Actions"]) {
      const checkbox = page.getByRole("checkbox", { name: new RegExp(label) });
      await expect(checkbox).toBeChecked();
      await expect(checkbox).toBeDisabled();
    }
    await expect(page.getByText("Always shown")).toHaveCount(3);

    for (const label of ["Client", "Start date", "End date", "Created"]) {
      const checkbox = page.getByRole("checkbox", { name: label, exact: true });
      await expect(checkbox).toBeChecked();
      await expect(checkbox).toBeEnabled();
    }

    // Exactly 7 checkboxes -- no selection/bulk checkbox exists on Projects.
    await expect(panel.getByRole("checkbox")).toHaveCount(7);

    // The Hub link itself is unaffected by having the picker open.
    await expect(nameLink).toHaveAttribute("href", `/projects/${project.id}`);
  });

  test("hide Client: header and cells disappear, mandatory columns (including Name's Hub link) remain, and the preference survives a reload; Reset restores it", async ({ page }) => {
    const project = await seedProject();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/projects");

    const row = page.getByRole("row", { name: new RegExp(project.name) });
    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Client", exact: true }).uncheck();

    await expect(page.getByRole("columnheader", { name: "Client" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Actions" })).toBeVisible();
    // 7 columns - 1 hidden = 6 cells.
    await expect(row.getByRole("cell")).toHaveCount(6);
    await expect(row.getByRole("link", { name: project.name })).toHaveAttribute("href", `/projects/${project.id}`);

    await page.reload();
    await expect(page.getByRole("columnheader", { name: "Client" })).toHaveCount(0);
    await expect(row.getByRole("cell")).toHaveCount(6);

    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page.getByRole("columnheader", { name: "Client" })).toBeVisible();
  });

  test("hiding the currently-sorted column (Created) does not reset or alter the active sort -- Projects sorts only via the Sort-by select", async ({ page }) => {
    const older = await seedProject({ name: uniqueName("E2E-COL-P-SORT-OLD"), createdAt: "2020-01-01T00:00:00.000Z" });
    const newer = await seedProject({ name: uniqueName("E2E-COL-P-SORT-NEW"), createdAt: "2026-01-01T00:00:00.000Z" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/projects?q=E2E-COL-P-SORT&sort=createdAt:desc`);

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
    const marker = uniqueName("E2E-COL-P-SV");
    const matching = await seedProject({ name: `${marker}-001` });
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto("/projects");
    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Client", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Client" })).toHaveCount(0);

    await page.goto(`/projects?q=${marker}`);
    await expect(page.getByRole("row", { name: new RegExp(matching.name) })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Client" })).toHaveCount(0);

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto("/projects");
    const savedViewsSelect = page.getByRole("combobox", { name: "Saved views" });
    await savedViewsSelect.selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(new RegExp(`q=${marker}`));
    await expect(page.getByRole("row", { name: new RegExp(matching.name) })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Client" })).toHaveCount(0);

    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page.getByRole("columnheader", { name: "Client" })).toBeVisible();
    await expect(savedViewsSelect.getByRole("option", { name: viewName, exact: true })).toHaveCount(1);

    // Cleanup the temporary Saved View. Scoped to the confirm dialog --
    // an unscoped "Delete" also matches the seeded Project's own
    // row-level DeleteButton elsewhere on the page.
    await savedViewsSelect.selectOption({ label: viewName });
    await page.getByRole("button", { name: "Delete saved view" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  });

  test("stale custom-status compatibility: Column Customization remains usable while an unresolved status key is active, and never broadens or clears the stale intent", async ({ page }) => {
    const STALE_KEY = "totally-made-up-status-key-e3c";
    await seedProject();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/projects?status=${STALE_KEY}`);

    await expect(page).toHaveURL(new RegExp(`status=${STALE_KEY}`));
    const statusSelect = page.locator("form").getByLabel("Status");
    await expect(statusSelect).toHaveValue(STALE_KEY);
    await expect(statusSelect.locator("option", { hasText: "Unavailable status" })).toHaveCount(1);
    await expect(page.getByText("No matching projects")).toBeVisible();

    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Client", exact: true }).uncheck();
    await expect(page).toHaveURL(new RegExp(`status=${STALE_KEY}`));
    await expect(statusSelect).toHaveValue(STALE_KEY);

    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page).toHaveURL(new RegExp(`status=${STALE_KEY}`));
    await expect(statusSelect).toHaveValue(STALE_KEY);
    await expect(page.getByText("No matching projects")).toBeVisible();
  });

  test("390x900 mobile: hiding Client on desktop does not remove the mobile RecordCard's own Client field, and the Columns trigger is absent", async ({ page }) => {
    const project = await seedProject();

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/projects");
    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Client", exact: true }).uncheck();
    await expect(page.getByRole("columnheader", { name: "Client" })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.reload();

    await expect(page.getByRole("table")).toBeHidden();
    await expect(page.getByRole("button", { name: "Columns" })).toHaveCount(0);

    const card = page.locator("li", { hasText: project.name });
    await expect(card.getByText("Client", { exact: true })).toBeVisible();
    await expect(card.getByText("Status", { exact: true })).toBeVisible();
    await expect(card.getByText("Start date", { exact: true })).toBeVisible();
    await expect(card.getByText("End date", { exact: true })).toBeVisible();
    await expect(card.getByText("Created", { exact: true })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test("no-results compatibility: the Columns control remains present and functional when a filter yields zero matching projects", async ({ page }) => {
    const marker = uniqueName("E2E-COL-P-NORESULTS");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/projects?q=${marker}`);

    await expect(page.getByText("No matching projects")).toBeVisible();
    await expect(page.getByRole("button", { name: "Columns" })).toBeVisible();

    await openColumnsPanel(page);
    await page.getByRole("checkbox", { name: "Client", exact: true }).uncheck();
    await expect(page.getByText("No matching projects")).toBeVisible();

    await openColumnsPanel(page);
    await page.getByRole("button", { name: "Reset to default" }).click();
  });

  test("hydration safety: first-ever load of /projects in a fresh browser context, with a hidden-column preference already persisted, produces no React hydration mismatch", async ({ page }) => {
    // Listener registration MUST precede the first navigation -- the
    // Contracts hydration defect investigation proved that attaching
    // listeners only around a later reload() silently misses a
    // first-load-only error. Every other Project Column Customization
    // test in this file navigates AFTER its own `beforeEach`'s
    // `actAsOwner` call with no prior page load in the same browser
    // context, so this is already each test's own first navigation --
    // this test makes that property, and a PRE-SEEDED hidden-column
    // preference (proving the new ProjectDesktopTable Client Component
    // boundary itself doesn't reintroduce a hydration mismatch, and
    // that date/status formatting still runs server-side only), an
    // explicit assertion.
    const project = await seedProject();

    await page.addInitScript(
      ({ key, value }) => {
        window.localStorage.setItem(key, value);
      },
      {
        key: `aqenra:table-columns:v1:${fixtures.orgA.id}:${fixtures.owner.id}:projects`,
        value: JSON.stringify({ version: 1, hiddenIds: ["client"] }),
      },
    );

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/projects");

    const row = page.getByRole("row", { name: new RegExp(project.name) });
    await expect(row).toBeVisible();
    // The pre-seeded preference actually took effect on first paint --
    // not a vacuous pass because the column was never really hidden.
    await expect(page.getByRole("columnheader", { name: "Client" })).toHaveCount(0);

    const hydrationRelated = [...consoleErrors, ...pageErrors].filter((text) =>
      /hydrat|#418|did not match|server-rendered/i.test(text),
    );
    expect(hydrationRelated).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
