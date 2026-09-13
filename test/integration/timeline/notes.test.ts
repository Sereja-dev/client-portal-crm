import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createTimelineNote,
  editTimelineNote,
  deleteTimelineNote,
  listTimelineNotesForEntity,
  type TimelineNoteActor,
} from "@/lib/timeline/notes";
import { COMMENT_BODY_MAX_LENGTH } from "@/lib/comments/validate-body";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Communication Timeline Phase 1 — domain-layer coverage: create/edit/
 * delete/list, tenant isolation (including the legacy nullable-
 * Client.organizationId case), author-vs-moderator edit/delete
 * permissions, ordering, and side-effect isolation (no Activity, no
 * Notification, no WorkflowAutomationRun ever produced by any function
 * in src/lib/timeline/notes.ts).
 */

function actorFor(fixtures: TestFixtures, who: "owner" | "admin" | "member"): TimelineNoteActor {
  const user = fixtures[who];
  const role = who === "owner" ? "OWNER" : who === "admin" ? "ADMIN" : "MEMBER";
  return { id: user.id, name: user.name, role };
}

async function createLead(organizationId: string, name = "Test Lead") {
  return prisma.lead.create({ data: { organizationId, name } });
}

async function countSideEffects(organizationId: string) {
  const [activityCount, notificationCount, workflowRunCount] = await Promise.all([
    prisma.activity.count({ where: { organizationId } }),
    prisma.notification.count({ where: { organizationId } }),
    prisma.workflowAutomationRun.count({ where: { workflowAutomation: { organizationId } } }),
  ]);
  return { activityCount, notificationCount, workflowRunCount };
}

