import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * First-Time User Experience V2, Slice B — project-context Task creation.
 * Project Hub's Tasks tab opens the form with the explicit `from=project`
 * context: success and Cancel return to that Project's Tasks tab. The global
 * form, and a bare `projectId` prefill, keep the existing /tasks behavior.
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


const PREFIX = "Ctx-Task";

test.describe("Task create — project context", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await dbQuery("task", "deleteMany", { where: { title: { startsWith: PREFIX } } });
    await cleanupTestData(fixtures);
  });

  test("Project Hub → Add task → create returns to that Project's Tasks tab with the task and the toast", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const title = `${PREFIX}-hub-${Date.now()}`;

    await page.goto(`/projects/${fixtures.project.id}?tab=tasks`);
    await page.getByRole("link", { name: "Add task" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/tasks/new\\?projectId=${fixtures.project.id}&from=project$`));
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create task" }).click();

    await expect(page).toHaveURL(new RegExp(`/projects/${fixtures.project.id}\\?tab=tasks$`));
    await expect(page.getByText("Task created")).toBeVisible();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });

  test("global Tasks → Add task → create still lands on /tasks", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const title = `${PREFIX}-global-${Date.now()}`;

    await page.goto("/tasks/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Project").selectOption(fixtures.project.id);
    await page.getByRole("button", { name: "Create task" }).click();

    await expect(page).toHaveURL(/\/tasks(\?|$)/);
    await expect(page.getByText("Task created")).toBeVisible();
  });

  test("a projectId-only URL does not imply project origin: create and Cancel both stay global", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    await page.goto(`/tasks/new?projectId=${fixtures.project.id}`);
    await expect(page.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/tasks");
    await expect(page.locator('input[name="returnTo"]')).toHaveCount(0);

    await page.getByLabel("Title").fill(`${PREFIX}-prefill-${Date.now()}`);
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page).toHaveURL(/\/tasks(\?|$)/);
  });

  test("Cancel from a project-origin form returns to the Project's Tasks tab", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto(`/tasks/new?projectId=${fixtures.project.id}&from=project`);
    await expect(page.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", `/projects/${fixtures.project.id}?tab=tasks`);
    await page.getByRole("link", { name: "Cancel" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${fixtures.project.id}\\?tab=tasks$`));
  });

  for (const query of [
    "from=project",
    "projectId=not-a-uuid&from=project",
    `projectId=00000000-0000-4000-8000-000000000000&from=project`,
    `projectId=${"{PROJECT}"}&from=Project`,
    `projectId=${"{PROJECT}"}&from=project&from=other`,
    `projectId=${"{PROJECT}"}&from=https://evil.example`,
  ]) {
    test(`unusable origin context (?${query}) falls back to the global form and Cancel`, async ({ context, baseURL, page }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto(`/tasks/new?${query.replace("{PROJECT}", fixtures.project.id)}`);
      await expect(page.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/tasks");
      await expect(page.locator('input[name="returnTo"]')).toHaveCount(0);
    });
  }

  test("a project from another organization is not an origin: Cancel stays /tasks and no context is emitted", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.orgBOwner, fixtures.orgB.id);
    await page.goto(`/tasks/new?projectId=${fixtures.project.id}&from=project`);
    await expect(page.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/tasks");
    await expect(page.locator('input[name="returnTo"]')).toHaveCount(0);
    await expect(page.getByText(fixtures.project.name)).toHaveCount(0);
  });

  test("a validation failure keeps the project context (hidden field, Project, Cancel), and the retry still returns to the Hub", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const title = `${PREFIX}-retry-${Date.now()}`;

    await page.goto(`/tasks/new?projectId=${fixtures.project.id}&from=project`);
    await page.getByLabel("Title").fill("   ");
    await page.getByRole("button", { name: "Create task" }).click();

    await expect(page).toHaveURL(/\/tasks\/new/);
    await expect(page.locator('input[name="returnTo"]')).toHaveCount(1);
    await expect(page.getByLabel("Project")).toHaveValue(fixtures.project.id);
    await expect(page.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", `/projects/${fixtures.project.id}?tab=tasks`);

    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${fixtures.project.id}\\?tab=tasks$`));
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });
});
