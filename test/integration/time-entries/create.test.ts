import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTimeEntry, type TimeEntryActor } from "@/lib/time-entries/entries";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Time Tracking, Phase 1 — createTimeEntry (test items 1-13, 22-25, 49).
 * No Server Action/UI layer exists yet — actor/organizationId are passed
 * directly, the same "domain layer only, exercised by integration tests"
 * shape Client Requests/Lead Capture Forms Phase 1 both used.
 */

async function cleanupEntries(organizationIds: string[]) {
  await prisma.timeEntry.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

function actorFor(fixtures: TestFixtures, user: { id: string; name: string }, role: "OWNER" | "ADMIN" | "MEMBER"): TimeEntryActor {
  return { id: user.id, name: user.name, role };
}

describe("Time Tracking — createTimeEntry", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupEntries([fixtures.orgA.id, fixtures.orgB.id]);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("1/2/3. a member creates their own entry: correct organization, real Membership verified", async () => {
    const actor = actorFor(fixtures, fixtures.member, "MEMBER");
    const result = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.member.id,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 90,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.entry.organizationId).toBe(fixtures.orgA.id);
    expect(result.entry.userId).toBe(fixtures.member.id);
    expect(result.entry.projectId).toBe(fixtures.project.id);
    expect(result.entry.billable).toBe(true);
    expect(result.entry.archivedAt).toBeNull();
  });

  it("4. a MEMBER cannot create an entry for another member", async () => {
    const actor = actorFor(fixtures, fixtures.member, "MEMBER");
    const result = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.admin.id,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    expect(result).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(await prisma.timeEntry.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("5. an OWNER can create an entry for another member", async () => {
    const actor = actorFor(fixtures, fixtures.owner, "OWNER");
    const result = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.member.id,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.entry.userId).toBe(fixtures.member.id);
  });

  it("6. an ADMIN can create an entry for another member", async () => {
    const actor = actorFor(fixtures, fixtures.admin, "ADMIN");
    const result = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.member.id,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    expect(result.ok).toBe(true);
  });

  it("7. a cross-org target member is rejected even for an OWNER", async () => {
    const actor = actorFor(fixtures, fixtures.owner, "OWNER");
    const result = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.orgBOwner.id,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    expect(result).toEqual({ ok: false, reason: "INVALID_TARGET_USER" });
  });

  it("8/10. a valid same-org Project is accepted, and is required", async () => {
    const actor = actorFor(fixtures, fixtures.owner, "OWNER");
    const missingProject = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.owner.id,
      projectId: undefined,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    expect(missingProject).toEqual({ ok: false, reason: "VALIDATION", fieldErrors: expect.objectContaining({ projectId: expect.any(String) }) });

    const valid = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.owner.id,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    expect(valid.ok).toBe(true);
  });

  it("9. a cross-org Project is rejected", async () => {
    const orgBProject = await prisma.project.create({
      data: { name: "Org B Project", clientId: fixtures.clientB.id, organizationId: fixtures.orgB.id, ownerId: fixtures.orgBOwner.id, status: "PLANNING" },
    });
    const actor = actorFor(fixtures, fixtures.owner, "OWNER");
    const result = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.owner.id,
      projectId: orgBProject.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    expect(result).toEqual({ ok: false, reason: "INVALID_PROJECT" });
    await prisma.project.deleteMany({ where: { id: orgBProject.id } });
  });

  it("11. a Task from the same Project is accepted", async () => {
    const actor = actorFor(fixtures, fixtures.owner, "OWNER");
    const result = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.owner.id,
      projectId: fixtures.project.id,
      taskId: fixtures.task.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.entry.taskId).toBe(fixtures.task.id);
  });

  it("12. a Task from another Project (same org) is rejected", async () => {
    const otherProject = await prisma.project.create({
      data: { name: "Other Project", clientId: fixtures.clientA.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "PLANNING" },
    });
    const actor = actorFor(fixtures, fixtures.owner, "OWNER");
    const result = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.owner.id,
      projectId: otherProject.id,
      taskId: fixtures.task.id, // belongs to fixtures.project, not otherProject
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    expect(result).toEqual({ ok: false, reason: "INVALID_TASK" });
    await prisma.project.deleteMany({ where: { id: otherProject.id } });
  });

  it("13. a cross-org Task is rejected", async () => {
    const orgBProject = await prisma.project.create({
      data: { name: "Org B Project", clientId: fixtures.clientB.id, organizationId: fixtures.orgB.id, ownerId: fixtures.orgBOwner.id, status: "PLANNING" },
    });
    const orgBTask = await prisma.task.create({
      data: { title: "Org B Task", projectId: orgBProject.id, organizationId: fixtures.orgB.id, status: "TODO", priority: "MEDIUM" },
    });
    const actor = actorFor(fixtures, fixtures.owner, "OWNER");
    const result = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.owner.id,
      projectId: fixtures.project.id,
      taskId: orgBTask.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    expect(result).toEqual({ ok: false, reason: "INVALID_TASK" });
    await prisma.task.deleteMany({ where: { id: orgBTask.id } });
    await prisma.project.deleteMany({ where: { id: orgBProject.id } });
  });

  // Work Hub Production defect (quick-time logging audit): Task.
  // organizationId is a nullable column added by migration
  // 20260731055411_add_multi_tenant_schema with no backfill UPDATE, so
  // every Task created before that migration permanently has it NULL.
  // createTimeEntry's own Task lookup must scope tenancy through the
  // required `project: { organizationId }` relation, exactly like
  // profile-query.ts already does — never `Task.organizationId` directly
  // — so a genuine historical Task is accepted, not wrongly rejected as
  // INVALID_TASK.
  it("historical compatibility: a same-org Task with organizationId = null is accepted and creates a real TimeEntry", async () => {
    const historicalTask = await prisma.task.create({
      data: { title: "Historical Task", projectId: fixtures.project.id, organizationId: null, status: "TODO", priority: "MEDIUM" },
    });
    const actor = actorFor(fixtures, fixtures.owner, "OWNER");
    const result = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.owner.id,
      projectId: fixtures.project.id,
      taskId: historicalTask.id,
      workDate: "2026-03-15",
      durationMinutes: 1,
      billable: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.entry.projectId).toBe(fixtures.project.id);
    expect(result.entry.taskId).toBe(historicalTask.id);
    expect(result.entry.organizationId).toBe(fixtures.orgA.id);
    expect(result.entry.durationMinutes).toBe(1);
    expect(result.entry.billable).toBe(false);
    expect(await prisma.timeEntry.count({ where: { taskId: historicalTask.id } })).toBe(1);

    await prisma.task.deleteMany({ where: { id: historicalTask.id } });
  });

  // Tenant-isolation regression for the relation-based scoping above:
  // dropping the direct Task.organizationId equality filter must not
  // accidentally widen visibility across organizations. A foreign-org
  // Task — in the same historical organizationId-null shape — linked to
  // a DIFFERENT Project in a DIFFERENT Organization must still be
  // rejected when the caller supplies the LOCAL org's own Project id.
  it("a foreign-org Task (also organizationId = null, the same historical shape) is still rejected", async () => {
    const orgBProject = await prisma.project.create({
      data: { name: "Org B Historical Project", clientId: fixtures.clientB.id, organizationId: fixtures.orgB.id, ownerId: fixtures.orgBOwner.id, status: "PLANNING" },
    });
    const orgBHistoricalTask = await prisma.task.create({
      data: { title: "Org B Historical Task", projectId: orgBProject.id, organizationId: null, status: "TODO", priority: "MEDIUM" },
    });
    const actor = actorFor(fixtures, fixtures.owner, "OWNER");
    const result = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.owner.id,
      projectId: fixtures.project.id,
      taskId: orgBHistoricalTask.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    expect(result).toEqual({ ok: false, reason: "INVALID_TASK" });
    expect(await prisma.timeEntry.count({ where: { taskId: orgBHistoricalTask.id } })).toBe(0);

    await prisma.task.deleteMany({ where: { id: orgBHistoricalTask.id } });
    await prisma.project.deleteMany({ where: { id: orgBProject.id } });
  });

  it("22. billable true is stored when explicitly set", async () => {
    const actor = actorFor(fixtures, fixtures.owner, "OWNER");
    const result = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.owner.id,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
      billable: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.entry.billable).toBe(true);
  });

  it("23. billable false is stored when explicitly set", async () => {
    const actor = actorFor(fixtures, fixtures.owner, "OWNER");
    const result = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.owner.id,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
      billable: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.entry.billable).toBe(false);
  });

  it("24. billable defaults to true when omitted", async () => {
    const actor = actorFor(fixtures, fixtures.owner, "OWNER");
    const result = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.owner.id,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.entry.billable).toBe(true);
  });

  it("25. a whitespace-only description becomes null", async () => {
    const actor = actorFor(fixtures, fixtures.owner, "OWNER");
    const result = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.owner.id,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
      description: "   ",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.entry.description).toBeNull();
  });

  it("duration/date validation rejects invalid input at the create boundary", async () => {
    const actor = actorFor(fixtures, fixtures.owner, "OWNER");
    const zero = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.owner.id,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 0,
    });
    expect(zero).toEqual({ ok: false, reason: "VALIDATION", fieldErrors: expect.objectContaining({ durationMinutes: expect.any(String) }) });

    const tooLong = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.owner.id,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 1441,
    });
    expect(tooLong).toEqual({ ok: false, reason: "VALIDATION", fieldErrors: expect.objectContaining({ durationMinutes: expect.any(String) }) });

    const badDate = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.owner.id,
      projectId: fixtures.project.id,
      workDate: "not-a-date",
      durationMinutes: 60,
    });
    expect(badDate).toEqual({ ok: false, reason: "VALIDATION", fieldErrors: expect.objectContaining({ workDate: expect.any(String) }) });

    expect(await prisma.timeEntry.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("49. create emits a CREATED Activity row with the real actor", async () => {
    const actor = actorFor(fixtures, fixtures.owner, "OWNER");
    const result = await createTimeEntry(fixtures.orgA.id, actor, {
      userId: fixtures.owner.id,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    if (!result.ok) throw new Error("expected ok");

    const activity = await prisma.activity.findFirst({ where: { entityType: "TIME_ENTRY", entityId: result.entry.id, action: "CREATED" } });
    expect(activity).not.toBeNull();
    expect(activity!.actorId).toBe(fixtures.owner.id);
    expect(activity!.organizationId).toBe(fixtures.orgA.id);
  });
});
