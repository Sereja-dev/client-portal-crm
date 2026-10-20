import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Mobile Improvement Slice B3 — Clients/Projects/Tasks row-action
 * hierarchy (direct Edit/Log-time + destructive Delete relocated into
 * the shared RowActionMenu, mirroring Invoices' own already-shipped
 * pattern) and RowActionMenu's own mobile-only touch-target increase
 * (32px -> 40px below `md`, unchanged at `md` and up). Domain-layer
 * delete correctness is already exhaustively covered at the integration
 * layer (test/integration/clients/delete.test.ts,
 * test/integration/projects/delete.test.ts) — this file proves the UI
 * composition only: Edit/Log-time stay direct, Delete is reachable only
 * via "...", the existing ConfirmDialog still opens with its own exact
 * copy, and Cancel leaves the record untouched (no Product mutation).
 */

let fixtures: TestFixtures;

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

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test.describe("Clients mobile row actions", () => {
  let seededClientIds: string[] = [];

  async function seedClient(overrides: Record<string, unknown> = {}) {
    const name = (overrides.name as string) ?? uniqueMarker("E2E-B3-Client");
    const created = await dbQuery<{ id: string; name: string }>("client", "create", {
      data: { organizationId: fixtures.orgA.id, userId: fixtures.owner.id, ...overrides, name },
    });
    seededClientIds.push(created.id);
    return created;
  }

  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test.afterEach(async () => {
    if (seededClientIds.length > 0) {
      await dbQuery("client", "deleteMany", { where: { id: { in: seededClientIds } } });
      seededClientIds = [];
    }
  });

  test("390px: Edit is direct, Delete is reachable only via the overflow menu, Cancel preserves the client", async ({ page }) => {
    const client = await seedClient();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/clients");

    const card = page.locator("li", { hasText: client.name });
    await expect(card.getByRole("link", { name: "Edit" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Delete" })).toHaveCount(0);

    const menuTrigger = card.getByRole("button", { name: `More actions for client ${client.name}` });
    await expect(menuTrigger).toBeVisible();
    const triggerBox = (await menuTrigger.boundingBox())!;
    expect(triggerBox.width).toBeGreaterThanOrEqual(40);
    expect(triggerBox.height).toBeGreaterThanOrEqual(40);

    await menuTrigger.click();
    // Accessibility Improvement A1 — the open menu's own real control
    // now correctly exposes role="menuitem" (an explicit ARIA role
    // overrides the native <button>'s own implicit role); ConfirmDialog's
    // own Cancel button below is untouched and still role="button".
    const deleteButton = page.getByRole("menuitem", { name: "Delete" });
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Delete client");
    await expect(dialog).toContainText(`Delete ${client.name}? This action cannot be undone.`);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.locator("li", { hasText: client.name })).toBeVisible();
  });

  test("desktop (1280px): Edit direct, Delete via overflow, trigger stays ~32px", async ({ page }) => {
    const client = await seedClient();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/clients");

    const row = page.getByRole("row", { name: new RegExp(client.name) });
    await expect(row.getByRole("link", { name: "Edit" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);

    const menuTrigger = row.getByRole("button", { name: `More actions for client ${client.name}` });
    await expect(menuTrigger).toBeVisible();
    const triggerBox = (await menuTrigger.boundingBox())!;
    expect(triggerBox.width).toBeGreaterThanOrEqual(30);
    expect(triggerBox.width).toBeLessThanOrEqual(34);
    expect(triggerBox.height).toBeGreaterThanOrEqual(30);
    expect(triggerBox.height).toBeLessThanOrEqual(34);

    await menuTrigger.click();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  });
});

test.describe("Projects mobile row actions", () => {
  let seededProjectIds: string[] = [];

  async function seedProject(overrides: Record<string, unknown> = {}) {
    const name = (overrides.name as string) ?? uniqueMarker("E2E-B3-Project");
    const created = await dbQuery<{ id: string; name: string }>("project", "create", {
      data: { organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, ownerId: fixtures.owner.id, ...overrides, name },
    });
    seededProjectIds.push(created.id);
    return created;
  }

  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test.afterEach(async () => {
    if (seededProjectIds.length > 0) {
      await dbQuery("project", "deleteMany", { where: { id: { in: seededProjectIds } } });
      seededProjectIds = [];
    }
  });

  test("390px: Edit is direct, Delete via overflow, Cancel preserves the project", async ({ page }) => {
    const project = await seedProject();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/projects");

    const card = page.locator("li", { hasText: project.name });
    await expect(card.getByRole("link", { name: "Edit" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Delete" })).toHaveCount(0);

    await card.getByRole("button", { name: `More actions for project ${project.name}` }).click();
    // Accessibility Improvement A1 — see the Clients block above's own
    // identical comment.
    const deleteButton = page.getByRole("menuitem", { name: "Delete" });
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Delete project");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.locator("li", { hasText: project.name })).toBeVisible();
  });

  test("desktop (1280px): same Edit-direct / Delete-via-overflow hierarchy", async ({ page }) => {
    const project = await seedProject();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/projects");

    const row = page.getByRole("row", { name: new RegExp(project.name) });
    await expect(row.getByRole("link", { name: "Edit" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await row.getByRole("button", { name: `More actions for project ${project.name}` }).click();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  });
});

test.describe("Tasks mobile row actions", () => {
  let seededTaskIds: string[] = [];

  async function seedTask(overrides: Record<string, unknown> = {}) {
    const title = (overrides.title as string) ?? uniqueMarker("E2E-B3-Task");
    const created = await dbQuery<{ id: string; title: string }>("task", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        projectId: fixtures.project.id,
        status: "TODO",
        priority: "MEDIUM",
        ...overrides,
        title,
      },
    });
    seededTaskIds.push(created.id);
    return created;
  }

  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test.afterEach(async () => {
    if (seededTaskIds.length > 0) {
      await dbQuery("task", "deleteMany", { where: { id: { in: seededTaskIds } } });
      seededTaskIds = [];
    }
  });

  test("390px List view: Log time and Edit stay direct, Delete via overflow, Cancel preserves the task", async ({ page }) => {
    const task = await seedTask();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/tasks?view=list");

    const card = page.locator("li", { hasText: task.title });
    await expect(card.getByRole("button", { name: "Log time" })).toBeVisible();
    await expect(card.getByRole("link", { name: "Edit" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Delete" })).toHaveCount(0);

    await card.getByRole("button", { name: `More actions for task ${task.title}` }).click();
    // Accessibility Improvement A1 — see the Clients block above's own
    // identical comment.
    const deleteButton = page.getByRole("menuitem", { name: "Delete" });
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Delete task");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.locator("li", { hasText: task.title })).toBeVisible();
  });

  test("desktop (1280px) List view: Log time and Edit direct, Delete via overflow", async ({ page }) => {
    const task = await seedTask();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/tasks?view=list");

    const row = page.getByRole("row", { name: new RegExp(task.title) });
    await expect(row.getByRole("button", { name: "Log time" })).toBeVisible();
    await expect(row.getByRole("link", { name: "Edit" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await row.getByRole("button", { name: `More actions for task ${task.title}` }).click();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  });

  test("B2 filter regression: List/Board toggle and the mobile Filter disclosure are unaffected by the row-action change", async ({ page }) => {
    await seedTask();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/tasks");

    await expect(page.getByRole("link", { name: "List" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Board" })).toBeVisible();
    await expect(page.locator("details.mobile-filter-disclosure > summary")).toHaveText("Filter");
  });
});
