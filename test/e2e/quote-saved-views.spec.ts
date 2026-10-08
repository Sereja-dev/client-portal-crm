import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Tables Improvement Slice D2A — Saved Views V1, Quotes pilot. Real
 * browser coverage for Save/Apply/Rename/Delete, reload persistence,
 * explicit fresh-mount selection (the exact D1 bug class this slice
 * must not reintroduce), namespace isolation against Invoices/
 * Contracts, Archived and derived-status (EXPIRED/CONVERTED)
 * round-trips, page exclusion, and mobile. Domain-layer correctness
 * (status/target/archived filtering itself) is already exhaustively
 * covered elsewhere (test/e2e/quotes.spec.ts, test/integration/quotes/
 * *.test.ts) and is not re-derived here. The shared Saved Views hook/
 * store/control are already exhaustively covered by their own D1 test
 * suites — this file only proves Quotes' own integration of them.
 */

let fixtures: TestFixtures;
let seededQuoteIds: string[] = [];

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

async function seedQuote(overrides: Record<string, unknown> = {}): Promise<{ id: string; number: string }> {
  const number = (overrides.number as string) ?? uniqueMarker("E2E-SV-QUOTE");
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

async function cleanupSeededQuotes(): Promise<void> {
  if (seededQuoteIds.length > 0) {
    await dbQuery("quote", "deleteMany", { where: { id: { in: seededQuoteIds } } });
    seededQuoteIds = [];
  }
}

test.describe("Quote Saved Views (Tables Improvement Slice D2A)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test.afterEach(async () => {
    await cleanupSeededQuotes();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("full lifecycle: Save a meaningful filter/sort/target combination, Apply from a different state restores it exactly, Rename persists, Delete requires confirmation and removes it -- all surviving a full page reload", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-LIFECYCLE");
    const matching = await seedQuote({ number: `${marker}-001`, status: "SENT" });

    await page.goto(`/quotes?q=${marker}&status=SENT&targetType=CLIENT&sort=total:desc`);
    await expect(page.getByText(matching.number).first()).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const savedViewsSelect = page.getByRole("combobox", { name: "Saved views" });
    await expect(savedViewsSelect).toBeVisible();
    await expect(savedViewsSelect.getByRole("option", { name: viewName, exact: true })).toHaveCount(1);

    // Navigate to an unrelated state, then apply from there.
    await page.goto("/quotes?status=DECLINED");
    await savedViewsSelect.selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(new RegExp(`q=${marker}`));
    await expect(page).toHaveURL(/status=SENT/);
    await expect(page).toHaveURL(/targetType=CLIENT/);
    await expect(page).toHaveURL(/sort=total%3Adesc/);
    await expect(page.getByText(matching.number).first()).toBeVisible();

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
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText(`Deleted "${renamedTo}"`)).toBeVisible();

    await page.reload();
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save current view" })).toBeVisible();
  });

  test("explicit-selection regression: a fresh mount with two existing views never implicitly selects the oldest one -- Apply is unavailable until an explicit choice, and applying the SECOND view restores the second view, not the first", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-EXPLICIT");
    const firstMatch = await seedQuote({ number: `${marker}-FIRST`, status: "DRAFT" });
    const secondMatch = await seedQuote({ number: `${marker}-SECOND`, status: "APPROVED" });

    await page.goto(`/quotes?q=${marker}&status=DRAFT`);
    await page.getByRole("button", { name: "Save current view" }).click();
    await page.getByLabel("View name").fill("FIRST Quote View");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto(`/quotes?q=${marker}&status=APPROVED`);
    await page.getByRole("button", { name: "Save current view" }).click();
    await page.getByLabel("View name").fill("SECOND Quote View");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Fresh navigation back -- no explicit reselect yet.
    await page.goto("/quotes");

    const savedViewsSelect = page.getByRole("combobox", { name: "Saved views" });
    await expect(savedViewsSelect).toHaveValue("");
    await expect(savedViewsSelect.getByRole("option", { name: "Select a saved view…", exact: true })).toHaveCount(1);
    // Apply must not be offered at all until an explicit choice is made.
    await expect(page.getByRole("link", { name: "Apply" })).toHaveCount(0);

    // Explicitly choose the SECOND view, not the first/oldest.
    await savedViewsSelect.selectOption({ label: "SECOND Quote View" });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(/status=APPROVED/);
    await expect(page).not.toHaveURL(/status=DRAFT/);
    await expect(page.getByText(secondMatch.number).first()).toBeVisible();
    await expect(page.getByText(firstMatch.number)).toHaveCount(0);
  });

  test("Archived view: save while viewing Archived, apply restores the Archived state", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-ARCHIVED");
    const archived = await seedQuote({ number: `${marker}-001`, status: "DRAFT", archivedAt: new Date().toISOString() });

    await page.goto(`/quotes?q=${marker}&archived=1`);
    await expect(page.getByText(archived.number).first()).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} archived view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto("/quotes");
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(/archived=1/);
    await expect(page.getByText(archived.number).first()).toBeVisible();
  });

  test("derived status round-trip: saving and applying EXPIRED restores the same derived canonical filter", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-EXPIRED");
    const expiredQuote = await seedQuote({
      number: `${marker}-001`,
      status: "SENT",
      sentAt: new Date().toISOString(),
      validUntil: "2020-01-01T00:00:00.000Z",
    });

    await page.goto(`/quotes?q=${marker}&status=EXPIRED`);
    await expect(page.getByText(expiredQuote.number).first()).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} expired view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto("/quotes?status=DRAFT");
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(/status=EXPIRED/);
    await expect(page.getByText(expiredQuote.number).first()).toBeVisible();
  });

  test("page number is never saved -- applying a saved view created while on page 2 of a filtered result always lands on page 1", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-PAGE");
    for (let i = 0; i < 11; i++) {
      await seedQuote({ number: `${marker}-${String(i).padStart(3, "0")}` });
    }

    await page.goto(`/quotes?q=${marker}&page=2`);
    await expect(page.getByText("Page 2 of 2")).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} page-reset view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto("/quotes");
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).not.toHaveURL(/page=/);
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
  });

  test("namespace isolation: a Quotes-only view does not appear on Invoices or Contracts, and remains present when returning to Quotes", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-NAMESPACE");
    await seedQuote({ number: `${marker}-001` });

    await page.goto(`/quotes?q=${marker}`);
    const viewName = `${marker} namespace view`;
    await page.getByRole("button", { name: "Save current view" }).click();
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: viewName, exact: true })).toHaveCount(1);

    await page.goto("/invoices");
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);

    await page.goto("/contracts");
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);

    await page.goto(`/quotes?q=${marker}`);
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: viewName, exact: true })).toHaveCount(1);
  });

  test("namespace isolation (reverse): an Invoice-only saved view does not bleed into Quotes", async ({ page }) => {
    await page.goto("/invoices");
    const viewName = uniqueMarker("E2E-SV-INVOICE-ONLY") + " view";
    await page.getByRole("button", { name: "Save current view" }).click();
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: viewName, exact: true })).toHaveCount(1);

    await page.goto("/quotes");
    await expect(page.getByRole("combobox", { name: "Saved views" })).toHaveCount(0);

    // Clean up the Invoice-side smoke view.
    await page.goto("/invoices");
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("button", { name: "Delete saved view" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
  });

  test("hydration safety: a saved view appears after a full reload with no React hydration warning and no console error attributable to Saved Views", async ({ page }) => {
    const marker = uniqueMarker("E2E-SV-HYDRATE");
    await seedQuote({ number: `${marker}-001` });

    await page.goto(`/quotes?q=${marker}`);
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
    const matching = await seedQuote({ number: `${marker}-001` });

    await page.goto(`/quotes?q=${marker}`);
    await expect(page.getByRole("button", { name: "Save current view" })).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} mobile view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const savedViewsSelect = page.getByRole("combobox", { name: "Saved views" });
    await expect(savedViewsSelect).toBeVisible();

    await page.goto("/quotes");
    await savedViewsSelect.selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();
    // At 390px the desktop table is hidden (`hidden xl:block`) -- the
    // RecordCard, last in DOM order, is the actually-visible one here.
    await expect(page.getByText(matching.number).last()).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);

    // Quotes has two filters both labeled "Status" (the status enum
    // filter and the archived toggle, same pattern as Contracts) --
    // either one proves SearchFilterBar itself remains usable here.
    await expect(page.getByLabel("Status").first()).toBeVisible();
  });
});
