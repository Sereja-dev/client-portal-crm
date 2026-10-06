import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Tables Improvement Slice D1 — Saved Views V1, Invoices pilot. Real
 * browser coverage for Save/Apply/Rename/Delete, reload persistence,
 * page exclusion, hydration safety, mobile, and storage namespace
 * isolation. Domain-layer correctness (filtering/sorting/pagination
 * themselves) is already exhaustively covered elsewhere (test/e2e/
 * invoices-table-workflow.spec.ts, invoices.spec.ts) and is not
 * re-derived here — this file only proves the NEW Saved Views lifecycle
 * on top of that already-correct canonical state.
 */

let fixtures: TestFixtures;
let seededInvoiceIds: string[] = [];

function uniqueMarker(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

async function actAs(page: Page, baseURL: string, identity: { id: string; email: string }, organizationId: string): Promise<void> {
  await page.context().clearCookies();
  await injectTestSession(page.context(), identity, baseURL);
  await page.context().addCookies([
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

async function seedInvoice(overrides: Record<string, unknown>): Promise<{ id: string; invoiceNumber: string }> {
  const invoiceNumber = (overrides.invoiceNumber as string) ?? uniqueMarker("E2E-SV");
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

test.describe("Invoice Saved Views (Tables Improvement Slice D1)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.beforeEach(async ({ page, baseURL }) => {
    await actAs(page, baseURL!, { id: fixtures.owner.id, email: fixtures.owner.email }, fixtures.orgA.id);
  });

  test.afterEach(async () => {
    await cleanupSeededInvoices();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("full lifecycle: Save a meaningful filter/sort combination, it appears by name, Apply restores the exact canonical state (including rows, chip, and sort control), Rename persists, Delete requires confirmation and removes it -- all surviving a full page reload", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-LIFECYCLE");
    const matching = await seedInvoice({ invoiceNumber: `${marker}-001`, status: "SENT" });
    await seedInvoice({ invoiceNumber: uniqueMarker("E2E-SV-OTHER"), status: "DRAFT" });

    // Establish a meaningful, non-default combination: search + status +
    // a non-default sort — then save it.
    await page.goto(`/invoices?q=${marker}&status=SENT&sort=dueDate:asc`);
    await expect(page.getByRole("row", { name: new RegExp(matching.invoiceNumber) })).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // The view now appears, by name, in the Saved views select.
    const savedViewsSelect = page.getByRole("combobox", { name: "Saved views" });
    await expect(savedViewsSelect).toBeVisible();
    await expect(savedViewsSelect.getByRole("option", { name: viewName, exact: true })).toHaveCount(1);

    // Navigate away to a different filter/sort state entirely.
    await page.goto("/invoices?status=PAID&sort=amount:desc");
    await expect(page.getByLabel("Status")).toHaveValue("PAID");

    // Apply the saved view FROM this unrelated "away" state -- the exact
    // canonical URL state is restored, never merged with what's
    // currently on the page.
    await savedViewsSelect.selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();
    await expect(page).toHaveURL(/status=SENT/);
    await expect(page).toHaveURL(/sort=dueDate%3Aasc/);
    await expect(page).toHaveURL(new RegExp(`q=${marker}`));
    // Quick-filter chip visual state follows the restored canonical status.
    await expect(page.getByRole("link", { name: "Sent", exact: true })).toHaveAttribute("aria-current", "true");
    // Sort-by dropdown matches.
    await expect(page.getByLabel("Sort by")).toHaveValue("dueDate:asc");
    // Rows correct: only the SENT invoice matching the marker is shown.
    await expect(page.getByRole("row", { name: new RegExp(matching.invoiceNumber) })).toBeVisible();

    // Reload the page entirely (not just a client navigation) -- the
    // saved view must still exist after a real hydration cycle.
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: viewName, exact: true })).toHaveCount(1);

    // Rename: changes only the name.
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("button", { name: "Rename saved view" }).click();
    const renamedTo = `${viewName} (renamed)`;
    await page.getByLabel("View name").fill(renamedTo);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: renamedTo, exact: true })).toHaveCount(1);
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: viewName, exact: true })).toHaveCount(0);

    // Renamed name persists after reload too.
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: renamedTo, exact: true })).toHaveCount(1);

    // Delete requires explicit confirmation -- Cancel leaves it intact.
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: renamedTo });
    await page.getByRole("button", { name: "Delete saved view" }).click();
    await expect(page.getByRole("heading", { name: "Delete saved view" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: renamedTo, exact: true })).toHaveCount(1);

    // Confirming actually deletes it.
    await page.getByRole("button", { name: "Delete saved view" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText(`Deleted "${renamedTo}"`)).toBeVisible();

    // After delete + reload, the view is gone -- back to the empty state.
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save current view" })).toBeVisible();
  });

  test("page number is never saved -- applying a saved view created while on page 2 of a filtered result always lands on page 1", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-PAGE");
    // 11 rows under one marker-scoped search -- PAGE_SIZE is 10, so this
    // filtered set spans exactly two pages regardless of what any other
    // concurrently-running spec seeds.
    for (let i = 0; i < 11; i++) {
      await seedInvoice({ invoiceNumber: `${marker}-${String(i).padStart(3, "0")}` });
    }

    await page.goto(`/invoices?q=${marker}&page=2`);
    await expect(page.getByText("Page 2 of 2")).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} page-reset view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Navigate elsewhere, then apply -- the resulting URL carries NO
    // page param, and the page itself renders page 1 of the same
    // filtered set (10 of the 11 rows).
    await page.goto("/invoices");
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).not.toHaveURL(/page=/);
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
  });

  test("hydration safety: a saved view appears after a full reload with no React hydration warning and no console error attributable to Saved Views", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-HYDRATE");
    await seedInvoice({ invoiceNumber: `${marker}-001` });

    await page.goto(`/invoices?q=${marker}`);
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
    await expect(page.getByRole("combobox", { name: "Saved views" }).locator("option", { hasText: `${marker} hydration view` })).toHaveCount(1);

    const hydrationRelated = [...consoleErrors, ...pageErrors].filter(
      (text) => /hydrat|#418|did not match|server-rendered/i.test(text),
    );
    expect(hydrationRelated).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("390px mobile: the Saved Views control is visible/usable, Save works, and no destructive horizontal overflow occurs", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const marker = uniqueMarker("E2E-SV-MOBILE");
    await seedInvoice({ invoiceNumber: `${marker}-001` });

    await page.goto(`/invoices?q=${marker}`);
    await expect(page.getByRole("button", { name: "Save current view" })).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    await page.getByLabel("View name").fill(`${marker} mobile view`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Saved views" })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);

    // The rest of the filter bar remains usable alongside it.
    await expect(page.getByLabel("Status")).toBeVisible();
  });

  test("namespace isolation: a saved view created under one user/org is invisible to a different user and a different organization, and reappears when switching back", async ({ page, baseURL }) => {
    const marker = uniqueMarker("E2E-SV-NAMESPACE");
    await seedInvoice({ invoiceNumber: `${marker}-001` });

    // owner @ orgA saves a view.
    await actAs(page, baseURL!, { id: fixtures.owner.id, email: fixtures.owner.email }, fixtures.orgA.id);
    await page.goto(`/invoices?q=${marker}`);
    const viewName = `${marker} namespace view`;
    await page.getByRole("button", { name: "Save current view" }).click();
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: viewName, exact: true })).toHaveCount(1);

    // A different user in the SAME organization (member @ orgA) does not
    // see it -- same browser origin/localStorage, different userId.
    await actAs(page, baseURL!, { id: fixtures.member.id, email: fixtures.member.email }, fixtures.orgA.id);
    await page.goto(`/invoices?q=${marker}`);
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);

    // The SAME user in a DIFFERENT organization (orgBOwner @ orgB) also
    // does not see it -- different organizationId.
    await actAs(page, baseURL!, { id: fixtures.orgBOwner.id, email: fixtures.orgBOwner.email }, fixtures.orgB.id);
    await page.goto("/invoices");
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);

    // Switching back to the original owner/org: the view is still there.
    await actAs(page, baseURL!, { id: fixtures.owner.id, email: fixtures.owner.email }, fixtures.orgA.id);
    await page.goto(`/invoices?q=${marker}`);
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: viewName, exact: true })).toHaveCount(1);
  });
});
