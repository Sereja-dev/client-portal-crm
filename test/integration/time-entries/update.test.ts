import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTimeEntry, updateTimeEntry, type TimeEntryActor } from "@/lib/time-entries/entries";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/** Time Tracking, Phase 1 — updateTimeEntry (test items 26-31, 50). */

async function cleanupEntries(organizationIds: string[]) {
  await prisma.timeEntry.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

function actorFor(user: { id: string; name: string }, role: "OWNER" | "ADMIN" | "MEMBER"): TimeEntryActor {
  return { id: user.id, name: user.name, role };
}

describe("Time Tracking — updateTimeEntry", () => {
  let fixtures: TestFixtures;

  async function createEntry(userId: string, overrides: Record<string, unknown> = {}) {
    const result = await createTimeEntry(fixtures.orgA.id, { id: fixtures.owner.id, name: fixtures.owner.name, role: "OWNER" }, {
      userId,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
      ...overrides,
    });
    if (!result.ok) throw new Error("expected ok");
    return result.entry;
  }

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupEntries([fixtures.orgA.id, fixtures.orgB.id]);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("26. a member updates their own entry", async () => {
    const entry = await createEntry(fixtures.member.id);
    const result = await updateTimeEntry(fixtures.orgA.id, entry.id, actorFor(fixtures.member, "MEMBER"), { durationMinutes: 120 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.entry.durationMinutes).toBe(120);
  });

  it("27. a MEMBER cannot update another member's entry", async () => {
    const entry = await createEntry(fixtures.admin.id);
    const result = await updateTimeEntry(fixtures.orgA.id, entry.id, actorFor(fixtures.member, "MEMBER"), { durationMinutes: 120 });
    expect(result).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } })).durationMinutes).toBe(60);
  });

  it("28. OWNER/ADMIN can update another member's entry", async () => {
    const entry = await createEntry(fixtures.member.id);
    const asOwner = await updateTimeEntry(fixtures.orgA.id, entry.id, actorFor(fixtures.owner, "OWNER"), { durationMinutes: 90 });
    expect(asOwner.ok).toBe(true);

    const entry2 = await createEntry(fixtures.member.id);
    const asAdmin = await updateTimeEntry(fixtures.orgA.id, entry2.id, actorFor(fixtures.admin, "ADMIN"), { durationMinutes: 90 });
    expect(asAdmin.ok).toBe(true);
  });

  it("29. a cross-org entry cannot be updated", async () => {
    const orgBEntry = await prisma.timeEntry.create({
      data: { organizationId: fixtures.orgB.id, userId: fixtures.orgBOwner.id, workDate: new Date("2026-03-15T00:00:00.000Z"), durationMinutes: 60 },
    });
    const result = await updateTimeEntry(fixtures.orgA.id, orgBEntry.id, actorFor(fixtures.owner, "OWNER"), { durationMinutes: 90 });
    expect(result).toEqual({ ok: false, reason: "ENTRY_NOT_FOUND" });
  });

  it("30a. changing the project revalidates the existing task — same project's own task stays valid", async () => {
    const entry = await createEntry(fixtures.owner.id, { taskId: fixtures.task.id });
    const sameProject = await updateTimeEntry(fixtures.orgA.id, entry.id, actorFor(fixtures.owner, "OWNER"), { projectId: fixtures.project.id });
    expect(sameProject.ok).toBe(true);
  });

  it("30b. changing the project rejects the update when the existing task no longer belongs to the new project (no silent clearing)", async () => {
    const otherProject = await prisma.project.create({
      data: { name: "Other Project", clientId: fixtures.clientA.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "PLANNING" },
    });
    const entry = await createEntry(fixtures.owner.id, { taskId: fixtures.task.id });

    const result = await updateTimeEntry(fixtures.orgA.id, entry.id, actorFor(fixtures.owner, "OWNER"), { projectId: otherProject.id });
    expect(result).toEqual({ ok: false, reason: "TASK_PROJECT_MISMATCH" });

    const stillOriginal = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(stillOriginal.projectId).toBe(fixtures.project.id);
    expect(stillOriginal.taskId).toBe(fixtures.task.id);

    await prisma.project.deleteMany({ where: { id: otherProject.id } });
  });

  it("30c. changing the project succeeds when taskId is explicitly cleared in the same update", async () => {
    const otherProject = await prisma.project.create({
      data: { name: "Other Project", clientId: fixtures.clientA.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "PLANNING" },
    });
    const entry = await createEntry(fixtures.owner.id, { taskId: fixtures.task.id });

    const result = await updateTimeEntry(fixtures.orgA.id, entry.id, actorFor(fixtures.owner, "OWNER"), { projectId: otherProject.id, taskId: null });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.entry.projectId).toBe(otherProject.id);
    expect(result.entry.taskId).toBeNull();

    await prisma.project.deleteMany({ where: { id: otherProject.id } });
  });

  it("30d. changing the project succeeds when a valid same-new-project taskId is explicitly supplied", async () => {
    const otherProject = await prisma.project.create({
      data: { name: "Other Project", clientId: fixtures.clientA.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "PLANNING" },
    });
    const otherTask = await prisma.task.create({
      data: { title: "Other Task", projectId: otherProject.id, organizationId: fixtures.orgA.id, status: "TODO", priority: "MEDIUM" },
    });
    const entry = await createEntry(fixtures.owner.id, { taskId: fixtures.task.id });

    const result = await updateTimeEntry(fixtures.orgA.id, entry.id, actorFor(fixtures.owner, "OWNER"), { projectId: otherProject.id, taskId: otherTask.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.entry.projectId).toBe(otherProject.id);
    expect(result.entry.taskId).toBe(otherTask.id);

    await prisma.task.deleteMany({ where: { id: otherTask.id } });
    await prisma.project.deleteMany({ where: { id: otherProject.id } });
  });

  describe("31. reassignment", () => {
    it("OWNER/ADMIN can reassign, and the new target's Membership is revalidated", async () => {
      const entry = await createEntry(fixtures.owner.id);
      const result = await updateTimeEntry(fixtures.orgA.id, entry.id, actorFor(fixtures.owner, "OWNER"), { userId: fixtures.member.id });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.entry.userId).toBe(fixtures.member.id);
    });

    it("reassigning to a cross-org user is rejected", async () => {
      const entry = await createEntry(fixtures.owner.id);
      const result = await updateTimeEntry(fixtures.orgA.id, entry.id, actorFor(fixtures.owner, "OWNER"), { userId: fixtures.orgBOwner.id });
      expect(result).toEqual({ ok: false, reason: "INVALID_TARGET_USER" });
    });

    it("a MEMBER can never reassign — not another member's entry, and not even their own", async () => {
      const ownEntry = await createEntry(fixtures.member.id);
      const reassignOwn = await updateTimeEntry(fixtures.orgA.id, ownEntry.id, actorFor(fixtures.member, "MEMBER"), { userId: fixtures.admin.id });
      expect(reassignOwn).toEqual({ ok: false, reason: "FORBIDDEN" });

      const othersEntry = await createEntry(fixtures.admin.id);
      const reassignOthers = await updateTimeEntry(fixtures.orgA.id, othersEntry.id, actorFor(fixtures.member, "MEMBER"), { userId: fixtures.member.id });
      expect(reassignOthers).toEqual({ ok: false, reason: "FORBIDDEN" });
    });
  });

  it("50. a meaningful update emits an UPDATED Activity row with changedFields, but a no-op update emits nothing", async () => {
    const entry = await createEntry(fixtures.owner.id);

    const changed = await updateTimeEntry(fixtures.orgA.id, entry.id, actorFor(fixtures.owner, "OWNER"), { durationMinutes: 120 });
    expect(changed.ok).toBe(true);
    const activity = await prisma.activity.findFirst({ where: { entityType: "TIME_ENTRY", entityId: entry.id, action: "UPDATED" } });
    expect(activity).not.toBeNull();
    expect((activity!.metadata as { changedFields?: string[] }).changedFields).toContain("durationMinutes");

    const noop = await updateTimeEntry(fixtures.orgA.id, entry.id, actorFor(fixtures.owner, "OWNER"), { durationMinutes: 120 });
    expect(noop.ok).toBe(true);
    const activityCount = await prisma.activity.count({ where: { entityType: "TIME_ENTRY", entityId: entry.id, action: "UPDATED" } });
    expect(activityCount).toBe(1);
  });
});
