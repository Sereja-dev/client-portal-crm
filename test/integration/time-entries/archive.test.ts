import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTimeEntry, archiveTimeEntry, unarchiveTimeEntry, type TimeEntryActor } from "@/lib/time-entries/entries";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/** Time Tracking, Phase 1 — archive/unarchive (test items 40-43, 51). */

async function cleanupEntries(organizationIds: string[]) {
  await prisma.timeEntry.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

function actorFor(user: { id: string; name: string }, role: "OWNER" | "ADMIN" | "MEMBER"): TimeEntryActor {
  return { id: user.id, name: user.name, role };
}

describe("Time Tracking — archive / unarchive", () => {
  let fixtures: TestFixtures;

  async function createEntry(userId: string) {
    const result = await createTimeEntry(fixtures.orgA.id, { id: fixtures.owner.id, name: fixtures.owner.name, role: "OWNER" }, {
      userId,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
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

  it("40. a member can archive their own entry, idempotently, and unarchive it again", async () => {
    const entry = await createEntry(fixtures.member.id);
    const actor = actorFor(fixtures.member, "MEMBER");

    const archived = await archiveTimeEntry(fixtures.orgA.id, entry.id, actor);
    expect(archived.ok).toBe(true);
    if (!archived.ok) throw new Error("expected ok");
    expect(archived.entry.archivedAt).not.toBeNull();

    const stillArchived = await archiveTimeEntry(fixtures.orgA.id, entry.id, actor);
    expect(stillArchived.ok).toBe(true);
    if (!stillArchived.ok) throw new Error("expected ok");
    expect(stillArchived.entry.archivedAt?.getTime()).toBe(archived.entry.archivedAt?.getTime());

    const unarchived = await unarchiveTimeEntry(fixtures.orgA.id, entry.id, actor);
    expect(unarchived.ok).toBe(true);
    if (!unarchived.ok) throw new Error("expected ok");
    expect(unarchived.entry.archivedAt).toBeNull();
  });

  it("41. a MEMBER cannot archive another member's entry", async () => {
    const entry = await createEntry(fixtures.admin.id);
    const result = await archiveTimeEntry(fixtures.orgA.id, entry.id, actorFor(fixtures.member, "MEMBER"));
    expect(result).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } })).archivedAt).toBeNull();
  });

  it("42. OWNER/ADMIN can archive another member's entry", async () => {
    const entryForOwner = await createEntry(fixtures.member.id);
    const byOwner = await archiveTimeEntry(fixtures.orgA.id, entryForOwner.id, actorFor(fixtures.owner, "OWNER"));
    expect(byOwner.ok).toBe(true);

    const entryForAdmin = await createEntry(fixtures.member.id);
    const byAdmin = await archiveTimeEntry(fixtures.orgA.id, entryForAdmin.id, actorFor(fixtures.admin, "ADMIN"));
    expect(byAdmin.ok).toBe(true);
  });

  it("43. unarchive follows the same permission rule as archive", async () => {
    const entry = await createEntry(fixtures.admin.id);
    await archiveTimeEntry(fixtures.orgA.id, entry.id, actorFor(fixtures.owner, "OWNER"));

    const memberAttempt = await unarchiveTimeEntry(fixtures.orgA.id, entry.id, actorFor(fixtures.member, "MEMBER"));
    expect(memberAttempt).toEqual({ ok: false, reason: "FORBIDDEN" });

    const ownerAttempt = await unarchiveTimeEntry(fixtures.orgA.id, entry.id, actorFor(fixtures.owner, "OWNER"));
    expect(ownerAttempt.ok).toBe(true);
  });

  it("a cross-org actor cannot archive an entry — ENTRY_NOT_FOUND, never FORBIDDEN (no existence leak)", async () => {
    const orgBEntry = await prisma.timeEntry.create({
      data: { organizationId: fixtures.orgB.id, userId: fixtures.orgBOwner.id, workDate: new Date("2026-03-15T00:00:00.000Z"), durationMinutes: 60 },
    });
    const result = await archiveTimeEntry(fixtures.orgA.id, orgBEntry.id, actorFor(fixtures.owner, "OWNER"));
    expect(result).toEqual({ ok: false, reason: "ENTRY_NOT_FOUND" });
  });

  it("51. archive/unarchive emits no Activity row", async () => {
    const entry = await createEntry(fixtures.owner.id);
    const actor = actorFor(fixtures.owner, "OWNER");

    await archiveTimeEntry(fixtures.orgA.id, entry.id, actor);
    await unarchiveTimeEntry(fixtures.orgA.id, entry.id, actor);

    const activityCount = await prisma.activity.count({ where: { entityType: "TIME_ENTRY", entityId: entry.id } });
    // Exactly one Activity row exists for this entry — its own CREATED
    // event — and nothing from either archive call.
    expect(activityCount).toBe(1);
    const onlyActivity = await prisma.activity.findFirstOrThrow({ where: { entityType: "TIME_ENTRY", entityId: entry.id } });
    expect(onlyActivity.action).toBe("CREATED");
  });
});
