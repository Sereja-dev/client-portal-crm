import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Tables Improvement Slice D2B — Saved Views V1, Projects. Real browser
 * coverage for Save/Apply/Rename/Delete, reload persistence, explicit
 * fresh-mount selection (the exact D1 bug class this slice must not
 * reintroduce), namespace isolation against Clients/Invoices/
 * Contracts/Quotes, page exclusion, mobile, and the D2B-specific
 * requirement that a stale (never-existed) custom-status key stored in
 * a Saved View round-trips fail-closed (§11, intentional shipped
 * behavior, never broadens) and an archived-but-real status key
 * round-trips its real label/narrowing (§12). Domain-layer correctness
 * (status filtering itself, the fail-closed query logic) is already
 * exhaustively covered elsewhere (test/e2e/projects-stale-status-
 * filter.spec.ts, test/integration/projects/list-query.test.ts) and is
 * not re-derived here. The shared Saved Views hook/store/control are
 * already exhaustively covered by their own D1 test suites — this file
 * only proves Projects' own integration of them.
 */

let fixtures: TestFixtures;
let seededProjectIds: string[] = [];
let seededDefinitionIds: string[] = [];

function uniqueMarker(prefix: string): string {
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
  const name = (overrides.name as string) ?? uniqueMarker("E2E-SV-Project");
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

async function seedCustomStatusDefinition(overrides: Record<string, unknown>): Promise<{ id: string; key: string; label: string }> {
  const created = await dbQuery<{ id: string; key: string; label: string }>("customStatusDefinition", "create", {
    data: {
      organizationId: fixtures.orgA.id,
      entityType: "PROJECT",
      position: 500,
      ...overrides,
    },
  });
  seededDefinitionIds.push(created.id);
  return created;
}

async function cleanupSeeded(): Promise<void> {
  if (seededProjectIds.length > 0) {
    await dbQuery("project", "deleteMany", { where: { id: { in: seededProjectIds } } });
    seededProjectIds = [];
  }
  if (seededDefinitionIds.length > 0) {
    await dbQuery("customStatusDefinition", "deleteMany", { where: { id: { in: seededDefinitionIds } } });
    seededDefinitionIds = [];
  }
}

test.describe("Project Saved Views (Tables Improvement Slice D2B)", () => {
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

  test("full lifecycle: Save a q/status/sort combination, Apply from a different state restores it exactly, Rename persists, Delete requires confirmation and removes it -- all surviving a full page reload", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-LIFECYCLE");
    // CustomStatusDefinition.key is always compared lower-case (see
    // parseStatusKeyParam/buildProjectWhere's own .toLowerCase() calls) --
    // the marker itself has an uppercase prefix for readability, so the
    // key stored here must be explicitly lower-cased or it would never
    // actually resolve. Deliberately NOT isSystem: true -- this key is
    // an arbitrary test marker, not one of the four real system keys
    // (ACTIVE/LEAD/WON/LOST/IN_PROGRESS); buildProjectWhere's own
    // isSystem branch casts the key to a ProjectStatusValue enum literal
    // for its legacy-fallback OR clause, which would error against
    // Postgres for any non-enum string. A CUSTOM definition (the
    // default) only ever filters by statusDefinitionId, so an arbitrary
    // key is safe.
    const definition = await seedCustomStatusDefinition({ key: `${marker.toLowerCase()}-status`, label: "Lifecycle Status" });
    const matching = await seedProject({ name: marker, statusDefinitionId: definition.id });

    await page.goto(`/projects?q=${marker}&status=${definition.key}&sort=name:asc`);
    await expect(page.getByRole("link", { name: matching.name })).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const savedViewsSelect = page.getByRole("combobox", { name: "Saved views" });
    await expect(savedViewsSelect).toBeVisible();
    await expect(savedViewsSelect.getByRole("option", { name: viewName, exact: true })).toHaveCount(1);

    // Navigate to an unrelated state, then apply from there.
    await page.goto("/projects?status=PLANNING");
    await savedViewsSelect.selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(new RegExp(`q=${marker}`));
    await expect(page).toHaveURL(new RegExp(`status=${definition.key}`));
    await expect(page).toHaveURL(/sort=name%3Aasc/);
    await expect(page.getByRole("link", { name: matching.name })).toBeVisible();

    await page.reload();
    await expect(savedViewsSelect.getByRole("option", { name: viewName, exact: true })).toHaveCount(1);

    // Rename.
    await savedViewsSelect.selectOption({ label: viewName });
    await page.getByRole("button", { name: "Rename saved view" }).click();
    const renamedTo = `${viewName} (renamed)`;
    await page.getByLabel("View name").fill(renamedTo);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(savedViewsSelect.getByRole("option", { name: renamedTo, exact: true })).toHaveCount(1);
    await expect(savedViewsSelect.getByRole("option", { name: viewName, exact: true })).toHaveCount(0);

    await page.reload();
    await expect(savedViewsSelect.getByRole("option", { name: renamedTo, exact: true })).toHaveCount(1);

    // Delete requires confirmation.
    await savedViewsSelect.selectOption({ label: renamedTo });
    await page.getByRole("button", { name: "Delete saved view" }).click();
    await expect(page.getByRole("heading", { name: "Delete saved view" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(savedViewsSelect.getByRole("option", { name: renamedTo, exact: true })).toHaveCount(1);

    await page.getByRole("button", { name: "Delete saved view" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText(`Deleted "${renamedTo}"`)).toBeVisible();

    await page.reload();
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save current view" })).toBeVisible();
  });

  test("explicit-selection regression: a fresh mount with two existing views never implicitly selects the oldest one -- Apply is unavailable until an explicit choice, and applying the SECOND view restores the second view, not the first", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-EXPLICIT");
    const first = await seedProject({ name: `${marker}-FIRST` });
    const second = await seedProject({ name: `${marker}-SECOND` });

    await page.goto(`/projects?q=${marker}-FIRST`);
    await page.getByRole("button", { name: "Save current view" }).click();
    await page.getByLabel("View name").fill("FIRST Project View");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto(`/projects?q=${marker}-SECOND`);
    await page.getByRole("button", { name: "Save current view" }).click();
    await page.getByLabel("View name").fill("SECOND Project View");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Fresh navigation back -- no explicit reselect yet.
    await page.goto("/projects");

    const savedViewsSelect = page.getByRole("combobox", { name: "Saved views" });
    await expect(savedViewsSelect).toHaveValue("");
    await expect(savedViewsSelect.getByRole("option", { name: "Select a saved view…", exact: true })).toHaveCount(1);
    // Apply must not be offered at all until an explicit choice is made.
    await expect(page.getByRole("link", { name: "Apply" })).toHaveCount(0);

    // Explicitly choose the SECOND view, not the first/oldest.
    await savedViewsSelect.selectOption({ label: "SECOND Project View" });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(new RegExp(`q=${marker}-SECOND`));
    await expect(page.getByRole("link", { name: second.name })).toBeVisible();
    await expect(page.getByRole("link", { name: first.name })).toHaveCount(0);
  });

  test("stale custom-status round-trip (D2B §11, intentional): a Saved View storing a never-existed status key preserves it verbatim on Apply -- URL carries the stale key, the sentinel renders, zero rows, never broadens to all projects", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-STALE");
    // Lower-cased for the identical reason as the definition key above --
    // listParams.status is always lower-cased on parse, so the asserted
    // URL/<select> value must match that lower-cased form exactly.
    const staleKey = `${marker.toLowerCase()}-never-existed`;
    const unrelated = await seedProject({ name: marker });

    await page.goto(`/projects?status=${staleKey}`);
    await expect(page.getByText("No matching projects")).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} stale view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Apply from an entirely different, non-empty state.
    await page.goto("/projects");
    await expect(page.getByRole("link", { name: unrelated.name })).toBeVisible();
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(new RegExp(`status=${staleKey}`));
    const statusSelect = page.getByLabel("Status");
    await expect(statusSelect).toHaveValue(staleKey);
    await expect(statusSelect.locator("option", { hasText: "Unavailable status" })).toHaveCount(1);
    await expect(page.getByText("No matching projects")).toBeVisible();
    // Never broadens to "all projects" -- the unrelated project must not reappear.
    await expect(page.getByRole("link", { name: unrelated.name })).toHaveCount(0);
  });

  test("archived-but-real status round-trip (D2B §12): a Saved View storing an archived status key still restores the real label and correct narrowing", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-ARCHSTAT");
    const definition = await seedCustomStatusDefinition({
      key: `${marker.toLowerCase()}-archived`,
      label: "Archived SV Status",
      archivedAt: new Date().toISOString(),
    });
    const matching = await seedProject({ name: marker, statusDefinitionId: definition.id });

    await page.goto(`/projects?status=${definition.key}`);
    await expect(page.getByRole("link", { name: matching.name })).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} archived view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto("/projects");
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(new RegExp(`status=${definition.key}`));
    const statusSelect = page.getByLabel("Status");
    await expect(statusSelect).toHaveValue(definition.key);
    await expect(statusSelect.locator("option", { hasText: "Unavailable status" })).toHaveCount(0);
    await expect(statusSelect.locator("option", { hasText: "Archived SV Status (archived)" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: matching.name })).toBeVisible();
  });

  test("page number is never saved -- applying a saved view created while on page 2 of a filtered result always lands on page 1", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-PAGE");
    for (let i = 0; i < 11; i++) {
      await seedProject({ name: `${marker}-${String(i).padStart(3, "0")}` });
    }

    await page.goto(`/projects?q=${marker}&page=2`);
    await expect(page.getByText("Page 2 of 2")).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} page-reset view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto("/projects");
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).not.toHaveURL(/page=/);
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
  });

  test("namespace isolation: a Projects-only view does not appear on Clients, Invoices, Contracts, or Quotes, and remains present when returning to Projects", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-NAMESPACE");
    await seedProject({ name: marker });

    await page.goto(`/projects?q=${marker}`);
    const viewName = `${marker} namespace view`;
    await page.getByRole("button", { name: "Save current view" }).click();
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: viewName, exact: true })).toHaveCount(1);

    await page.goto("/clients");
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);

    await page.goto("/invoices");
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);

    await page.goto("/contracts");
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);

    await page.goto("/quotes");
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);

    await page.goto(`/projects?q=${marker}`);
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: viewName, exact: true })).toHaveCount(1);
  });

  test("namespace isolation (reverse): a Clients-only saved view does not bleed into Projects", async ({ page }) => {
    await page.goto("/clients");
    const viewName = uniqueMarker("E2E-SV-CLIENT-ONLY") + " view";
    await page.getByRole("button", { name: "Save current view" }).click();
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: viewName, exact: true })).toHaveCount(1);

    await page.goto("/projects");
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);

    // Clean up the Client-side smoke view.
    await page.goto("/clients");
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("button", { name: "Delete saved view" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  });

  test("hydration safety: a saved view appears after a full reload with no React hydration warning and no console error attributable to Saved Views", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-HYDRATE");
    await seedProject({ name: marker });

    await page.goto(`/projects?q=${marker}`);
    await page.getByRole("button", { name: "Save current view" }).click();
    await page.getByLabel("View name").fill(`${marker} hydration view`);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.reload();
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: `${marker} hydration view`, exact: true })).toHaveCount(1);

    const hydrationRelated = [...consoleErrors, ...pageErrors].filter((text) => /hydrat|#418|did not match|server-rendered/i.test(text));
    expect(hydrationRelated).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("390px mobile: the Saved Views control is visible/usable, Save/explicit-select/Apply work, and no destructive horizontal overflow occurs", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const marker = uniqueMarker("E2E-SV-MOBILE");
    const matching = await seedProject({ name: marker });

    await page.goto(`/projects?q=${marker}`);
    await expect(page.getByRole("button", { name: "Save current view" })).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} mobile view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const savedViewsSelect = page.getByRole("combobox", { name: "Saved views" });
    await expect(savedViewsSelect).toBeVisible();

    await page.goto("/projects");
    await savedViewsSelect.selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();
    await expect(page.getByRole("link", { name: matching.name })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);

    await expect(page.getByLabel("Status")).toBeVisible();
  });
});
