import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTag, archiveTag, type TagActor } from "@/lib/tags/definitions";
import { assignTag, unassignTag, getTagsForEntity } from "@/lib/tags/assignments";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Tags V1 Phase 1 — Assignment domain-layer coverage: assignTag/
 * unassignTag/getTagsForEntity, open to every Staff role, with each
 * operation independently re-verifying both the Tag and the entity
 * against the authoritative organizationId (never trusting a caller-
 * supplied one). Definition lifecycle coverage lives in
 * definitions.test.ts; "no unrelated behavior changed" coverage lives in
 * boundaries.test.ts.
 */

const OWNER_ROLE = "OWNER" as const;

async function cleanupTags(organizationId: string) {
  await prisma.tagAssignment.deleteMany({ where: { organizationId } });
  await prisma.tag.deleteMany({ where: { organizationId } });
}

function ownerActor(fixtures: TestFixtures): TagActor {
  return { id: fixtures.owner.id, name: fixtures.owner.name, role: OWNER_ROLE };
}

async function createLead(organizationId: string, name = "Test Lead") {
  return prisma.lead.create({ data: { organizationId, name } });
}

describe("Tags — Assignment domain layer", () => {
  let fixtures: TestFixtures;
  const extraLeadIds: string[] = [];
  const extraClientIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupTags(fixtures.orgA.id);
    await cleanupTags(fixtures.orgB.id);
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

  it("OWNER, ADMIN, and MEMBER can each assign an existing active tag", async () => {
    const owner = ownerActor(fixtures);
    const created = await createTag(fixtures.orgA.id, owner, { name: "Assignable" }, prisma);
    if (!created.ok) throw new Error("expected ok");
    const lead = await createLead(fixtures.orgA.id);
    extraLeadIds.push(lead.id);

    // The domain layer itself has no role gate on assignment — this
    // proves the point structurally: calling assignTag with no actor
    // parameter at all succeeds regardless of which role is driving it
    // at the Server Action layer (out of scope for this phase).
    const result = await assignTag(fixtures.orgA.id, created.tag.id, "LEAD", lead.id, prisma);
    expect(result.ok).toBe(true);
  });

  it("a tag can be assigned to a Client", async () => {
    const owner = ownerActor(fixtures);
    const created = await createTag(fixtures.orgA.id, owner, { name: "Client Tag" }, prisma);
    if (!created.ok) throw new Error("expected ok");

    const result = await assignTag(fixtures.orgA.id, created.tag.id, "CLIENT", fixtures.clientA.id, prisma);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.assignment.entityType).toBe("CLIENT");
    expect(result.assignment.entityId).toBe(fixtures.clientA.id);
    expect(result.assignment.organizationId).toBe(fixtures.orgA.id);
  });

  it("a tag can be assigned to a Lead", async () => {
    const owner = ownerActor(fixtures);
    const created = await createTag(fixtures.orgA.id, owner, { name: "Lead Tag" }, prisma);
    if (!created.ok) throw new Error("expected ok");
    const lead = await createLead(fixtures.orgA.id);
    extraLeadIds.push(lead.id);

    const result = await assignTag(fixtures.orgA.id, created.tag.id, "LEAD", lead.id, prisma);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.assignment.entityType).toBe("LEAD");
    expect(result.assignment.entityId).toBe(lead.id);

    const tagsForLead = await getTagsForEntity(fixtures.orgA.id, "LEAD", lead.id, prisma);
    expect(tagsForLead.ok).toBe(true);
    if (!tagsForLead.ok) throw new Error("expected ok");
    expect(tagsForLead.tags.map((t) => t.id)).toEqual([created.tag.id]);
  });

  it("unassignTag removes the assignment", async () => {
    const owner = ownerActor(fixtures);
    const created = await createTag(fixtures.orgA.id, owner, { name: "Unassign Me" }, prisma);
    if (!created.ok) throw new Error("expected ok");
    await assignTag(fixtures.orgA.id, created.tag.id, "CLIENT", fixtures.clientA.id, prisma);

    const unassigned = await unassignTag(fixtures.orgA.id, created.tag.id, "CLIENT", fixtures.clientA.id, prisma);
    expect(unassigned).toEqual({ ok: true });

    const tagsForClient = await getTagsForEntity(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, prisma);
    if (!tagsForClient.ok) throw new Error("expected ok");
    expect(tagsForClient.tags.find((t) => t.id === created.tag.id)).toBeUndefined();
  });

  it("unassignTag on a nonexistent assignment is a safe no-op", async () => {
    const owner = ownerActor(fixtures);
    const created = await createTag(fixtures.orgA.id, owner, { name: "Never Assigned" }, prisma);
    if (!created.ok) throw new Error("expected ok");

    const result = await unassignTag(fixtures.orgA.id, created.tag.id, "CLIENT", fixtures.clientA.id, prisma);
    expect(result).toEqual({ ok: true });
  });

  it("assigning the same tag to the same entity twice produces no duplicate row (idempotent)", async () => {
    const owner = ownerActor(fixtures);
    const created = await createTag(fixtures.orgA.id, owner, { name: "Dedup" }, prisma);
    if (!created.ok) throw new Error("expected ok");

    const first = await assignTag(fixtures.orgA.id, created.tag.id, "CLIENT", fixtures.clientA.id, prisma);
    const second = await assignTag(fixtures.orgA.id, created.tag.id, "CLIENT", fixtures.clientA.id, prisma);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(second.assignment.id).toBe(first.assignment.id);

    const rows = await prisma.tagAssignment.findMany({
      where: { tagId: created.tag.id, entityType: "CLIENT", entityId: fixtures.clientA.id },
    });
    expect(rows).toHaveLength(1);
  });

  it("the same tag can be attached to a Client and a Lead sharing the same raw UUID value (the extra entityType discriminator matters)", async () => {
    const owner = ownerActor(fixtures);
    const created = await createTag(fixtures.orgA.id, owner, { name: "Shared UUID" }, prisma);
    if (!created.ok) throw new Error("expected ok");

    const sharedId = randomUUID();
    const client = await prisma.client.create({
      data: { id: sharedId, name: "Shared Id Client", organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    extraClientIds.push(client.id);
    const lead = await prisma.lead.create({ data: { id: sharedId, organizationId: fixtures.orgA.id, name: "Shared Id Lead" } });
    extraLeadIds.push(lead.id);

    const clientAssignment = await assignTag(fixtures.orgA.id, created.tag.id, "CLIENT", sharedId, prisma);
    const leadAssignment = await assignTag(fixtures.orgA.id, created.tag.id, "LEAD", sharedId, prisma);
    expect(clientAssignment.ok).toBe(true);
    expect(leadAssignment.ok).toBe(true);
    if (!clientAssignment.ok || !leadAssignment.ok) throw new Error("expected ok");
    expect(clientAssignment.assignment.id).not.toBe(leadAssignment.assignment.id);

    const rows = await prisma.tagAssignment.findMany({ where: { tagId: created.tag.id } });
    expect(rows).toHaveLength(2);
  });

  it("assigning a newly archived tag is rejected, but re-affirming an already-existing assignment on a since-archived tag still succeeds", async () => {
    const owner = ownerActor(fixtures);
    const created = await createTag(fixtures.orgA.id, owner, { name: "Archive Then Assign" }, prisma);
    if (!created.ok) throw new Error("expected ok");

    // Establish the assignment first, while the tag is still active.
    const preArchiveAssignment = await assignTag(fixtures.orgA.id, created.tag.id, "CLIENT", fixtures.clientA.id, prisma);
    expect(preArchiveAssignment.ok).toBe(true);

    await archiveTag(fixtures.orgA.id, created.tag.id, owner, prisma);

    // Re-affirming the SAME assignment must still succeed — archiving
    // only blocks a genuinely new assignment, never an idempotent replay
    // of one that already existed.
    const reaffirmed = await assignTag(fixtures.orgA.id, created.tag.id, "CLIENT", fixtures.clientA.id, prisma);
    expect(reaffirmed.ok).toBe(true);

    // But a brand-new assignment against the now-archived tag is rejected.
    const lead = await createLead(fixtures.orgA.id);
    extraLeadIds.push(lead.id);
    const newAssignment = await assignTag(fixtures.orgA.id, created.tag.id, "LEAD", lead.id, prisma);
    expect(newAssignment).toEqual({ ok: false, reason: "TAG_ARCHIVED" });
  });

  it("an archived tag's pre-existing assignment remains resolvable via getTagsForEntity", async () => {
    const owner = ownerActor(fixtures);
    const created = await createTag(fixtures.orgA.id, owner, { name: "Still Resolvable" }, prisma);
    if (!created.ok) throw new Error("expected ok");
    await assignTag(fixtures.orgA.id, created.tag.id, "CLIENT", fixtures.clientA.id, prisma);
    await archiveTag(fixtures.orgA.id, created.tag.id, owner, prisma);

    const tagsForClient = await getTagsForEntity(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, prisma);
    if (!tagsForClient.ok) throw new Error("expected ok");
    const found = tagsForClient.tags.find((t) => t.id === created.tag.id);
    expect(found).toBeDefined();
    expect(found?.archivedAt).not.toBeNull();
  });

  // -------------------------------------------------------------------
  // Tenant security
  // -------------------------------------------------------------------

  it("a cross-org tag id is rejected as TAG_NOT_FOUND, never revealing its existence", async () => {
    const owner = ownerActor(fixtures);
    const created = await createTag(fixtures.orgA.id, owner, { name: "Org A Tag" }, prisma);
    if (!created.ok) throw new Error("expected ok");

    const result = await assignTag(fixtures.orgB.id, created.tag.id, "CLIENT", fixtures.clientB.id, prisma);
    expect(result).toEqual({ ok: false, reason: "TAG_NOT_FOUND" });

    const unassignResult = await unassignTag(fixtures.orgB.id, created.tag.id, "CLIENT", fixtures.clientB.id, prisma);
    expect(unassignResult).toEqual({ ok: false, reason: "TAG_NOT_FOUND" });
  });

  it("a cross-org entity id is rejected as ENTITY_NOT_FOUND", async () => {
    const owner = ownerActor(fixtures);
    const created = await createTag(fixtures.orgA.id, owner, { name: "For Cross Org Entity" }, prisma);
    if (!created.ok) throw new Error("expected ok");

    // clientB genuinely exists, just under orgB, not orgA.
    const result = await assignTag(fixtures.orgA.id, created.tag.id, "CLIENT", fixtures.clientB.id, prisma);
    expect(result).toEqual({ ok: false, reason: "ENTITY_NOT_FOUND" });

    const tagsForEntity = await getTagsForEntity(fixtures.orgA.id, "CLIENT", fixtures.clientB.id, prisma);
    expect(tagsForEntity).toEqual({ ok: false, reason: "ENTITY_NOT_FOUND" });
  });

  it("a Client with a null organizationId (legacy row) is rejected — null is never treated as a match for any organizationId", async () => {
    const owner = ownerActor(fixtures);
    const created = await createTag(fixtures.orgA.id, owner, { name: "Legacy Guard" }, prisma);
    if (!created.ok) throw new Error("expected ok");

    const orphanClient = await prisma.client.create({
      data: { name: "Orphan Client", organizationId: null, userId: fixtures.owner.id },
    });
    extraClientIds.push(orphanClient.id);

    const result = await assignTag(fixtures.orgA.id, created.tag.id, "CLIENT", orphanClient.id, prisma);
    expect(result).toEqual({ ok: false, reason: "ENTITY_NOT_FOUND" });

    const tagsForEntity = await getTagsForEntity(fixtures.orgA.id, "CLIENT", orphanClient.id, prisma);
    expect(tagsForEntity).toEqual({ ok: false, reason: "ENTITY_NOT_FOUND" });
  });

  it("a Lead belonging to a different organization is rejected the same way", async () => {
    const owner = ownerActor(fixtures);
    const created = await createTag(fixtures.orgA.id, owner, { name: "Lead Cross Org" }, prisma);
    if (!created.ok) throw new Error("expected ok");
    const leadInOrgB = await createLead(fixtures.orgB.id, "Org B Lead");
    extraLeadIds.push(leadInOrgB.id);

    const result = await assignTag(fixtures.orgA.id, created.tag.id, "LEAD", leadInOrgB.id, prisma);
    expect(result).toEqual({ ok: false, reason: "ENTITY_NOT_FOUND" });
  });

  it("the assignment's own organizationId is always the authoritative one passed in, never inferred from anything else", async () => {
    const owner = ownerActor(fixtures);
    const created = await createTag(fixtures.orgA.id, owner, { name: "Authoritative Org" }, prisma);
    if (!created.ok) throw new Error("expected ok");

    const result = await assignTag(fixtures.orgA.id, created.tag.id, "CLIENT", fixtures.clientA.id, prisma);
    if (!result.ok) throw new Error("expected ok");
    expect(result.assignment.organizationId).toBe(fixtures.orgA.id);
  });
});
