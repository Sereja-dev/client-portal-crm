import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createClientTimelineNoteAction,
  editClientTimelineNoteAction,
  deleteClientTimelineNoteAction,
} from "@/app/(dashboard)/clients/[id]/edit/timeline-actions";
import {
  createLeadTimelineNoteAction,
  editLeadTimelineNoteAction,
  deleteLeadTimelineNoteAction,
} from "@/app/(dashboard)/leads/[id]/edit/timeline-actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Communication Timeline Phase 2 — the Server Action layer binding
 * src/lib/timeline/notes.ts's own unchanged domain functions to the
 * Client/Lead edit pages. Every action here resolves the authenticated
 * Staff member's own membership itself (getCurrentMembership()) and
 * never trusts organizationId/authorId from client input — proven here
 * by acting as different roles/organizations and confirming the
 * server-resolved identity, never a forgeable one, is what actually gets
 * persisted/enforced.
 */

function formData(fields: Record<string, string | undefined>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) fd.set(key, value);
  }
  return fd;
}

async function createLead(organizationId: string, name = "Test Lead") {
  return prisma.lead.create({ data: { organizationId, name } });
}

describe("Communication Timeline — Staff Server Actions", () => {
  let fixtures: TestFixtures;
  const extraLeadIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    resetAuthMock();
    await prisma.timelineNote.deleteMany({ where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    if (extraLeadIds.length) {
      await prisma.lead.deleteMany({ where: { id: { in: extraLeadIds } } });
      extraLeadIds.length = 0;
    }
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("OWNER, ADMIN, and MEMBER can each add a Client note", async () => {
    for (const who of ["owner", "admin", "member"] as const) {
      actAs(fixtures[who], fixtures.orgA.id);
      const result = await createClientTimelineNoteAction(
        fixtures.clientA.id,
        { error: null },
        formData({ body: `Note by ${who}` }),
      );
      expect(result).toEqual({ error: null });
    }

    const notes = await prisma.timelineNote.findMany({ where: { entityId: fixtures.clientA.id } });
    expect(notes).toHaveLength(3);
  });

  it("the action derives organization/user server-side — a MEMBER cannot forge authorship of another user", async () => {
    actAs(fixtures.member, fixtures.orgA.id);
    await createClientTimelineNoteAction(fixtures.clientA.id, { error: null }, formData({ body: "Real body" }));

    const note = await prisma.timelineNote.findFirstOrThrow({ where: { entityId: fixtures.clientA.id } });
    expect(note.authorId).toBe(fixtures.member.id);
    expect(note.organizationId).toBe(fixtures.orgA.id);
  });

  it("an invalid/foreign Client id is rejected with a friendly error, not a thrown exception", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createClientTimelineNoteAction(fixtures.clientB.id, { error: null }, formData({ body: "Nope" }));
    expect(result).toEqual({ error: "This client could not be found." });
    expect(await prisma.timelineNote.count({ where: { entityId: fixtures.clientB.id } })).toBe(0);
  });

  it("an invalid/foreign Lead id is rejected with a friendly error", async () => {
    const leadInOrgB = await createLead(fixtures.orgB.id, "Org B Lead");
    extraLeadIds.push(leadInOrgB.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createLeadTimelineNoteAction(leadInOrgB.id, { error: null }, formData({ body: "Nope" }));
    expect(result).toEqual({ error: "This lead could not be found." });
  });

  it("empty body is rejected with a friendly error", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createClientTimelineNoteAction(fixtures.clientA.id, { error: null }, formData({ body: "   " }));
    expect(result).toEqual({ error: "Write something before adding a note." });
  });

  it("edit: the author can edit their own note", async () => {
    actAs(fixtures.member, fixtures.orgA.id);
    await createClientTimelineNoteAction(fixtures.clientA.id, { error: null }, formData({ body: "Original" }));
    const note = await prisma.timelineNote.findFirstOrThrow({ where: { entityId: fixtures.clientA.id } });

    const result = await editClientTimelineNoteAction(fixtures.clientA.id, note.id, { error: null }, formData({ body: "Updated" }));
    expect(result).toEqual({ error: null });
    const reloaded = await prisma.timelineNote.findUniqueOrThrow({ where: { id: note.id } });
    expect(reloaded.body).toBe("Updated");
    expect(reloaded.editedAt).not.toBeNull();
  });

  it("edit: OWNER can edit another user's note (moderation), preserving the original author", async () => {
    actAs(fixtures.member, fixtures.orgA.id);
    await createClientTimelineNoteAction(fixtures.clientA.id, { error: null }, formData({ body: "Member's note" }));
    const note = await prisma.timelineNote.findFirstOrThrow({ where: { entityId: fixtures.clientA.id } });

    actAs(fixtures.owner, fixtures.orgA.id);
    const ownerEdit = await editClientTimelineNoteAction(fixtures.clientA.id, note.id, { error: null }, formData({ body: "Moderated" }));
    expect(ownerEdit).toEqual({ error: null });

    const reloaded = await prisma.timelineNote.findUniqueOrThrow({ where: { id: note.id } });
    expect(reloaded.body).toBe("Moderated");
    expect(reloaded.authorId).toBe(fixtures.member.id);
  });

  it("edit: a MEMBER cannot edit another MEMBER's note (genuine FORBIDDEN path)", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await createClientTimelineNoteAction(fixtures.clientA.id, { error: null }, formData({ body: "Owner's note" }));
    const note = await prisma.timelineNote.findFirstOrThrow({ where: { entityId: fixtures.clientA.id } });

    actAs(fixtures.member, fixtures.orgA.id);
    const result = await editClientTimelineNoteAction(fixtures.clientA.id, note.id, { error: null }, formData({ body: "Hijack" }));
    expect(result).toEqual({ error: "You can only edit your own notes." });
    const reloaded = await prisma.timelineNote.findUniqueOrThrow({ where: { id: note.id } });
    expect(reloaded.body).toBe("Owner's note");
  });

  it("delete: the author can delete their own note; a MEMBER cannot delete another user's note", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await createClientTimelineNoteAction(fixtures.clientA.id, { error: null }, formData({ body: "Owner's note" }));
    const note = await prisma.timelineNote.findFirstOrThrow({ where: { entityId: fixtures.clientA.id } });

    actAs(fixtures.member, fixtures.orgA.id);
    await expect(deleteClientTimelineNoteAction(fixtures.clientA.id, note.id)).rejects.toThrow(
      "You can only delete your own notes.",
    );
    const stillThere = await prisma.timelineNote.findUniqueOrThrow({ where: { id: note.id } });
    expect(stillThere.deletedAt).toBeNull();

    actAs(fixtures.owner, fixtures.orgA.id);
    await deleteClientTimelineNoteAction(fixtures.clientA.id, note.id);
    const deleted = await prisma.timelineNote.findUniqueOrThrow({ where: { id: note.id } });
    expect(deleted.deletedAt).not.toBeNull();
  });

  it("delete: ADMIN can delete another user's note", async () => {
    actAs(fixtures.member, fixtures.orgA.id);
    await createClientTimelineNoteAction(fixtures.clientA.id, { error: null }, formData({ body: "Member's note" }));
    const note = await prisma.timelineNote.findFirstOrThrow({ where: { entityId: fixtures.clientA.id } });

    actAs(fixtures.admin, fixtures.orgA.id);
    await deleteClientTimelineNoteAction(fixtures.clientA.id, note.id);
    const deleted = await prisma.timelineNote.findUniqueOrThrow({ where: { id: note.id } });
    expect(deleted.deletedAt).not.toBeNull();
  });

  it("Lead note create/edit/delete works through the Lead-scoped actions", async () => {
    const lead = await createLead(fixtures.orgA.id, "Action Test Lead");
    extraLeadIds.push(lead.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createLeadTimelineNoteAction(lead.id, { error: null }, formData({ body: "Sent a proposal" }));
    expect(created).toEqual({ error: null });
    const note = await prisma.timelineNote.findFirstOrThrow({ where: { entityId: lead.id } });

    const edited = await editLeadTimelineNoteAction(lead.id, note.id, { error: null }, formData({ body: "Sent a revised proposal" }));
    expect(edited).toEqual({ error: null });

    await deleteLeadTimelineNoteAction(lead.id, note.id);
    const deleted = await prisma.timelineNote.findUniqueOrThrow({ where: { id: note.id } });
    expect(deleted.deletedAt).not.toBeNull();
  });

  it("a successful create/edit/delete never redirects — each resolves a plain value, never a RedirectSignal-style control-flow exception", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createClientTimelineNoteAction(fixtures.clientA.id, { error: null }, formData({ body: "No redirect" }));
    expect(created).toEqual({ error: null });
    const note = await prisma.timelineNote.findFirstOrThrow({ where: { entityId: fixtures.clientA.id } });

    const edited = await editClientTimelineNoteAction(fixtures.clientA.id, note.id, { error: null }, formData({ body: "Still no redirect" }));
    expect(edited).toEqual({ error: null });

    await expect(deleteClientTimelineNoteAction(fixtures.clientA.id, note.id)).resolves.toBeUndefined();
  });

  it("side effects: creating/editing/deleting a note never produces an Activity, Notification, or WorkflowAutomationRun row", async () => {
    const before = await Promise.all([
      prisma.activity.count({ where: { organizationId: fixtures.orgA.id } }),
      prisma.notification.count({ where: { organizationId: fixtures.orgA.id } }),
      prisma.workflowAutomationRun.count({ where: { workflowAutomation: { organizationId: fixtures.orgA.id } } }),
    ]);

    actAs(fixtures.owner, fixtures.orgA.id);
    await createClientTimelineNoteAction(fixtures.clientA.id, { error: null }, formData({ body: "No side effects" }));
    const note = await prisma.timelineNote.findFirstOrThrow({ where: { entityId: fixtures.clientA.id } });
    await editClientTimelineNoteAction(fixtures.clientA.id, note.id, { error: null }, formData({ body: "Still none" }));
    await deleteClientTimelineNoteAction(fixtures.clientA.id, note.id);

    const after = await Promise.all([
      prisma.activity.count({ where: { organizationId: fixtures.orgA.id } }),
      prisma.notification.count({ where: { organizationId: fixtures.orgA.id } }),
      prisma.workflowAutomationRun.count({ where: { workflowAutomation: { organizationId: fixtures.orgA.id } } }),
    ]);

    expect(after).toEqual(before);
  });
});