describe("Communication Timeline — TimelineNote domain layer", () => {
  let fixtures: TestFixtures;
  const extraLeadIds: string[] = [];
  const extraClientIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await prisma.timelineNote.deleteMany({ where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    if (extraLeadIds.length) {
      await prisma.lead.deleteMany({ where: { id: { in: extraLeadIds } } });
      extraLeadIds.length = 0;
    }
    if (extraClientIds.length) {
      await prisma.client.deleteMany({ where: { id: { in: extraClientIds } } });
      extraClientIds.length = 0;
    }
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  // ---------------------------------------------------------------------
  // Basics
  // ---------------------------------------------------------------------

  it("OWNER creates a Client note", async () => {
    const result = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "Called the client about renewal.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.note.body).toBe("Called the client about renewal.");
    expect(result.note.entityType).toBe("CLIENT");
    expect(result.note.entityId).toBe(fixtures.clientA.id);
    expect(result.note.authorId).toBe(fixtures.owner.id);
    expect(result.note.organizationId).toBe(fixtures.orgA.id);
    expect(result.note.deletedAt).toBeNull();
    expect(result.note.editedAt).toBeNull();
  });

  it("ADMIN creates a Lead note", async () => {
    const lead = await createLead(fixtures.orgA.id);
    extraLeadIds.push(lead.id);

    const result = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "admin"), {
      entityType: "LEAD",
      entityId: lead.id,
      body: "Sent a proposal.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.note.entityType).toBe("LEAD");
    expect(result.note.entityId).toBe(lead.id);
    expect(result.note.authorId).toBe(fixtures.admin.id);
  });

  it("MEMBER creates a note", async () => {
    const result = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "member"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "Left a voicemail.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.note.authorId).toBe(fixtures.member.id);
  });

  // ---------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------

  it("empty body is rejected", async () => {
    const result = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "",
    });
    expect(result).toEqual({ ok: false, reason: "INVALID_BODY", error: "empty" });
  });

  it("whitespace-only body is rejected", async () => {
    const result = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "   \n\t  ",
    });
    expect(result).toEqual({ ok: false, reason: "INVALID_BODY", error: "empty" });
  });

  it("body is trimmed", async () => {
    const result = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "   Called the client.   ",
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.note.body).toBe("Called the client.");
  });

  it("max length is enforced (reuses COMMENT_BODY_MAX_LENGTH)", async () => {
    const tooLong = "a".repeat(COMMENT_BODY_MAX_LENGTH + 1);
    const result = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: tooLong,
    });
    expect(result).toEqual({ ok: false, reason: "INVALID_BODY", error: "too_long" });

    const atLimit = "a".repeat(COMMENT_BODY_MAX_LENGTH);
    const okResult = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: atLimit,
    });
    expect(okResult.ok).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Tenant isolation
  // ---------------------------------------------------------------------

  it("cannot create a note for a Client in another organization", async () => {
    const result = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "CLIENT",
      entityId: fixtures.clientB.id,
      body: "Should never be created.",
    });
    expect(result).toEqual({ ok: false, reason: "ENTITY_NOT_FOUND" });
  });

  it("cannot create a note for a Lead in another organization", async () => {
    const leadInOrgB = await createLead(fixtures.orgB.id, "Org B Lead");
    extraLeadIds.push(leadInOrgB.id);

    const result = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "LEAD",
      entityId: leadInOrgB.id,
      body: "Should never be created.",
    });
    expect(result).toEqual({ ok: false, reason: "ENTITY_NOT_FOUND" });
  });

  it("a Client with a null organizationId (legacy row) is rejected — null is never treated as a match for any organizationId", async () => {
    const orphanClient = await prisma.client.create({
      data: { name: "Orphan Client", organizationId: null, userId: fixtures.owner.id },
    });
    extraClientIds.push(orphanClient.id);

    const result = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "CLIENT",
      entityId: orphanClient.id,
      body: "Should never be created.",
    });
    expect(result).toEqual({ ok: false, reason: "ENTITY_NOT_FOUND" });
  });

  it("cannot edit/delete/read a foreign-org note", async () => {
    const created = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "Org A only.",
    });
    if (!created.ok) throw new Error("expected ok");

    const orgBOwnerActor: TimelineNoteActor = { id: fixtures.orgBOwner.id, name: fixtures.orgBOwner.name, role: "OWNER" };

    const editAttempt = await editTimelineNote(fixtures.orgB.id, created.note.id, orgBOwnerActor, "Hijacked");
    expect(editAttempt).toEqual({ ok: false, reason: "NOT_FOUND" });

    const deleteAttempt = await deleteTimelineNote(fixtures.orgB.id, created.note.id, orgBOwnerActor);
    expect(deleteAttempt).toEqual({ ok: false, reason: "NOT_FOUND" });

    // "Read" here means: this note never appears when listing orgB's own
    // (entirely unrelated) Client B notes — entityId alone is never
    // sufficient, organizationId always narrows it first.
    const listForOrgB = await listTimelineNotesForEntity(fixtures.orgB.id, "CLIENT", fixtures.clientB.id);
    if (!listForOrgB.ok) throw new Error("expected ok");
    expect(listForOrgB.notes.find((n) => n.id === created.note.id)).toBeUndefined();
  });

  it("entityId alone never leaks cross-org data — a Client sharing no relation with orgB still returns ENTITY_NOT_FOUND when listed under orgB", async () => {
    const result = await listTimelineNotesForEntity(fixtures.orgB.id, "CLIENT", fixtures.clientA.id);
    expect(result).toEqual({ ok: false, reason: "ENTITY_NOT_FOUND" });
  });

  // ---------------------------------------------------------------------
  // Edit/delete permissions
  // ---------------------------------------------------------------------

  it("the author can edit their own note", async () => {
    const created = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "member"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "Original text.",
    });
    if (!created.ok) throw new Error("expected ok");

    const edited = await editTimelineNote(fixtures.orgA.id, created.note.id, actorFor(fixtures, "member"), "Updated text.");
    expect(edited.ok).toBe(true);
    if (!edited.ok) throw new Error("expected ok");
    expect(edited.note.body).toBe("Updated text.");
    expect(edited.note.editedAt).not.toBeNull();
    expect(edited.note.authorId).toBe(fixtures.member.id);
  });

  it("the author can delete their own note", async () => {
    const created = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "member"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "To be deleted by its author.",
    });
    if (!created.ok) throw new Error("expected ok");

    const deleted = await deleteTimelineNote(fixtures.orgA.id, created.note.id, actorFor(fixtures, "member"));
    expect(deleted).toEqual({ ok: true, alreadyDeleted: false });
  });

  it("OWNER can edit and delete another user's note", async () => {
    const created = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "member"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "Member's note.",
    });
    if (!created.ok) throw new Error("expected ok");

    const edited = await editTimelineNote(fixtures.orgA.id, created.note.id, actorFor(fixtures, "owner"), "Moderated text.");
    expect(edited.ok).toBe(true);
    if (!edited.ok) throw new Error("expected ok");
    // Attribution is preserved — the moderator's edit never reassigns authorship.
    expect(edited.note.authorId).toBe(fixtures.member.id);

    const deleted = await deleteTimelineNote(fixtures.orgA.id, created.note.id, actorFor(fixtures, "owner"));
    expect(deleted).toEqual({ ok: true, alreadyDeleted: false });
  });

  it("ADMIN can edit and delete another user's note", async () => {
    const created = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "member"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "Member's note.",
    });
    if (!created.ok) throw new Error("expected ok");

    const edited = await editTimelineNote(fixtures.orgA.id, created.note.id, actorFor(fixtures, "admin"), "Moderated by admin.");
    expect(edited.ok).toBe(true);

    const deleted = await deleteTimelineNote(fixtures.orgA.id, created.note.id, actorFor(fixtures, "admin"));
    expect(deleted).toEqual({ ok: true, alreadyDeleted: false });
  });

  it("MEMBER cannot edit another user's note", async () => {
    const created = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "Owner's note.",
    });
    if (!created.ok) throw new Error("expected ok");

    const edited = await editTimelineNote(fixtures.orgA.id, created.note.id, actorFor(fixtures, "member"), "Hijacked.");
    expect(edited).toEqual({ ok: false, reason: "FORBIDDEN" });
    const reloaded = await prisma.timelineNote.findUniqueOrThrow({ where: { id: created.note.id } });
    expect(reloaded.body).toBe("Owner's note.");
  });

  it("MEMBER cannot delete another user's note", async () => {
    const created = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "Owner's note.",
    });
    if (!created.ok) throw new Error("expected ok");

    const deleted = await deleteTimelineNote(fixtures.orgA.id, created.note.id, actorFor(fixtures, "member"));
    expect(deleted).toEqual({ ok: false, reason: "FORBIDDEN" });
    const reloaded = await prisma.timelineNote.findUniqueOrThrow({ where: { id: created.note.id } });
    expect(reloaded.deletedAt).toBeNull();
  });

  it("a deleted note is excluded from the normal list, but the row remains in the database", async () => {
    const created = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "Will be deleted.",
    });
    if (!created.ok) throw new Error("expected ok");

    await deleteTimelineNote(fixtures.orgA.id, created.note.id, actorFor(fixtures, "owner"));

    const list = await listTimelineNotesForEntity(fixtures.orgA.id, "CLIENT", fixtures.clientA.id);
    if (!list.ok) throw new Error("expected ok");
    expect(list.notes.find((n) => n.id === created.note.id)).toBeUndefined();

    const reloaded = await prisma.timelineNote.findUnique({ where: { id: created.note.id } });
    expect(reloaded).not.toBeNull();
    expect(reloaded?.deletedAt).not.toBeNull();
    expect(reloaded?.body).toBe("Will be deleted.");
  });

  it("editing a deleted note is rejected", async () => {
    const created = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "Will be deleted.",
    });
    if (!created.ok) throw new Error("expected ok");
    await deleteTimelineNote(fixtures.orgA.id, created.note.id, actorFor(fixtures, "owner"));

    const edited = await editTimelineNote(fixtures.orgA.id, created.note.id, actorFor(fixtures, "owner"), "Too late.");
    expect(edited).toEqual({ ok: false, reason: "DELETED" });
  });

  it("deleting an already-deleted note is an idempotent no-op", async () => {
    const created = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "Deleted twice.",
    });
    if (!created.ok) throw new Error("expected ok");

    const first = await deleteTimelineNote(fixtures.orgA.id, created.note.id, actorFor(fixtures, "owner"));
    expect(first).toEqual({ ok: true, alreadyDeleted: false });

    const second = await deleteTimelineNote(fixtures.orgA.id, created.note.id, actorFor(fixtures, "owner"));
    expect(second).toEqual({ ok: true, alreadyDeleted: true });
  });

  it("editing/deleting a nonexistent note id fails the same controlled way as a foreign-org id", async () => {
    const bogusId = "00000000-0000-0000-0000-000000000000";
    expect(await editTimelineNote(fixtures.orgA.id, bogusId, actorFor(fixtures, "owner"), "X")).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
    expect(await deleteTimelineNote(fixtures.orgA.id, bogusId, actorFor(fixtures, "owner"))).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
  });

  // ---------------------------------------------------------------------
  // Ordering
  // ---------------------------------------------------------------------

  it("lists newest first (createdAt DESC)", async () => {
    const first = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "First note.",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "Second note.",
    });
    if (!first.ok || !second.ok) throw new Error("expected ok");

    const list = await listTimelineNotesForEntity(fixtures.orgA.id, "CLIENT", fixtures.clientA.id);
    if (!list.ok) throw new Error("expected ok");
    expect(list.notes[0].id).toBe(second.note.id);
    expect(list.notes[1].id).toBe(first.note.id);
  });

  it("ties on createdAt break by id DESC (keyset-stable ordering)", async () => {
    const sharedTimestamp = new Date("2026-01-01T00:00:00.000Z");
    const rowA = await prisma.timelineNote.create({
      data: {
        organizationId: fixtures.orgA.id,
        authorId: fixtures.owner.id,
        entityType: "CLIENT",
        entityId: fixtures.clientA.id,
        body: "Row A",
        createdAt: sharedTimestamp,
      },
    });
    const rowB = await prisma.timelineNote.create({
      data: {
        organizationId: fixtures.orgA.id,
        authorId: fixtures.owner.id,
        entityType: "CLIENT",
        entityId: fixtures.clientA.id,
        body: "Row B",
        createdAt: sharedTimestamp,
      },
    });

    const list = await listTimelineNotesForEntity(fixtures.orgA.id, "CLIENT", fixtures.clientA.id);
    if (!list.ok) throw new Error("expected ok");
    const ids = list.notes.map((n) => n.id);
    const expectedOrder = [rowA.id, rowB.id].sort().reverse();
    expect(ids.slice(0, 2)).toEqual(expectedOrder);
  });

  // ---------------------------------------------------------------------
  // Side-effect isolation
  // ---------------------------------------------------------------------

  it("create/edit/delete never produce an Activity, Notification, or WorkflowAutomationRun row", async () => {
    const before = await countSideEffects(fixtures.orgA.id);

    const created = await createTimelineNote(fixtures.orgA.id, actorFor(fixtures, "owner"), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "No side effects, please.",
    });
    if (!created.ok) throw new Error("expected ok");
    await editTimelineNote(fixtures.orgA.id, created.note.id, actorFor(fixtures, "owner"), "Edited, still no side effects.");
    await deleteTimelineNote(fixtures.orgA.id, created.note.id, actorFor(fixtures, "owner"));

    const after = await countSideEffects(fixtures.orgA.id);
    expect(after).toEqual(before);
  });
});
