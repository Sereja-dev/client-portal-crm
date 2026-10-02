import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Projects & Tasks Work Hub V1 — Tasks list/Board toggle (filter-
 * preserving), quick filters, the canonical overdue indicator, a real
 * cross-status Board drag-and-drop move, the quick time-log dialog, bulk
 * selection + a bulk status change, and a narrow-viewport no-overflow
 * check on both views. Per-field CRUD (create/edit/delete a Task) is
 * already exhaustively covered by projects-tasks-migration.spec.ts and
 * the existing Task integration suite — deliberately not repeated here.
 */

let fixtures: TestFixtures;

async function actAs(
  context: BrowserContext,
  baseURL: string,
  identity: { id: string; email: string },
  organizationId: string,
): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, identity, baseURL);
  await context.addCookies([
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

test.describe("Tasks Work Hub", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
    await dbQuery("task", "update", {
      where: { id: fixtures.task.id },
      data: { dueDate: new Date("2026-01-01T00:00:00.000Z") }, // Long past — a stable, deterministic "overdue".
    });
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("List/Board toggle preserves an active filter (priority)", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/tasks?priority=MEDIUM");
    await page.getByRole("link", { name: "Board" }).click();
    await expect(page).toHaveURL(/priority=MEDIUM/);
    await expect(page).toHaveURL(/view=board/);

    await page.getByRole("link", { name: "List", exact: true }).click();
    await expect(page).toHaveURL(/priority=MEDIUM/);
  });

  test("the Overdue quick filter toggles ?overdue=true and shows the fixture's own overdue task", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/tasks");
    await page.getByRole("link", { name: "Overdue" }).click();
    await expect(page).toHaveURL(/overdue=true/);
    await expect(page.getByRole("row", { name: new RegExp(fixtures.task.title) })).toBeVisible();
  });

  test("an overdue task shows a visible Overdue indicator in the List; a DONE task never does", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/tasks");
    const row = page.getByRole("row", { name: new RegExp(fixtures.task.title) });
    await expect(row.getByText("Overdue")).toBeVisible();

    await dbQuery("task", "update", { where: { id: fixtures.task.id }, data: { status: "DONE" } });
    await page.reload();
    const doneRow = page.getByRole("row", { name: new RegExp(fixtures.task.title) });
    await expect(doneRow.getByText("Overdue")).toHaveCount(0);
    await dbQuery("task", "update", { where: { id: fixtures.task.id }, data: { status: "TODO" } });
  });

  test("Board: dragging a card to a different column changes its status; a real page reload confirms the change persisted", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/tasks?view=board");

    const card = page.locator(`[aria-label="Drag ${fixtures.task.title}"]`);
    await expect(card).toBeVisible();

    const targetColumn = page.locator("#board-column-IN_PROGRESS");
    const cardBox = await card.boundingBox();
    const targetBox = await targetColumn.boundingBox();
    expect(cardBox && targetBox).toBeTruthy();

    await page.mouse.move(cardBox!.x + cardBox!.width / 2, cardBox!.y + cardBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + 40, { steps: 10 });
    await page.mouse.up();

    await expect(page.getByText("Status updated")).toBeVisible();
    // The Board itself has no <tr> role — confirm persistence via the
    // List view instead (a real navigation, not just the same page
    // re-rendering its own already-mutated client state).
    await page.goto("/tasks");
    const row = page.getByRole("row", { name: new RegExp(fixtures.task.title) });
    await expect(row.getByText("In Progress", { exact: false })).toBeVisible();

    await dbQuery("task", "update", { where: { id: fixtures.task.id }, data: { status: "TODO" } });
  });

  test("Quick time log: opens from the List, submits, and lands on the new time entry", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/tasks");

    await page.getByRole("row", { name: new RegExp(fixtures.task.title) }).getByRole("button", { name: "Log time" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: new RegExp(`Log time`) })).toBeVisible();
    await dialog.getByLabel("Hours").fill("1");
    await dialog.getByRole("button", { name: "Log time", exact: true }).click();

    await expect(page).toHaveURL(/\/time\//);
    await expect(page.getByText("Time entry logged")).toBeVisible();
  });

  // Work Hub Production defect (quick-time logging audit): a Task
  // created before migration 20260731055411_add_multi_tenant_schema has
  // organizationId permanently NULL (no backfill ever ran). Quick-log
  // must still succeed for such a Task — the real UI flow, not a direct
  // action/domain-layer call — proving the fix end-to-end.
  test("Quick time log: a historical Task with organizationId = null still submits successfully", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const historicalTask = await dbQuery<{ id: string; title: string }>("task", "create", {
      data: {
        title: "Historical Null-Org Task",
        projectId: fixtures.project.id,
        organizationId: null,
        status: "TODO",
        priority: "MEDIUM",
      },
    });

    try {
      await page.goto("/tasks");
      await page.getByRole("row", { name: new RegExp(historicalTask.title) }).getByRole("button", { name: "Log time" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: new RegExp(`Log time`) })).toBeVisible();
      await dialog.getByLabel("Minutes").fill("1");
      await dialog.getByLabel("Description").fill("Historical task quick-log regression");
      await dialog.getByRole("button", { name: "Log time", exact: true }).click();

      await expect(page).toHaveURL(/\/time\//);
      await expect(page.getByText("Time entry logged")).toBeVisible();
    } finally {
      await dbQuery("timeEntry", "deleteMany", { where: { taskId: historicalTask.id } });
      await dbQuery("task", "deleteMany", { where: { id: historicalTask.id } });
    }
  });

  // The other proven defect: before entries.ts's own tenant-scope fix, an
  // INVALID_TASK rejection was silently dropped — the dialog's
  // uncontrolled fields reset (React's own documented post-action
  // behavior) with no visible error. Deterministically triggers the real
  // INVALID_TASK branch — no test-only backdoor, no weakened validation —
  // by deleting the Task out from under an already-open dialog's stale
  // hidden taskId, exactly as a real "task deleted/moved while the dialog
  // was open" race would.
  test("Quick time log: a genuinely invalid Task now shows a visible error, never a silent reset", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const staleTask = await dbQuery<{ id: string; title: string }>("task", "create", {
      data: {
        title: "Stale Task For Deletion",
        projectId: fixtures.project.id,
        organizationId: fixtures.orgA.id,
        status: "TODO",
        priority: "MEDIUM",
      },
    });

    try {
      await page.goto("/tasks");
      await page.getByRole("row", { name: new RegExp(staleTask.title) }).getByRole("button", { name: "Log time" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: new RegExp(`Log time`) })).toBeVisible();

      // The dialog's own hidden taskId is now stale — the Task it refers
      // to no longer exists.
      await dbQuery("task", "deleteMany", { where: { id: staleTask.id } });

      await dialog.getByLabel("Minutes").fill("1");
      await dialog.getByRole("button", { name: "Log time", exact: true }).click();

      await expect(dialog.getByRole("alert")).toHaveText("Select a valid task for this project.");
      await expect(page).not.toHaveURL(/\/time\//);
      expect(await dbQuery<number>("timeEntry", "count", { where: { taskId: staleTask.id } })).toBe(0);
    } finally {
      await dbQuery("task", "deleteMany", { where: { id: staleTask.id } });
    }
  });

  test("Bulk actions: selecting rows shows the toolbar; a bulk status change applies to every selected Task", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/tasks");

    await page.getByRole("row", { name: new RegExp(fixtures.task.title) }).getByRole("checkbox").check();
    await expect(page.getByText("1 selected")).toBeVisible();

    await page.getByRole("combobox", { name: "Bulk action" }).selectOption("status");
    await page.getByRole("combobox", { name: "New status" }).selectOption("IN_REVIEW");
    await page.getByRole("button", { name: "Apply" }).click();

    await expect(page.getByText(/Updated 1/)).toBeVisible();
    const row = page.getByRole("row", { name: new RegExp(fixtures.task.title) });
    await expect(row.getByText("In Review", { exact: false })).toBeVisible();

    await dbQuery("task", "update", { where: { id: fixtures.task.id }, data: { status: "TODO" } });
  });

  test("390px: List and Board both render with no horizontal page overflow", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto("/tasks");
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);

    await page.goto("/tasks?view=board");
    await expect(page.getByRole("navigation", { name: "Task status" })).toBeVisible();
    overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  });
});
