import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTaskAction } from "@/app/(dashboard)/tasks/new/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

// A rejected Task create returns the submitted values (so the form can keep
// what the user actually entered), persists nothing, and a corrected retry
// creates exactly one Task and one Activity row.

const PREFIX = "Task-State";
let fixtures: TestFixtures;
let otherProjectId: string;
let foreignProjectId: string;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
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

afterEach(() => resetAuthMock());

afterAll(async () => {
  await prisma.task.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await prisma.project.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await cleanupTestData(fixtures);
});

describe("createTaskAction — failed-submit state preservation", () => {
  it("a validation failure returns every entered value verbatim (changed Project included) and the field errors, and persists nothing", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const before = await counts();
    const entered = {
      title: "   ",
      description: "  keep me ",
      projectId: otherProjectId,
      status: "IN_REVIEW",
      priority: "URGENT",
      dueDate: "2031-05-06",
      assigneeId: fixtures.admin.id,
    };

    const result = await createTaskAction({ error: null }, form(entered));

    expect(result.fieldErrors?.title).toBe("Title is required.");
    expect(result.values).toEqual(entered);
    expect(await counts()).toEqual(before);
  });

  it("the latest values are returned on each of several failed submits", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const first = await createTaskAction({ error: null }, form({ title: "", projectId: fixtures.project.id, priority: "LOW" }));
    const second = await createTaskAction(first, form({ title: "", projectId: otherProjectId, priority: "HIGH", dueDate: "2031-01-02" }));

    expect(first.values).toMatchObject({ projectId: fixtures.project.id, priority: "LOW" });
    expect(second.values).toMatchObject({ projectId: otherProjectId, priority: "HIGH", dueDate: "2031-01-02" });
  });

  it("an invalid due date and an invalid assignee also return the values with their errors", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const badDate = await createTaskAction({ error: null }, form({ title: "x", projectId: fixtures.project.id, dueDate: "nope" }));
    expect(badDate.fieldErrors?.dueDate).toBeTruthy();
    expect(badDate.values?.dueDate).toBe("nope");

    const badAssignee = await createTaskAction(
      { error: null },
      form({ title: `${PREFIX}-a`, projectId: fixtures.project.id, assigneeId: randomUUID(), description: "d" }),
    );
    expect(badAssignee.fieldErrors?.assigneeId).toBe("Select a valid team member.");
    expect(badAssignee.values).toMatchObject({ title: `${PREFIX}-a`, description: "d" });
    expect(await prisma.task.findFirst({ where: { title: `${PREFIX}-a` } })).toBeNull();
  });

  it("tenant validation is intact: a foreign project is rejected, nothing written, and the typed values come back", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const before = await counts();
    const result = await createTaskAction({ error: null }, form({ title: `${PREFIX}-f`, projectId: foreignProjectId, description: "typed" }));

    expect(result.fieldErrors?.projectId).toBe("Select a valid project.");
    expect(result.values).toMatchObject({ title: `${PREFIX}-f`, projectId: foreignProjectId, description: "typed" });
    expect(await prisma.task.count({ where: { projectId: foreignProjectId } })).toBe(0);
    expect(await counts()).toEqual(before);
  });

  it("success returns no state (it redirects), and a corrected retry creates exactly one Task and one Activity", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const before = await counts();
    const failed = await createTaskAction({ error: null }, form({ title: "", projectId: otherProjectId, status: "TODO", priority: "MEDIUM" }));
    expect(await counts()).toEqual(before);

    const title = `${PREFIX}-ok`;
    let caught: unknown;
    try {
      await createTaskAction(failed, form({ ...failed.values!, title }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RedirectSignal);

    const after = await counts();
    expect(after.tasks).toBe(before.tasks + 1);
    expect(after.activities).toBe(before.activities + 1);
    expect((await prisma.task.findFirstOrThrow({ where: { title } })).projectId).toBe(otherProjectId);
  });
});
