import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Tables Improvement Slice D2B — Saved Views V1, Clients. Real browser
 * coverage for Save/Apply/Rename/Delete, reload persistence, explicit
 * fresh-mount selection (the exact D1 bug class this slice must not
 * reintroduce), namespace isolation against Invoices/Contracts/Quotes/
 * Projects, page exclusion, mobile, and the two D2B-specific
 * requirements: a stale (never-existed) custom-status key stored in a
 * Saved View round-trips fail-closed (§11, intentional shipped
 * behavior, never broadens) and an archived-but-real status key
 * round-trips its real label/narrowing (§12), plus a Tag round-trip
 * (§13). Domain-layer correctness (status/tag filtering itself, the
 * fail-closed query logic) is already exhaustively covered elsewhere
 * (test/e2e/clients-stale-status-filter.spec.ts,
 * test/integration/clients/list-query.test.ts, test/e2e/tags.spec.ts)
 * and is not re-derived here. The shared Saved Views hook/store/control
 * are already exhaustively covered by their own D1 test suites — this
 * file only proves Clients' own integration of them.
 */

let fixtures: TestFixtures;
let seededClientIds: string[] = [];
let seededDefinitionIds: string[] = [];
let seededTagIds: string[] = [];

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

async function seedClient(overrides: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
  const name = (overrides.name as string) ?? uniqueMarker("E2E-SV-Client");
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

async function seedCustomStatusDefinition(overrides: Record<string, unknown>): Promise<{ id: string; key: string; label: string }> {
  const created = await dbQuery<{ id: string; key: string; label: string }>("customStatusDefinition", "create", {
    data: {
      organizationId: fixtures.orgA.id,
      entityType: "CLIENT",
      position: 500,
      ...overrides,
    },
  });
  seededDefinitionIds.push(created.id);
  return created;
}

async function seedTagWithAssignment(entityId: string): Promise<{ id: string; name: string }> {
  const name = uniqueMarker("E2E-SV-Tag");
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

test.describe("Client Saved Views (Tables Improvement Slice D2B)", () => {
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

  test("full lifecycle: Save a q/status/tag/sort combination, Apply from a different state restores it exactly, Rename persists, Delete requires confirmation and removes it -- all surviving a full page reload", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-LIFECYCLE");
    // CustomStatusDefinition.key is always compared lower-case (see
    // parseStatusKeyParam/buildClientWhere's own .toLowerCase() calls) --
    // the marker itself has an uppercase prefix for readability, so the
    // key stored here must be explicitly lower-cased or it would never
    // actually resolve. Deliberately NOT isSystem: true -- this key is
    // an arbitrary test marker, not one of the four real system keys
    // (ACTIVE/LEAD/WON/LOST/IN_PROGRESS); buildClientWhere's own isSystem
    // branch casts the key to a ClientStatusValue enum literal for its
    // legacy-fallback OR clause, which would error against Postgres for
    // any non-enum string. A CUSTOM definition (the default) only ever
    // filters by statusDefinitionId, so an arbitrary key is safe.
    const definition = await seedCustomStatusDefinition({ key: `${marker.toLowerCase()}-status`, label: "Lifecycle Status" });
    const matching = await seedClient({ name: marker, statusDefinitionId: definition.id });
    const tag = await seedTagWithAssignment(matching.id);

    await page.goto(`/clients?q=${marker}&status=${definition.key}&tag=${tag.id}&sort=name:asc`);
    await expect(page.getByRole("link", { name: matching.name })).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const savedViewsSelect = page.getByRole("combobox", { name: "Saved views" });
    await expect(savedViewsSelect).toBeVisible();
    await expect(savedViewsSelect.getByRole("option", { name: viewName, exact: true })).toHaveCount(1);

    // Navigate to an unrelated state, then apply from there.
    await page.goto("/clients?status=ACTIVE");
    await savedViewsSelect.selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(new RegExp(`q=${marker}`));
    await expect(page).toHaveURL(new RegExp(`status=${definition.key}`));
    await expect(page).toHaveURL(new RegExp(`tag=${tag.id}`));
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
    const first = await seedClient({ name: `${marker}-FIRST` });
    const second = await seedClient({ name: `${marker}-SECOND` });

    await page.goto(`/clients?q=${marker}-FIRST`);
    await page.getByRole("button", { name: "Save current view" }).click();
    await page.getByLabel("View name").fill("FIRST Client View");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto(`/clients?q=${marker}-SECOND`);
    await page.getByRole("button", { name: "Save current view" }).click();
    await page.getByLabel("View name").fill("SECOND Client View");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Fresh navigation back -- no explicit reselect yet.
    await page.goto("/clients");

    const savedViewsSelect = page.getByRole("combobox", { name: "Saved views" });
    await expect(savedViewsSelect).toHaveValue("");
    await expect(savedViewsSelect.getByRole("option", { name: "Select a saved view…", exact: true })).toHaveCount(1);
    // Apply must not be offered at all until an explicit choice is made.
    await expect(page.getByRole("link", { name: "Apply" })).toHaveCount(0);

    // Explicitly choose the SECOND view, not the first/oldest.
    await savedViewsSelect.selectOption({ label: "SECOND Client View" });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(new RegExp(`q=${marker}-SECOND`));
    await expect(page.getByRole("link", { name: second.name })).toBeVisible();
    await expect(page.getByRole("link", { name: first.name })).toHaveCount(0);
  });

  test("stale custom-status round-trip (D2B §11, intentional): a Saved View storing a never-existed status key preserves it verbatim on Apply -- URL carries the stale key, the sentinel renders, zero rows, never broadens to all clients", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-STALE");
    // Lower-cased for the identical reason as the definition key above --
    // listParams.status is always lower-cased on parse, so the asserted
    // URL/<select> value must match that lower-cased form exactly.
    const staleKey = `${marker.toLowerCase()}-never-existed`;
    const unrelated = await seedClient({ name: marker, status: "ACTIVE" });

    await page.goto(`/clients?status=${staleKey}`);
    await expect(page.getByText("No matching clients")).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} stale view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Apply from an entirely different, non-empty state.
    await page.goto("/clients");
    await expect(page.getByRole("link", { name: unrelated.name })).toBeVisible();
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(new RegExp(`status=${staleKey}`));
    const statusSelect = page.getByLabel("Status");
    await expect(statusSelect).toHaveValue(staleKey);
    await expect(statusSelect.locator("option", { hasText: "Unavailable status" })).toHaveCount(1);
    await expect(page.getByText("No matching clients")).toBeVisible();
    // Never broadens to "all clients" -- the unrelated client must not reappear.
    await expect(page.getByRole("link", { name: unrelated.name })).toHaveCount(0);
  });

  test("archived-but-real status round-trip (D2B §12): a Saved View storing an archived status key still restores the real label and correct narrowing", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-ARCHSTAT");
    const definition = await seedCustomStatusDefinition({
      key: `${marker.toLowerCase()}-archived`,
      label: "Archived SV Status",
      archivedAt: new Date().toISOString(),
    });
    const matching = await seedClient({ name: marker, statusDefinitionId: definition.id });

    await page.goto(`/clients?status=${definition.key}`);
    await expect(page.getByRole("link", { name: matching.name })).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} archived view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto("/clients");
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(new RegExp(`status=${definition.key}`));
    const statusSelect = page.getByLabel("Status");
    await expect(statusSelect).toHaveValue(definition.key);
    await expect(statusSelect.locator("option", { hasText: "Unavailable status" })).toHaveCount(0);
    await expect(statusSelect.locator("option", { hasText: "Archived SV Status (archived)" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: matching.name })).toBeVisible();
  });

  test("tag round-trip (D2B §13): a Saved View storing a tag filter restores the same narrowing on Apply", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-TAG");
    const tagged = await seedClient({ name: marker });
    const untagged = await seedClient({ name: `${marker}-UNTAGGED` });
    const tag = await seedTagWithAssignment(tagged.id);

    await page.goto(`/clients?tag=${tag.id}`);
    await expect(page.getByRole("link", { name: tagged.name })).toBeVisible();
    await expect(page.getByRole("link", { name: untagged.name })).toHaveCount(0);

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} tag view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto("/clients");
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(new RegExp(`tag=${tag.id}`));
    await expect(page.getByRole("link", { name: tagged.name })).toBeVisible();
    await expect(page.getByRole("link", { name: untagged.name })).toHaveCount(0);
  });

  test("page number is never saved -- applying a saved view created while on page 2 of a filtered result always lands on page 1", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-PAGE");
    for (let i = 0; i < 11; i++) {
      await seedClient({ name: `${marker}-${String(i).padStart(3, "0")}` });
    }

    await page.goto(`/clients?q=${marker}&page=2`);
    await expect(page.getByText("Page 2 of 2")).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} page-reset view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto("/clients");
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).not.toHaveURL(/page=/);
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
  });

  test("namespace isolation: a Clients-only view does not appear on Projects, Invoices, Contracts, or Quotes, and remains present when returning to Clients", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-NAMESPACE");
    await seedClient({ name: marker });

    await page.goto(`/clients?q=${marker}`);
    const viewName = `${marker} namespace view`;
    await page.getByRole("button", { name: "Save current view" }).click();
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: viewName, exact: true })).toHaveCount(1);

    await page.goto("/projects");
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);

    await page.goto("/invoices");
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);

    await page.goto("/contracts");
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);

    await page.goto("/quotes");
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);

    await page.goto(`/clients?q=${marker}`);
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: viewName, exact: true })).toHaveCount(1);
  });

  test("namespace isolation (reverse): a Projects-only saved view does not bleed into Clients", async ({ page }) => {
    await page.goto("/projects");
    const viewName = uniqueMarker("E2E-SV-PROJECT-ONLY") + " view";
    await page.getByRole("button", { name: "Save current view" }).click();
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: viewName, exact: true })).toHaveCount(1);

    await page.goto("/clients");
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);

    // Clean up the Project-side smoke view.
    await page.goto("/projects");
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("button", { name: "Delete saved view" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  });

  test("hydration safety: a saved view appears after a full reload with no React hydration warning and no console error attributable to Saved Views", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-HYDRATE");
    await seedClient({ name: marker });

    await page.goto(`/clients?q=${marker}`);
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
    const matching = await seedClient({ name: marker });

    await page.goto(`/clients?q=${marker}`);
    await expect(page.getByRole("button", { name: "Save current view" })).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} mobile view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const savedViewsSelect = page.getByRole("combobox", { name: "Saved views" });
    await expect(savedViewsSelect).toBeVisible();

    await page.goto("/clients");
    await savedViewsSelect.selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();
    await expect(page.getByRole("link", { name: matching.name })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);

    await expect(page.getByLabel("Status")).toBeVisible();
  });
});
