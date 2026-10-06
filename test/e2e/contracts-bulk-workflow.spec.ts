import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Tables Improvement Slice C (Contracts bulk pilot) — real browser
 * coverage for the one approved V1 bulk action: Archive, on the Active
 * list only. Domain-layer correctness (tenant scoping, archive
 * idempotency, partial success) is already exhaustively covered by
 * test/integration/contracts/bulk-archive.test.ts and is not re-derived
 * here; these tests prove the UI wires into that already-reviewed
 * Server Action correctly, truthfully, and conservatively (never a
 * misleading "select all").
 *
 * No confirmation dialog is used for bulk Archive, by design — matches
 * Tasks' own TaskBulkToolbar precedent exactly (direct Apply, no
 * ConfirmDialog, for any of its own bulk actions), and Archive is a
 * non-destructive, fully reversible visibility toggle (the existing
 * single-record confirmation copy itself says "it can be restored at
 * any time") — a confirmation step here would be MORE cautious than the
 * precedent this slice is told to treat as reference.
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

async function seedContract(overrides: Record<string, unknown>): Promise<{ id: string; contractNumber: string }> {
  const contractNumber = (overrides.contractNumber as string) ?? uniqueNumber("E2E-BULK-C");
  const created = await dbQuery<{ id: string; contractNumber: string }>("contract", "create", {
    data: {
      title: "Bulk Slice C Test Contract",
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

test.describe("Contract bulk workflow (Tables Improvement Slice C)", () => {
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

  test("Active view: selecting a Contract shows the BulkActionBar; Clear removes selection without mutating anything", async ({ page }) => {
    const prefix = uniqueNumber("E2E-BULK-CLEAR");
    const contract = await seedContract({ contractNumber: `${prefix}-0` });
    await page.goto(`/contracts?q=${prefix}`);

    const row = page.getByRole("row", { name: new RegExp(contract.contractNumber) });
    await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);

    await row.getByRole("checkbox", { name: `Select contract ${contract.contractNumber}` }).check();
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("1 selected");

    await bar.getByRole("button", { name: "Clear selection" }).click();
    await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("row", { name: new RegExp(contract.contractNumber) })).toBeVisible();
  });

  test("Active view: selecting multiple Contracts and applying Archive archives exactly the selected rows, leaving others untouched", async ({ page }) => {
    const prefix = uniqueNumber("E2E-BULK-ARCHIVE");
    const toArchive1 = await seedContract({ contractNumber: `${prefix}-0` });
    const toArchive2 = await seedContract({ contractNumber: `${prefix}-1` });
    const untouched = await seedContract({ contractNumber: `${prefix}-2` });
    await page.goto(`/contracts?q=${prefix}`);

    await page.getByRole("checkbox", { name: `Select contract ${toArchive1.contractNumber}` }).check();
    await page.getByRole("checkbox", { name: `Select contract ${toArchive2.contractNumber}` }).check();

    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar).toContainText("2 selected");
    await bar.getByRole("button", { name: "Apply" }).click();

    await expect(page.getByText(/Archived 2 contracts?/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);

    // The two archived rows disappear from Active; the untouched one remains.
    await expect(page.getByRole("row", { name: new RegExp(toArchive1.contractNumber) })).toHaveCount(0);
    await expect(page.getByRole("row", { name: new RegExp(toArchive2.contractNumber) })).toHaveCount(0);
    await expect(page.getByRole("row", { name: new RegExp(untouched.contractNumber) })).toBeVisible();

    // And they now appear in the Archived view.
    await page.goto(`/contracts?archived=1&q=${prefix}`);
    await expect(page.getByRole("row", { name: new RegExp(toArchive1.contractNumber) })).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(toArchive2.contractNumber) })).toBeVisible();
  });

  test("per-row Edit/View/overflow remains intact alongside the new selection checkboxes", async ({ page }) => {
    const prefix = uniqueNumber("E2E-BULK-ROWINTACT");
    const draft = await seedContract({ contractNumber: `${prefix}-0`, status: "DRAFT" });
    await page.goto(`/contracts?q=${prefix}`);

    const row = page.getByRole("row", { name: new RegExp(draft.contractNumber) });
    await expect(row.getByRole("link", { name: "Edit" })).toBeVisible();
    await expect(row.getByRole("button", { name: `More actions for contract ${draft.contractNumber}` })).toBeVisible();
    await expect(row.getByRole("checkbox", { name: `Select contract ${draft.contractNumber}` })).toBeVisible();
  });

  test("Archived view: no selection checkboxes and no BulkActionBar — bulk Archive is Active-only, no bulk Restore in this slice", async ({ page }) => {
    const prefix = uniqueNumber("E2E-BULK-ARCHIVEDVIEW");
    const archived = await seedContract({ contractNumber: `${prefix}-0`, archivedAt: new Date().toISOString() });
    await page.goto(`/contracts?archived=1&q=${prefix}`);

    const row = page.getByRole("row", { name: new RegExp(archived.contractNumber) });
    await expect(row).toBeVisible();
    await expect(row.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
    // Restore remains available via the existing per-row overflow menu.
    await row.getByRole("button", { name: `More actions for contract ${archived.contractNumber}` }).click();
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
  });

  test("changing a filter resets the selection — a stale selected id never silently survives into a new result set", async ({ page }) => {
    const prefix = uniqueNumber("E2E-BULK-FILTERRESET");
    const draft = await seedContract({ contractNumber: `${prefix}-0`, status: "DRAFT" });
    await page.goto(`/contracts?q=${prefix}`);

    await page.getByRole("checkbox", { name: `Select contract ${draft.contractNumber}` }).check();
    await expect(page.getByRole("region", { name: "Bulk actions" })).toBeVisible();

    await page.getByRole("link", { name: "Draft" }).click();
    await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
  });

  test("current-rendered-result semantics: with more than 50 rows rendered, select-all is conservatively disabled (never silently caps to the first 50 under an enabled 'select all'), and individual selection itself stops accepting new checks at the cap", async ({ page }) => {
    const prefix = uniqueNumber("E2E-BULK-CAP");
    const rows = [];
    for (let i = 0; i < 51; i++) {
      rows.push(await seedContract({ contractNumber: `${prefix}-${i}`, status: "DRAFT" }));
    }
    await page.goto(`/contracts?q=${prefix}`);

    const selectAll = page.getByRole("checkbox", { name: /Select all/ });
    await expect(selectAll).toBeDisabled();
    await expect(selectAll).toHaveAccessibleName(/narrow filters to 50 or fewer/);
    // A disabled control can never actually become checked, regardless
    // of the underlying handler -- this IS the proof select-all can't be
    // used at all here, not merely that it's visually dimmed.
    await expect(selectAll).not.toBeChecked();

    // Individually check exactly 50 rows -- the cap itself, not one more.
    const rowCheckboxes = page.locator("tbody input[type=checkbox]");
    for (let i = 0; i < 50; i++) {
      await rowCheckboxes.nth(i).check();
    }
    await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("50 selected (max 50)");

    // The 51st row's own checkbox is now disabled -- the cap blocks any
    // further selection, never silently allowing a 51st id to be queued.
    await expect(rowCheckboxes.nth(50)).toBeDisabled();
    await expect(rowCheckboxes.nth(50)).not.toBeChecked();
  });
});
