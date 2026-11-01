import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTaskAction } from "@/app/(dashboard)/tasks/new/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

// First-Time User Experience V2, Slice B. A task created from Project Hub's
// Tasks tab (explicit `returnTo=project`) returns to that Project's Tasks tab;
// every other submission keeps the global /tasks destination. The destination
// is built only from the server-verified project id — never from the input.

const PREFIX = "Task-Context";
const unique = () => `${PREFIX}-${randomUUID().slice(0, 8)}`;

let fixtures: TestFixtures;
let otherProjectId: string;
let foreignProjectId: string;

function form(title: string, projectId: string, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("title", title);
  fd.set("projectId", projectId);
  for (const [key, value] of Object.entries(extra)) fd.set(key, value);
  return fd;
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
  return (caught as RedirectSignal).url;
}

const counts = async () => ({
  tasks: await prisma.task.count({ where: { title: { startsWith: PREFIX } } }),
  activities: await prisma.activity.count({ where: { entityType: "TASK", action: "CREATED", organizationId: fixtures.orgA.id } }),
});

beforeAll(async () => {
  fixtures = await seedTestData();
  otherProjectId = (
    await prisma.project.create({
      data: { name: `${PREFIX}-other`, organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, ownerId: fixtures.owner.id },
    })
  ).id;
  foreignProjectId = (
    await prisma.project.create({
      data: { name: `${PREFIX}-foreign`, organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, ownerId: fixtures.orgBOwner.id },
    })
  ).id;
});

afterEach(() => {
  resetAuthMock();
});

afterAll(async () => {
  await prisma.task.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await prisma.project.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await cleanupTestData(fixtures);
});

describe("createTaskAction — project-context return (Slice B)", () => {
  it("Project Hub context: redirects to that Project's Tasks tab, keeping the toast and tab=tasks", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const url = await redirectOf(createTaskAction({ error: null }, form(unique(), fixtures.project.id, { returnTo: "project" })));
    expect(url).toBe(`/projects/${fixtures.project.id}?tab=tasks&toast=Task+created`);
  });

  it("global context: still redirects to /tasks with the toast", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const url = await redirectOf(createTaskAction({ error: null }, form(unique(), fixtures.project.id)));
    expect(url).toBe("/tasks?toast=Task+created");
  });

  it("a projectId alone does not imply project origin", async () => {
    // Selecting/prefilling a project is not navigation context: the action
    // only ever sees projectId here, exactly like a global submission.
    actAs(fixtures.owner, fixtures.orgA.id);
    const url = await redirectOf(createTaskAction({ error: null }, form(unique(), otherProjectId)));
    expect(url).toBe("/tasks?toast=Task+created");
  });

  it.each(["", "Project", "PROJECT", "project ", "global", "/evil", "https://evil.example/x", "//evil.example", "../x", "project&x=1"])(
    "an unexpected returnTo value %j falls back to the global destination",
    async (returnTo) => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const url = await redirectOf(createTaskAction({ error: null }, form(unique(), fixtures.project.id, { returnTo })));
      expect(url).toBe("/tasks?toast=Task+created");
    },
  );

  it("a changed Project select wins: the redirect uses the persisted task's verified project", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const title = unique();
    const url = await redirectOf(createTaskAction({ error: null }, form(title, otherProjectId, { returnTo: "project" })));

    const task = await prisma.task.findFirstOrThrow({ where: { title } });
    expect(task.projectId).toBe(otherProjectId);
    expect(url).toBe(`/projects/${task.projectId}?tab=tasks&toast=Task+created`);
  });

  it("a forged returnTo with a foreign project: field error, no redirect, no Task or Activity, no cross-tenant write", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const before = await counts();
    const title = unique();

    const result = await createTaskAction({ error: null }, form(title, foreignProjectId, { returnTo: "project" }));

    expect(result.fieldErrors?.projectId).toBe("Select a valid project.");
    expect(await prisma.task.count({ where: { projectId: foreignProjectId } })).toBe(0);
    expect(await prisma.task.findFirst({ where: { title } })).toBeNull();
    expect(await counts()).toEqual(before);
  });

  it("a deleted project behaves like an unknown one: no redirect, no write", async () => {
    const gone = (
      await prisma.project.create({
        data: { name: `${PREFIX}-gone`, organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, ownerId: fixtures.owner.id },
      })
    ).id;
    await prisma.project.delete({ where: { id: gone } });
    actAs(fixtures.owner, fixtures.orgA.id);
    const title = unique();

    const result = await createTaskAction({ error: null }, form(title, gone, { returnTo: "project" }));

    expect(result.fieldErrors?.projectId).toBe("Select a valid project.");
    expect(await prisma.task.findFirst({ where: { title } })).toBeNull();
  });

  it("a malformed project id with returnTo is rejected the same way, without a redirect", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createTaskAction({ error: null }, form(unique(), "not-a-uuid", { returnTo: "project" })).catch(
      (err: unknown) => err,
    );
    expect(result).not.toBeInstanceOf(RedirectSignal);
  });

  it("validation failure with project context: field errors, no redirect, no Task or Activity", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const before = await counts();

    const result = await createTaskAction({ error: null }, form("   ", fixtures.project.id, { returnTo: "project" }));

    expect(result.fieldErrors?.title).toBeTruthy();
    expect(await counts()).toEqual(before);
  });

  it("creates exactly one Task and one Activity row per successful submission", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const before = await counts();
    const title = unique();

    await redirectOf(createTaskAction({ error: null }, form(title, fixtures.project.id, { returnTo: "project" })));

    const after = await counts();
    expect(after.tasks).toBe(before.tasks + 1);
    expect(after.activities).toBe(before.activities + 1);
    expect(await prisma.task.count({ where: { title } })).toBe(1);
  });
});
