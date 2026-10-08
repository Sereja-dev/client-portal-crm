import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Stale custom-status filter hardening — real browser coverage for the
 * approved fail-closed remediation: an unresolved `?status=` key on
 * /clients (never a real CustomStatusDefinition in this org — a typo, a
 * foreign-org-looking string, or a hand-edited/bookmarked URL) now
 * remains fully active in the canonical URL and the existing org-scoped
 * query (zero-result semantics, never a broadened "all clients"), while
 * the Status `<select>` renders a truthful "Unavailable status" sentinel
 * instead of silently falling back to "All statuses". Mirrors the
 * already-shipped Contract stale-entity-filter remediation's own E2E
 * shape exactly. Domain-layer correctness (org scoping, the resolver
 * itself) is already exhaustively covered in
 * test/integration/clients/list-query.test.ts; this file only proves
 * the UI is now truthful about an already-safe, already-fail-closed
 * query.
 */

let fixtures: TestFixtures;
let seededClientIds: string[] = [];
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

async function seedClient(overrides: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
  const name = (overrides.name as string) ?? uniqueName("E2E-StaleStatus");
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

async function cleanupSeeded(): Promise<void> {
  if (seededClientIds.length > 0) {
    await dbQuery("client", "deleteMany", { where: { id: { in: seededClientIds } } });
    seededClientIds = [];
  }
  if (seededDefinitionIds.length > 0) {
    await dbQuery("customStatusDefinition", "deleteMany", { where: { id: { in: seededDefinitionIds } } });
    seededDefinitionIds = [];
  }
}

test.describe("Clients stale custom-status filter hardening", () => {
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
    const ordinary = await seedClient({ status: "ACTIVE" });

    await page.goto(`/clients?status=${STALE_KEY}`);

    await expect(page).toHaveURL(new RegExp(`status=${STALE_KEY}`));
    const statusSelect = page.getByLabel("Status");
    await expect(statusSelect).toHaveValue(STALE_KEY);
    await expect(statusSelect.locator("option", { hasText: "Unavailable status" })).toHaveCount(1);
    await expect(page.getByText("No matching clients")).toBeVisible();
    await expect(page.getByRole("link", { name: "Clear filters" })).toBeVisible();
    await expect(page.getByRole("link", { name: ordinary.name })).toHaveCount(0);

    const optionTexts = await statusSelect.locator("option").allTextContents();
    for (const text of optionTexts) {
      expect(text).not.toContain(STALE_KEY);
    }
  });

  test("Search submit preserves the stale status; explicitly choosing All statuses clears it", async ({ page }) => {
    const ordinary = await seedClient({ status: "ACTIVE" });

    await page.goto(`/clients?status=${STALE_KEY}`);
    await page.locator("form").getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(new RegExp(`status=${STALE_KEY}`));
    await expect(page.getByLabel("Status")).toHaveValue(STALE_KEY);
    await expect(page.getByText("No matching clients")).toBeVisible();

    await page.getByLabel("Status").selectOption("");
    await page.locator("form").getByRole("button", { name: "Search" }).click();
    await expect(page.getByLabel("Status")).toHaveValue("");
    await expect(page.getByRole("link", { name: ordinary.name })).toBeVisible();
  });

  test("Sort change preserves the stale status filter rather than dropping it", async ({ page }) => {
    await page.goto(`/clients?status=${STALE_KEY}`);

    await page.getByLabel("Sort by").selectOption("name:asc");
    await expect(page).toHaveURL(new RegExp(`status=${STALE_KEY}`));
    await expect(page).toHaveURL(/sort=name/);
    await expect(page.getByLabel("Status")).toHaveValue(STALE_KEY);
    await expect(page.getByLabel("Status").locator("option", { hasText: "Unavailable status" })).toHaveCount(1);
  });

  test("Clear removes the stale status filter entirely and normal results return", async ({ page }) => {
    const ordinary = await seedClient({ status: "ACTIVE" });

    await page.goto(`/clients?status=${STALE_KEY}`);
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(page.getByLabel("Status")).toHaveValue("");
    await expect(page.getByLabel("Status").locator("option", { hasText: "Unavailable status" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: ordinary.name })).toBeVisible();
  });

  test("a valid status filter still works normally — no sentinel, real narrowing", async ({ page }) => {
    // seedE2EFixtures() (like seedTestData()) does not run bootstrap.ts's
    // own CustomStatusDefinition seeding for its fixture org -- a real,
    // resolvable "active" definition must be seeded explicitly here for
    // `?status=active` to mean anything other than "stale" in this test
    // harness (same reasoning as test/integration/clients/
    // list-query.test.ts's own identical setup comment).
    const definition = await seedCustomStatusDefinition({ key: "active", label: "Active", isSystem: true });
    const activeClient = await seedClient({ statusDefinitionId: definition.id });

    await page.goto(`/clients?status=active`);
    const statusSelect = page.getByLabel("Status");
    await expect(statusSelect).toHaveValue("active");
    await expect(statusSelect.locator("option", { hasText: "Unavailable status" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: activeClient.name })).toBeVisible();
  });

  test("a real but ARCHIVED custom status definition remains valid — real label shown, no sentinel, correct narrowing", async ({ page }) => {
    const definition = await seedCustomStatusDefinition({
      key: `archived-e2e-${Date.now()}`,
      label: "Archived E2E Status",
      archivedAt: new Date().toISOString(),
    });
    const taggedClient = await seedClient({ statusDefinitionId: definition.id });

    await page.goto(`/clients?status=${definition.key}`);
    const statusSelect = page.getByLabel("Status");
    await expect(statusSelect).toHaveValue(definition.key);
    await expect(statusSelect.locator("option", { hasText: "Unavailable status" })).toHaveCount(0);
    await expect(statusSelect.locator("option", { hasText: "Archived E2E Status (archived)" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: taggedClient.name })).toBeVisible();
  });

  test("390px: the Unavailable status sentinel renders readably with no destructive horizontal clipping", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/clients?status=${STALE_KEY}`);

    await expect(page.getByLabel("Status")).toHaveValue(STALE_KEY);
    await expect(page.getByLabel("Status").locator("option", { hasText: "Unavailable status" })).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
});
