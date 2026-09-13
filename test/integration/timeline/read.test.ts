import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getTimelineForEntity, TIMELINE_MERGE_LIMIT } from "@/lib/timeline/timeline";
import { createTimelineNote, type TimelineNoteActor } from "@/lib/timeline/notes";
import { createActivity } from "@/lib/activity/create-activity";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Communication Timeline Phase 2 — the entity-scoped read/merge layer
 * (src/lib/timeline/timeline.ts). Covers correct Client/Lead Activity +
 * TimelineNote merging, ordering, bounding, tenant isolation, and the
 * "Client activity never appears on a Lead timeline and vice versa"
 * cross-entity-type guarantee.
 */

function ownerActor(fixtures: TestFixtures): TimelineNoteActor {
  return { id: fixtures.owner.id, name: fixtures.owner.name, role: "OWNER" };
}

async function createLead(organizationId: string, name = "Test Lead") {
  return prisma.lead.create({ data: { organizationId, name } });
}

describe("Communication Timeline — read/merge layer", () => {
  let fixtures: TestFixtures;
  const extraLeadIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await prisma.timelineNote.deleteMany({ where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    await prisma.activity.deleteMany({ where: { organizationId: fixtures.orgA.id, entityId: { not: fixtures.clientA.id } } });
    if (extraLeadIds.length) {
      await prisma.lead.deleteMany({ where: { id: { in: extraLeadIds } } });
      extraLeadIds.length = 0;
    }
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("merges this Client's own Activity rows and notes, newest first", async () => {
    // fixtures.clientA already has one seeded CREATED Activity row.
    const note = await createTimelineNote(fixtures.orgA.id, ownerActor(fixtures), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "Called about renewal.",
    });
    if (!note.ok) throw new Error("expected ok");

    const result = await getTimelineForEntity(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, ownerActor(fixtures));
    if (!result.ok) throw new Error("expected ok");

    expect(result.items.some((item) => item.kind === "activity")).toBe(true);
    expect(result.items.some((item) => item.kind === "note" && item.id === note.note.id)).toBe(true);
    // Newest first: the just-created note is more recent than the seed
    // fixture's own CREATED Activity row.
    expect(result.items[0].kind).toBe("note");
    expect((result.items[0] as Extract<(typeof result.items)[number], { kind: "note" }>).id).toBe(note.note.id);
  });

  it("merges this Lead's own Activity rows and notes, newest first", async () => {
    const lead = await createLead(fixtures.orgA.id);
    extraLeadIds.push(lead.id);
    await prisma.$transaction((tx) =>
      createActivity(tx, {
        organizationId: fixtures.orgA.id,
        actorId: fixtures.owner.id,
        entityType: "LEAD",
        entityId: lead.id,
        action: "CREATED",
        metadata: { name: lead.name, stage: "NEW", actorName: fixtures.owner.name },
      }),
    );
    const note = await createTimelineNote(fixtures.orgA.id, ownerActor(fixtures), {
      entityType: "LEAD",
      entityId: lead.id,
      body: "Sent a proposal.",
    });
    if (!note.ok) throw new Error("expected ok");

    const result = await getTimelineForEntity(fixtures.orgA.id, "LEAD", lead.id, ownerActor(fixtures));
    if (!result.ok) throw new Error("expected ok");
    expect(result.items).toHaveLength(2);
    expect(result.items[0].kind).toBe("note");
    expect(result.items[1].kind).toBe("activity");
  });

  it("a deleted note is absent from the merged timeline", async () => {
    const created = await createTimelineNote(fixtures.orgA.id, ownerActor(fixtures), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "Will be deleted.",
    });
    if (!created.ok) throw new Error("expected ok");
    await prisma.timelineNote.update({ where: { id: created.note.id }, data: { deletedAt: new Date() } });

    const result = await getTimelineForEntity(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, ownerActor(fixtures));
    if (!result.ok) throw new Error("expected ok");
    expect(result.items.some((item) => item.kind === "note" && item.id === created.note.id)).toBe(false);
  });

  it("foreign-org data is absent — the read is scoped by organizationId, never entityId alone", async () => {
    const result = await getTimelineForEntity(fixtures.orgB.id, "CLIENT", fixtures.clientA.id, {
      id: fixtures.orgBOwner.id,
      name: fixtures.orgBOwner.name,
      role: "OWNER",
    });
    expect(result).toEqual({ ok: false, reason: "ENTITY_NOT_FOUND" });
  });

  it("a Client's activity never appears on a Lead's own timeline, and vice versa, even with identical actors/org", async () => {
    const lead = await createLead(fixtures.orgA.id, "Cross Entity Lead");
    extraLeadIds.push(lead.id);

    const clientTimeline = await getTimelineForEntity(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, ownerActor(fixtures));
    const leadTimeline = await getTimelineForEntity(fixtures.orgA.id, "LEAD", lead.id, ownerActor(fixtures));
    if (!clientTimeline.ok || !leadTimeline.ok) throw new Error("expected ok");

    const clientIds = new Set(clientTimeline.items.map((item) => item.id));
    const leadIds = new Set(leadTimeline.items.map((item) => item.id));
    for (const id of clientIds) {
      expect(leadIds.has(id)).toBe(false);
    }
  });

  it("the merged result is bounded to TIMELINE_MERGE_LIMIT", async () => {
    const lead = await createLead(fixtures.orgA.id, "Bounded Lead");
    extraLeadIds.push(lead.id);

    for (let i = 0; i < TIMELINE_MERGE_LIMIT + 10; i++) {
      const result = await createTimelineNote(fixtures.orgA.id, ownerActor(fixtures), {
        entityType: "LEAD",
        entityId: lead.id,
        body: `Note ${i}`,
      });
      if (!result.ok) throw new Error("expected ok");
    }

    const timeline = await getTimelineForEntity(fixtures.orgA.id, "LEAD", lead.id, ownerActor(fixtures));
    if (!timeline.ok) throw new Error("expected ok");
    expect(timeline.items.length).toBeLessThanOrEqual(TIMELINE_MERGE_LIMIT);
  });

  it("ordering is deterministic on a tie (same createdAt)", async () => {
    const lead = await createLead(fixtures.orgA.id, "Tie Break Lead");
    extraLeadIds.push(lead.id);
    const sharedTimestamp = new Date("2026-01-01T00:00:00.000Z");

    const noteA = await prisma.timelineNote.create({
      data: { organizationId: fixtures.orgA.id, authorId: fixtures.owner.id, entityType: "LEAD", entityId: lead.id, body: "A", createdAt: sharedTimestamp },
    });
    const noteB = await prisma.timelineNote.create({
      data: { organizationId: fixtures.orgA.id, authorId: fixtures.owner.id, entityType: "LEAD", entityId: lead.id, body: "B", createdAt: sharedTimestamp },
    });

    const first = await getTimelineForEntity(fixtures.orgA.id, "LEAD", lead.id, ownerActor(fixtures));
    const second = await getTimelineForEntity(fixtures.orgA.id, "LEAD", lead.id, ownerActor(fixtures));
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(first.items.map((i) => i.id)).toEqual(second.items.map((i) => i.id));
    expect(new Set(first.items.map((i) => i.id))).toEqual(new Set([noteA.id, noteB.id]));
  });

  it("a legacy Client with a null organizationId is rejected, never treated as a match", async () => {
    const orphanClient = await prisma.client.create({
      data: { name: "Orphan Client", organizationId: null, userId: fixtures.owner.id },
    });
    const result = await getTimelineForEntity(fixtures.orgA.id, "CLIENT", orphanClient.id, ownerActor(fixtures));
    expect(result).toEqual({ ok: false, reason: "ENTITY_NOT_FOUND" });
    await prisma.client.delete({ where: { id: orphanClient.id } });
  });

  it("note permissions are computed correctly per actor — MEMBER cannot edit/delete another user's note", async () => {
    const created = await createTimelineNote(fixtures.orgA.id, ownerActor(fixtures), {
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      body: "Owner's note.",
    });
    if (!created.ok) throw new Error("expected ok");

    const memberActor: TimelineNoteActor = { id: fixtures.member.id, name: fixtures.member.name, role: "MEMBER" };
    const result = await getTimelineForEntity(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, memberActor);
    if (!result.ok) throw new Error("expected ok");
    const noteItem = result.items.find((item) => item.kind === "note" && item.id === created.note.id);
    if (!noteItem || noteItem.kind !== "note") throw new Error("note not found");
    expect(noteItem.permissions).toEqual({ canEdit: false, canDelete: false });

    const ownerResult = await getTimelineForEntity(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, ownerActor(fixtures));
    if (!ownerResult.ok) throw new Error("expected ok");
    const ownerNoteItem = ownerResult.items.find((item) => item.kind === "note" && item.id === created.note.id);
    if (!ownerNoteItem || ownerNoteItem.kind !== "note") throw new Error("note not found");
    expect(ownerNoteItem.permissions).toEqual({ canEdit: true, canDelete: true });
  });
});
