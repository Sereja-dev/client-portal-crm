import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Work Hub Production audit — Time Entry edit (/time/[id]) and new
 * (/time/new) pages' own Task-options source. Both pages used to filter
 * `Task.organizationId` directly (the same nullable, never-backfilled
 * column profile-query.ts and createTimeEntry already had fixed
 * elsewhere), which silently excluded a historical Task from the Task
 * <select>'s own options — even when a TimeEntry's own stored `taskId`
 * correctly pointed at it, the select had no matching <option> and fell
 * back to showing "No task" / "This project has no tasks yet". Both
 * pages now scope via the required `project: { organizationId }`
 * relation instead.
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

test.describe("Time Entry pages — historical Task options", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("Edit page: a historical same-org Task (organizationId = null) renders correctly selected, never 'No task'/'no tasks yet'", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const historicalTask = await dbQuery<{ id: string; title: string }>("task", "create", {
      data: {
        title: "Historical Edit-Page Task",
        projectId: fixtures.project.id,
        organizationId: null,
        status: "TODO",
        priority: "MEDIUM",
      },
    });
    const entry = await dbQuery<{ id: string }>("timeEntry", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        userId: fixtures.owner.id,
        projectId: fixtures.project.id,
        taskId: historicalTask.id,
        workDate: new Date("2026-03-15T00:00:00.000Z"),
        durationMinutes: 30,
        billable: true,
      },
    });

    try {
      await page.goto(`/time/${entry.id}`);
      const taskSelect = page.getByRole("combobox", { name: "Task" });
      await expect(taskSelect).toHaveValue(historicalTask.id);
      await expect(page.getByText("This project has no tasks yet")).toHaveCount(0);
      await expect(page.getByRole("option", { name: historicalTask.title })).toHaveCount(1);
    } finally {
      await dbQuery("timeEntry", "deleteMany", { where: { id: entry.id } });
      await dbQuery("task", "deleteMany", { where: { id: historicalTask.id } });
    }
  });

  test("Edit page: a foreign-org Task (also organizationId = null) never appears as an option", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const localTask = await dbQuery<{ id: string; title: string }>("task", "create", {
      data: { title: "Local Edit-Page Task", projectId: fixtures.project.id, organizationId: null, status: "TODO", priority: "MEDIUM" },
    });
    const foreignProject = await dbQuery<{ id: string }>("project", "create", {
      data: { name: "Foreign Edit-Page Project", clientId: fixtures.clientB.id, organizationId: fixtures.orgB.id, ownerId: fixtures.orgBOwner.id, status: "PLANNING" },
    });
    const foreignTask = await dbQuery<{ id: string; title: string }>("task", "create", {
      data: { title: "Foreign Edit-Page Task", projectId: foreignProject.id, organizationId: null, status: "TODO", priority: "MEDIUM" },
    });
    const entry = await dbQuery<{ id: string }>("timeEntry", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        userId: fixtures.owner.id,
        projectId: fixtures.project.id,
        taskId: localTask.id,
        workDate: new Date("2026-03-15T00:00:00.000Z"),
        durationMinutes: 30,
        billable: true,
      },
    });

    try {
      await page.goto(`/time/${entry.id}`);
      await expect(page.getByRole("option", { name: foreignTask.title })).toHaveCount(0);
    } finally {
      await dbQuery("timeEntry", "deleteMany", { where: { id: entry.id } });
      await dbQuery("task", "deleteMany", { where: { id: localTask.id } });
      await dbQuery("task", "deleteMany", { where: { id: foreignTask.id } });
      await dbQuery("project", "deleteMany", { where: { id: foreignProject.id } });
    }
  });

  test("New page: a historical same-org Task is selectable for its Project, a foreign-org Task is not", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const historicalTask = await dbQuery<{ id: string; title: string }>("task", "create", {
      data: { title: "Historical New-Page Task", projectId: fixtures.project.id, organizationId: null, status: "TODO", priority: "MEDIUM" },
    });
    const foreignProject = await dbQuery<{ id: string }>("project", "create", {
      data: { name: "Foreign New-Page Project", clientId: fixtures.clientB.id, organizationId: fixtures.orgB.id, ownerId: fixtures.orgBOwner.id, status: "PLANNING" },
    });
    const foreignTask = await dbQuery<{ id: string; title: string }>("task", "create", {
      data: { title: "Foreign New-Page Task", projectId: foreignProject.id, organizationId: null, status: "TODO", priority: "MEDIUM" },
    });

    try {
      await page.goto("/time/new");
      await page.getByRole("combobox", { name: "Project" }).selectOption(fixtures.project.id);
      await expect(page.getByText("This project has no tasks yet")).toHaveCount(0);
      await expect(page.getByRole("option", { name: historicalTask.title })).toHaveCount(1);
      await expect(page.getByRole("option", { name: foreignTask.title })).toHaveCount(0);
    } finally {
      await dbQuery("task", "deleteMany", { where: { id: historicalTask.id } });
      await dbQuery("task", "deleteMany", { where: { id: foreignTask.id } });
      await dbQuery("project", "deleteMany", { where: { id: foreignProject.id } });
    }
  });
});
