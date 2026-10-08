import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Stale custom-status filter hardening — real browser coverage for the
 * Projects surface, mirroring clients-stale-status-filter.spec.ts's own
 * identical shape exactly (same underlying mechanism — buildProjectWhere
 * shares the identical fix as buildClientWhere). See that file's own
 * header comment for the full "why". Domain-layer correctness is
 * already exhaustively covered in
 * test/integration/projects/list-query.test.ts.
 */

let fixtures: TestFixtures;
let seededProjectIds: string[] = [];
let seededDefinitionIds: string[] = [];
const STALE_KEY = "totally-made-up-status-key-xyz";

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
  const name = (overrides.name as string) ?? uniqueName("E2E-StaleStatus-Project");
  const created = await dbQuery<{ id: string; name: string }>("project", "create", {
    data: {
      clientId: fixtures.clientA.id,
      ownerId: fixtures.owner.id,
      organizationId: fixtures.orgA.id,
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

test.describe("Projects stale custom-status filter hardening", () => {
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

  test("stale (never-existed) status key: URL preserved, sentinel shown, zero truthful results, no raw key visible", async ({ page }) => {
    const ordinary = await seedProject({ status: "IN_PROGRESS" });

    await page.goto(`/projects?status=${STALE_KEY}`);

    await expect(page).toHaveURL(new RegExp(`status=${STALE_KEY}`));
    const statusSelect = page.getByLabel("Status");
    await expect(statusSelect).toHaveValue(STALE_KEY);
    await expect(statusSelect.locator("option", { hasText: "Unavailable status" })).toHaveCount(1);
    await expect(page.getByText("No matching projects")).toBeVisible();
    await expect(page.getByRole("link", { name: "Clear filters" })).toBeVisible();
    await expect(page.getByRole("link", { name: ordinary.name })).toHaveCount(0);

    const optionTexts = await statusSelect.locator("option").allTextContents();
    for (const text of optionTexts) {
      expect(text).not.toContain(STALE_KEY);
    }
  });

  test("Search submit preserves the stale status; explicitly choosing All statuses clears it", async ({ page }) => {
    const ordinary = await seedProject({ status: "IN_PROGRESS" });

    await page.goto(`/projects?status=${STALE_KEY}`);
    await page.locator("form").getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(new RegExp(`status=${STALE_KEY}`));
    await expect(page.getByLabel("Status")).toHaveValue(STALE_KEY);
    await expect(page.getByText("No matching projects")).toBeVisible();

    await page.getByLabel("Status").selectOption("");
    await page.locator("form").getByRole("button", { name: "Search" }).click();
    await expect(page.getByLabel("Status")).toHaveValue("");
    await expect(page.getByRole("link", { name: ordinary.name })).toBeVisible();
  });

  test("Sort change preserves the stale status filter rather than dropping it", async ({ page }) => {
    await page.goto(`/projects?status=${STALE_KEY}`);

    await page.getByLabel("Sort by").selectOption("name:asc");
    await expect(page).toHaveURL(new RegExp(`status=${STALE_KEY}`));
    await expect(page).toHaveURL(/sort=name/);
    await expect(page.getByLabel("Status")).toHaveValue(STALE_KEY);
    await expect(page.getByLabel("Status").locator("option", { hasText: "Unavailable status" })).toHaveCount(1);
  });

  test("Clear removes the stale status filter entirely and normal results return", async ({ page }) => {
    const ordinary = await seedProject({ status: "IN_PROGRESS" });

    await page.goto(`/projects?status=${STALE_KEY}`);
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(page.getByLabel("Status")).toHaveValue("");
    await expect(page.getByLabel("Status").locator("option", { hasText: "Unavailable status" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: ordinary.name })).toBeVisible();
  });

  test("a valid status filter still works normally — no sentinel, real narrowing", async ({ page }) => {
    const definition = await seedCustomStatusDefinition({ key: "in_progress", label: "In Progress", isSystem: true });
    const activeProject = await seedProject({ statusDefinitionId: definition.id });

    await page.goto(`/projects?status=in_progress`);
    const statusSelect = page.getByLabel("Status");
    await expect(statusSelect).toHaveValue("in_progress");
    await expect(statusSelect.locator("option", { hasText: "Unavailable status" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: activeProject.name })).toBeVisible();
  });

  test("a real but ARCHIVED custom status definition remains valid — real label shown, no sentinel, correct narrowing", async ({ page }) => {
    const definition = await seedCustomStatusDefinition({
      key: `archived-e2e-${Date.now()}`,
      label: "Archived E2E Status",
      archivedAt: new Date().toISOString(),
    });
    const taggedProject = await seedProject({ statusDefinitionId: definition.id });

    await page.goto(`/projects?status=${definition.key}`);
    const statusSelect = page.getByLabel("Status");
    await expect(statusSelect).toHaveValue(definition.key);
    await expect(statusSelect.locator("option", { hasText: "Unavailable status" })).toHaveCount(0);
    await expect(statusSelect.locator("option", { hasText: "Archived E2E Status (archived)" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: taggedProject.name })).toBeVisible();
  });

  test("390px: the Unavailable status sentinel renders readably with no destructive horizontal clipping", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/projects?status=${STALE_KEY}`);

    await expect(page.getByLabel("Status")).toHaveValue(STALE_KEY);
    await expect(page.getByLabel("Status").locator("option", { hasText: "Unavailable status" })).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
});
