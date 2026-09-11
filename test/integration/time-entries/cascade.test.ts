import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTimeEntry, type TimeEntryActor } from "@/lib/time-entries/entries";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Time Tracking, Phase 1 — migration/cascade coverage (test items 44-48).
 * Every scenario builds its own small, fully disposable rows (never
 * fixtures.owner/fixtures.clientA/fixtures.project themselves) so a real
 * hard-delete inside one test can never affect another test or this
 * file's own afterAll cleanup — same isolation shape as Client Requests'
 * own cascade.test.ts.
 */
describe("Time Tracking — cascade/delete behavior", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  function actor(user: { id: string; name: string }): TimeEntryActor {
    return { id: user.id, name: user.name, role: "OWNER" };
  }

  it("44. deleting a User sets TimeEntry.userId to null, never deletes the entry", async () => {
    const user = await prisma.user.create({ data: { id: randomUUID(), email: `cascade-user-${randomUUID()}@example.com`, name: "Cascade User" } });
    await prisma.membership.create({ data: { userId: user.id, organizationId: fixtures.orgA.id, role: "MEMBER" } });

    const result = await createTimeEntry(fixtures.orgA.id, actor(fixtures.owner), {
      userId: user.id,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    if (!result.ok) throw new Error("expected ok");

    await prisma.membership.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });

    const survivingEntry = await prisma.timeEntry.findUniqueOrThrow({ where: { id: result.entry.id } });
    expect(survivingEntry.userId).toBeNull();

    await prisma.timeEntry.deleteMany({ where: { id: result.entry.id } });
  });

  it("45. deleting a Project sets TimeEntry.projectId to null, never deletes the entry", async () => {
    const project = await prisma.project.create({
      data: { name: "Cascade Project", clientId: fixtures.clientA.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "PLANNING" },
    });

    const result = await createTimeEntry(fixtures.orgA.id, actor(fixtures.owner), {
      userId: fixtures.owner.id,
      projectId: project.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    if (!result.ok) throw new Error("expected ok");

    await prisma.project.delete({ where: { id: project.id } });

    const survivingEntry = await prisma.timeEntry.findUniqueOrThrow({ where: { id: result.entry.id } });
    expect(survivingEntry.projectId).toBeNull();

    await prisma.timeEntry.deleteMany({ where: { id: result.entry.id } });
  });

  it("46. deleting a Task sets TimeEntry.taskId to null, never deletes the entry", async () => {
    const task = await prisma.task.create({
      data: { title: "Cascade Task", projectId: fixtures.project.id, organizationId: fixtures.orgA.id, status: "TODO", priority: "MEDIUM" },
    });

    const result = await createTimeEntry(fixtures.orgA.id, actor(fixtures.owner), {
      userId: fixtures.owner.id,
      projectId: fixtures.project.id,
      taskId: task.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    if (!result.ok) throw new Error("expected ok");

    await prisma.task.delete({ where: { id: task.id } });

    const survivingEntry = await prisma.timeEntry.findUniqueOrThrow({ where: { id: result.entry.id } });
    expect(survivingEntry.taskId).toBeNull();
    // Its projectId is untouched — only the Task link itself was cleared.
    expect(survivingEntry.projectId).toBe(fixtures.project.id);

    await prisma.timeEntry.deleteMany({ where: { id: result.entry.id } });
  });

  it("47. deleting an Organization cascades TimeEntry", async () => {
    const org = await prisma.organization.create({ data: { name: "Cascade Org", slug: `cascade-org-${randomUUID()}` } });
    const user = await prisma.user.create({ data: { id: randomUUID(), email: `cascade-owner-${randomUUID()}@example.com`, name: "Cascade Owner" } });
    await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });
    const client = await prisma.client.create({ data: { name: "Cascade Client", organizationId: org.id, userId: user.id } });
    const project = await prisma.project.create({
      data: { name: "Cascade Project", clientId: client.id, organizationId: org.id, ownerId: user.id, status: "PLANNING" },
    });

    const result = await createTimeEntry(
      org.id,
      { id: user.id, name: user.name, role: "OWNER" },
      { userId: user.id, projectId: project.id, workDate: "2026-03-15", durationMinutes: 60 },
    );
    if (!result.ok) throw new Error("expected ok");

    await prisma.organization.delete({ where: { id: org.id } });

    expect(await prisma.timeEntry.findUnique({ where: { id: result.entry.id } })).toBeNull();

    // Project.organizationId is onDelete: SetNull (not Cascade) — the
    // Project/Client rows themselves survive the Organization delete
    // (orphaned), and Client still holds a Restrict FK on userId, so
    // both must be cleaned up before the temp User can be deleted.
    await prisma.project.deleteMany({ where: { id: project.id } });
    await prisma.client.deleteMany({ where: { id: client.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  });

  it("48. no cross-org association can be created through domain functions: a cross-org target user, Project, and Task are all independently rejected for the same org-A create call", async () => {
    const orgBProject = await prisma.project.create({
      data: { name: "Org B Project", clientId: fixtures.clientB.id, organizationId: fixtures.orgB.id, ownerId: fixtures.orgBOwner.id, status: "PLANNING" },
    });
    const orgBTask = await prisma.task.create({
      data: { title: "Org B Task", projectId: orgBProject.id, organizationId: fixtures.orgB.id, status: "TODO", priority: "MEDIUM" },
    });

    const crossUser = await createTimeEntry(fixtures.orgA.id, actor(fixtures.owner), {
      userId: fixtures.orgBOwner.id,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    expect(crossUser).toEqual({ ok: false, reason: "INVALID_TARGET_USER" });

    const crossProject = await createTimeEntry(fixtures.orgA.id, actor(fixtures.owner), {
      userId: fixtures.owner.id,
      projectId: orgBProject.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    expect(crossProject).toEqual({ ok: false, reason: "INVALID_PROJECT" });

    const crossTask = await createTimeEntry(fixtures.orgA.id, actor(fixtures.owner), {
      userId: fixtures.owner.id,
      projectId: fixtures.project.id,
      taskId: orgBTask.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    expect(crossTask).toEqual({ ok: false, reason: "INVALID_TASK" });

    expect(await prisma.timeEntry.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);

    await prisma.task.deleteMany({ where: { id: orgBTask.id } });
    await prisma.project.deleteMany({ where: { id: orgBProject.id } });
  });
});
