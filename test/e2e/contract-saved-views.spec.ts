import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Tables Improvement Slice D1 — Saved Views V1, Contracts pilot. Real
 * browser coverage for Active/Archived Save+Apply and — the one
 * mandatory regression this slice exists to protect (locked spec
 * §29) — a stale Client filter surviving a full Save→Apply round-trip
 * and still rendering fail-closed via the already-shipped "Unavailable
 * client" sentinel. Domain-layer correctness itself (sorting,
 * bulk-archive, the sentinel's own rendering rules) is already
 * exhaustively covered elsewhere (contracts-table-workflow.spec.ts,
 * contracts-bulk-workflow.spec.ts, contract-stale-entity-filter.spec.ts)
 * and is not re-derived here.
 */

let fixtures: TestFixtures;
let seededContractIds: string[] = [];

const STALE_UUID = "00000000-0000-0000-0000-000000000000";

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

async function seedContract(overrides: Record<string, unknown> = {}): Promise<{ id: string; contractNumber: string }> {
  const contractNumber = (overrides.contractNumber as string) ?? uniqueMarker("E2E-SVC");
  const created = await dbQuery<{ id: string; contractNumber: string }>("contract", "create", {
    data: {
      title: "Saved Views Test Contract",
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

test.describe("Contract Saved Views (Tables Improvement Slice D1)", () => {
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

  test("Active view: save a q+status+sort combination, apply from a different state restores it exactly, and it survives a full reload", async ({ page }) => {
    const marker = uniqueMarker("E2E-SVC-ACTIVE");
    const matching = await seedContract({ contractNumber: `${marker}-001`, status: "DRAFT" });

    await page.goto(`/contracts?q=${marker}&status=DRAFT&sort=issueDate:asc`);
    await expect(page.getByRole("row", { name: new RegExp(matching.contractNumber) })).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} active view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Navigate to an unrelated state, then apply from there.
    await page.goto("/contracts?status=ACCEPTED");
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(new RegExp(`q=${marker}`));
    await expect(page).toHaveURL(/status=DRAFT/);
    await expect(page).toHaveURL(/sort=issueDate%3Aasc/);
    await expect(page.getByRole("link", { name: "Draft", exact: true })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("row", { name: new RegExp(matching.contractNumber) })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("combobox", { name: "Saved views" }).getByRole("option", { name: viewName, exact: true })).toHaveCount(1);
  });

  test("Archived view: save while viewing Archived, apply restores the Archived state with no bulk-selection controls and unchanged per-row View+Restore", async ({ page }) => {
    const marker = uniqueMarker("E2E-SVC-ARCHIVED");
    const archived = await seedContract({ contractNumber: `${marker}-001`, status: "DRAFT", archivedAt: new Date().toISOString() });

    await page.goto(`/contracts?q=${marker}&archived=1`);
    await expect(page.getByRole("row", { name: new RegExp(archived.contractNumber) })).toBeVisible();
    // No bulk-selection checkboxes on the Archived view.
    await expect(page.getByRole("checkbox")).toHaveCount(0);

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = `${marker} archived view`;
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Navigate to the Active view, then apply the Archived saved view from there.
    await page.goto("/contracts");
    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    await expect(page).toHaveURL(/archived=1/);
    await expect(page.getByRole("row", { name: new RegExp(archived.contractNumber) })).toBeVisible();
    // Bulk selection stays absent on the restored Archived view.
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    // Existing per-row behavior (View, not Edit; Restore in the overflow menu) is unchanged.
    await expect(page.getByRole("link", { name: "View" }).first()).toBeVisible();
    await page.getByRole("button", { name: new RegExp(`More actions for contract ${archived.contractNumber}`) }).click();
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
  });

  test("stale Client filter: survives a full Save -> Apply round-trip, still fail-closed -- 'Unavailable client' renders again, zero rows, never silently broadened", async ({ page }) => {
    const other = await seedContract(); // an ordinary contract that must stay invisible under the stale filter

    await page.goto(`/contracts?client=${STALE_UUID}`);
    await expect(page.getByLabel("Client")).toHaveValue(STALE_UUID);
    await expect(page.getByLabel("Client").locator("option", { hasText: "Unavailable client" })).toHaveCount(1);
    await expect(page.getByText("No matching contracts")).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    const viewName = uniqueMarker("E2E-SVC-STALE") + " view";
    await page.getByLabel("View name").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Navigate to an entirely ordinary state (the stale id must not leak
    // forward from here -- it only comes back because the SAVED VIEW
    // itself still contains it).
    await page.goto("/contracts");
    await expect(page.getByRole("row", { name: new RegExp(other.contractNumber) })).toBeVisible();

    await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: viewName });
    await page.getByRole("link", { name: "Apply" }).click();

    // The stale client id is back in the URL -- never silently dropped
    // during Save or Apply.
    await expect(page).toHaveURL(new RegExp(`client=${STALE_UUID}`));
    // The fail-closed sentinel renders again, from the exact same
    // already-shipped mechanism (buildContractEntityFilterOptions) --
    // this Saved View integration adds no parallel/weaker path.
    await expect(page.getByLabel("Client")).toHaveValue(STALE_UUID);
    await expect(page.getByLabel("Client").locator("option", { hasText: "Unavailable client" })).toHaveCount(1);
    // Zero rows -- the ordinary contract from the "away" state is not
    // resurrected; the filter was never broadened to "All clients."
    await expect(page.getByText("No matching contracts")).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(other.contractNumber) })).toHaveCount(0);
  });

  test("390px mobile: the Contracts Saved Views control is usable and causes no destructive horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const marker = uniqueMarker("E2E-SVC-MOBILE");
    await seedContract({ contractNumber: `${marker}-001` });

    await page.goto(`/contracts?q=${marker}`);
    await expect(page.getByRole("button", { name: "Save current view" })).toBeVisible();

    await page.getByRole("button", { name: "Save current view" }).click();
    await page.getByLabel("View name").fill(`${marker} mobile view`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Saved views" })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);

    await expect(page.getByLabel("Client")).toBeVisible();
  });
});
