import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Tables Improvement Slice C (Support Requests bulk pilot) — real
 * browser coverage for the two approved V1 bulk actions: status change
 * and assignment, on the Active (non-archived) list only. Domain-layer
 * correctness (tenant scoping, assignee eligibility, Activity side
 * effects, partial success) is already exhaustively covered by
 * test/integration/client-requests/bulk-actions.test.ts and is not
 * re-derived here. This is also the FIRST E2E coverage this domain has
 * ever had (no prior Support Requests E2E spec existed) — scoped
 * strictly to this slice's own bulk surface, not a general backfill of
 * unrelated Request workflow coverage.
 */

let fixtures: TestFixtures;
let seededRequestIds: string[] = [];

function uniqueTitle(prefix: string): string {
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

async function seedRequest(overrides: Record<string, unknown> = {}): Promise<{ id: string; title: string }> {
  const title = (overrides.title as string) ?? uniqueTitle("E2E-BULK-REQ");
  const created = await dbQuery<{ id: string; title: string }>("clientRequest", "create", {
    data: {
      description: "Something needs attention.",
      organizationId: fixtures.orgA.id,
      clientId: fixtures.clientA.id,
      portalUserId: fixtures.portalUser.id,
      ...overrides,
      title,
    },
  });
  seededRequestIds.push(created.id);
  return created;
}

async function cleanupSeededRequests(): Promise<void> {
  if (seededRequestIds.length > 0) {
    await dbQuery("clientRequest", "deleteMany", { where: { id: { in: seededRequestIds } } });
    seededRequestIds = [];
  }
}

test.describe("Support Request bulk workflow (Tables Improvement Slice C)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test.afterEach(async () => {
    await cleanupSeededRequests();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("selecting multiple Requests and applying a bulk status change updates all of them, and the result persists after reload", async ({ page }) => {
    const prefix = uniqueTitle("E2E-BULK-STATUS");
    const a = await seedRequest({ title: `${prefix}-0` });
    const b = await seedRequest({ title: `${prefix}-1` });
    await page.goto("/requests");

    await page.getByRole("checkbox", { name: `Select request ${a.title}` }).check();
    await page.getByRole("checkbox", { name: `Select request ${b.title}` }).check();

    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar).toContainText("2 selected");
    await bar.getByLabel("Bulk action").selectOption("status");
    await bar.getByLabel("New status").selectOption("IN_PROGRESS");
    await bar.getByRole("button", { name: "Apply" }).click();

    await expect(page.getByText(/Updated 2 requests?/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);

    await page.reload();
    const rowA = page.getByRole("row", { name: new RegExp(a.title) });
    const rowB = page.getByRole("row", { name: new RegExp(b.title) });
    await expect(rowA).toContainText("In Progress");
    await expect(rowB).toContainText("In Progress");
  });

  test("selecting multiple Requests and applying a bulk assignment assigns all of them, and the result persists after reload", async ({ page }) => {
    const prefix = uniqueTitle("E2E-BULK-ASSIGN");
    const a = await seedRequest({ title: `${prefix}-0` });
    const b = await seedRequest({ title: `${prefix}-1` });
    await page.goto("/requests");

    await page.getByRole("checkbox", { name: `Select request ${a.title}` }).check();
    await page.getByRole("checkbox", { name: `Select request ${b.title}` }).check();

    const bar = page.getByRole("region", { name: "Bulk actions" });
    await bar.getByLabel("Bulk action").selectOption("assignee");
    await bar.getByLabel("New assignee").selectOption({ label: fixtures.admin.name });
    await bar.getByRole("button", { name: "Apply" }).click();

    await expect(page.getByText(/Updated 2 requests?/)).toBeVisible();

    await page.reload();
    const rowA = page.getByRole("row", { name: new RegExp(a.title) });
    const rowB = page.getByRole("row", { name: new RegExp(b.title) });
    await expect(rowA).toContainText(fixtures.admin.name);
    await expect(rowB).toContainText(fixtures.admin.name);
  });

  test("Clear removes the selection and the toolbar disappears without mutating anything", async ({ page }) => {
    const request = await seedRequest();
    await page.goto("/requests");

    await page.getByRole("checkbox", { name: `Select request ${request.title}` }).check();
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar).toBeVisible();

    await bar.getByRole("button", { name: "Clear selection" }).click();
    await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("row", { name: new RegExp(request.title) })).toContainText("Open");
  });

  test("Apply is disabled until a complete action+value is chosen", async ({ page }) => {
    const request = await seedRequest();
    await page.goto("/requests");

    await page.getByRole("checkbox", { name: `Select request ${request.title}` }).check();
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar.getByRole("button", { name: "Apply" })).toBeDisabled();

    await bar.getByLabel("Bulk action").selectOption("status");
    await expect(bar.getByRole("button", { name: "Apply" })).toBeDisabled();

    await bar.getByLabel("New status").selectOption("CLOSED");
    await expect(bar.getByRole("button", { name: "Apply" })).toBeEnabled();

    // Assignee is different: an empty value legitimately means
    // "Unassigned", which is a valid, already-supported choice — Apply
    // must become enabled as soon as the action itself is chosen.
    await bar.getByLabel("Bulk action").selectOption("assignee");
    await expect(bar.getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  test("changing a filter resets the selection — a stale selected id never silently survives into a new result set", async ({ page }) => {
    const prefix = uniqueTitle("E2E-BULK-REQFILTER");
    const request = await seedRequest({ title: `${prefix}-0` });
    await page.goto("/requests");

    await page.getByRole("checkbox", { name: `Select request ${request.title}` }).check();
    await expect(page.getByRole("region", { name: "Bulk actions" })).toBeVisible();

    await page.getByLabel("Filter by status").selectOption("CLOSED");
    await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
  });

  test("Archived view: no selection checkboxes and no BulkActionBar — matches the existing detail-page convention that archived Requests are not actionable", async ({ page }) => {
    const archived = await seedRequest({ archivedAt: new Date().toISOString() });
    await page.goto("/requests?archived=1");

    const row = page.getByRole("row", { name: new RegExp(archived.title) });
    await expect(row).toBeVisible();
    await expect(row.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
  });

  test("390px: the bulk toolbar remains usable, critical request identity/status stays visible, no page-level horizontal clipping", async ({ page }) => {
    const request = await seedRequest();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/requests");

    await expect(page.getByRole("row", { name: new RegExp(request.title) })).toBeVisible();
    await page.getByRole("checkbox", { name: `Select request ${request.title}` }).check();
    await expect(page.getByRole("region", { name: "Bulk actions" })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test("current-rendered-result semantics: with more than 50 rows rendered, select-all is conservatively disabled, and individual selection itself stops accepting new checks at the cap", async ({ page }) => {
    for (let i = 0; i < 51; i++) {
      await seedRequest();
    }
    await page.goto("/requests");

    const selectAll = page.getByRole("checkbox", { name: /Select all/ });
    await expect(selectAll).toBeDisabled();
    await expect(selectAll).toHaveAccessibleName(/narrow filters to 50 or fewer/);
    await expect(selectAll).not.toBeChecked();

    const rowCheckboxes = page.locator("tbody input[type=checkbox]");
    for (let i = 0; i < 50; i++) {
      await rowCheckboxes.nth(i).check();
    }
    await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("50 selected (max 50)");

    await expect(rowCheckboxes.nth(50)).toBeDisabled();
    await expect(rowCheckboxes.nth(50)).not.toBeChecked();
  });
});
