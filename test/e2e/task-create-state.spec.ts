import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * A rejected Task create keeps exactly what the user entered (Project
 * included), across repeated failures; a correction then creates exactly one
 * Task. Edit mode keeps showing the persisted values.
 */

let fixtures: TestFixtures;
const PREFIX = "State-Task";

async function actAs(context: BrowserContext, baseURL: string, identity: { id: string; email: string }, organizationId: string) {
  await context.clearCookies();
  await injectTestSession(context, identity, baseURL);
  await context.addCookies([
    { name: "active_organization_id", value: organizationId, domain: new URL(baseURL).hostname, path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
  ]);
}

test.describe("Task create — failed submit keeps entered values", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await dbQuery("task", "deleteMany", { where: { title: { startsWith: PREFIX } } });
    await dbQuery("project", "deleteMany", { where: { name: { startsWith: PREFIX } } });
    await cleanupTestData(fixtures);
  });

  test("entered values (changed Project, status, priority, due date, description) survive repeated failures, then one Task is created", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const other = await dbQuery<{ id: string; name: string }>("project", "create", {
      data: { name: `${PREFIX}-proj-${Date.now()}`, organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, ownerId: fixtures.owner.id },
    });
    const title = `${PREFIX}-${Date.now()}`;

    // The URL prefills one project; the user deliberately picks another.
    await page.goto(`/tasks/new?projectId=${fixtures.project.id}`);
    await page.getByLabel("Project").selectOption(other.id);
    await page.getByLabel("Description").fill("typed description");
    await page.getByLabel("Status").selectOption("IN_REVIEW");
    await page.getByLabel("Priority").selectOption("URGENT");
    await page.getByLabel("Due date").fill("2031-05-06");
    await page.getByLabel("Title").fill("   ");

    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole("button", { name: "Create task" }).click();
      await expect(page.getByText("Title is required.")).toBeVisible();
      await expect(page.getByLabel("Project")).toHaveValue(other.id);
      await expect(page.getByLabel("Description")).toHaveValue("typed description");
      await expect(page.getByLabel("Status")).toHaveValue("IN_REVIEW");
      await expect(page.getByLabel("Priority")).toHaveValue("URGENT");
      await expect(page.getByLabel("Due date")).toHaveValue("2031-05-06");
    }
    expect(await dbQuery("task", "count", { where: { title: { startsWith: PREFIX } } })).toBe(0);

    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page).toHaveURL(/\/tasks(\?|$)/);
    expect(await dbQuery("task", "count", { where: { title } })).toBe(1);
    const created = await dbQuery<{ projectId: string; priority: string; status: string }>("task", "findFirst", { where: { title } });
    expect(created).toMatchObject({ projectId: other.id, priority: "URGENT", status: "IN_REVIEW" });
  });

  test("Task edit mode is unaffected: the persisted values are shown", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto(`/tasks/${fixtures.task.id}/edit`);
    await expect(page.getByLabel("Title")).toHaveValue(fixtures.task.title);
    await expect(page.getByLabel("Project")).toHaveValue(fixtures.task.projectId);
  });
});
