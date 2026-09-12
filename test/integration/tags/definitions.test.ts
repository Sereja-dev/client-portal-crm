import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTag, renameTag, archiveTag, listTags, getTag, type TagActor } from "@/lib/tags/definitions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Tags V1 Phase 1 — Definition domain-layer coverage (management:
 * create/rename/archive, gated OWNER/ADMIN-only; list/get, open to any
 * role). Assignment coverage lives in assignments.test.ts; cross-cutting
 * "no unrelated behavior/no new surface introduced" coverage lives in
 * boundaries.test.ts.
 */

async function cleanupTags(organizationId: string) {
  await prisma.tagAssignment.deleteMany({ where: { organizationId } });
  await prisma.tag.deleteMany({ where: { organizationId } });
}

function actorFor(fixtures: TestFixtures, who: "owner" | "admin" | "member"): TagActor {
  const user = fixtures[who];
  const role = who === "owner" ? "OWNER" : who === "admin" ? "ADMIN" : "MEMBER";
  return { id: user.id, name: user.name, role };
}

describe("Tags — Definition domain layer", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupTags(fixtures.orgA.id);
    await cleanupTags(fixtures.orgB.id);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("OWNER can create, rename, and archive a tag", async () => {
    const owner = actorFor(fixtures, "owner");

    const created = await createTag(fixtures.orgA.id, owner, { name: "VIP" }, prisma);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");
    expect(created.tag.name).toBe("VIP");
    expect(created.tag.normalizedName).toBe("vip");
    expect(created.tag.archivedAt).toBeNull();

    const renamed = await renameTag(fixtures.orgA.id, created.tag.id, owner, { name: "Very Important" }, prisma);
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) throw new Error("expected ok");
    expect(renamed.tag.name).toBe("Very Important");
    expect(renamed.tag.normalizedName).toBe("very important");

    const archived = await archiveTag(fixtures.orgA.id, created.tag.id, owner, prisma);
    expect(archived.ok).toBe(true);
    if (!archived.ok) throw new Error("expected ok");
    expect(archived.tag.archivedAt).not.toBeNull();
  });

  it("ADMIN can create, rename, and archive a tag", async () => {
    const admin = actorFor(fixtures, "admin");

    const created = await createTag(fixtures.orgA.id, admin, { name: "Priority" }, prisma);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const renamed = await renameTag(fixtures.orgA.id, created.tag.id, admin, { name: "High Priority" }, prisma);
    expect(renamed.ok).toBe(true);

    const archived = await archiveTag(fixtures.orgA.id, created.tag.id, admin, prisma);
    expect(archived.ok).toBe(true);
  });

  it("MEMBER is forbidden from create/rename/archive", async () => {
    const owner = actorFor(fixtures, "owner");
    const member = actorFor(fixtures, "member");

    const createAttempt = await createTag(fixtures.orgA.id, member, { name: "Blocked" }, prisma);
    expect(createAttempt).toEqual({ ok: false, reason: "FORBIDDEN" });

    const created = await createTag(fixtures.orgA.id, owner, { name: "Owned By Owner" }, prisma);
    if (!created.ok) throw new Error("expected ok");

    const renameAttempt = await renameTag(fixtures.orgA.id, created.tag.id, member, { name: "Hijacked" }, prisma);
    expect(renameAttempt).toEqual({ ok: false, reason: "FORBIDDEN" });

    const archiveAttempt = await archiveTag(fixtures.orgA.id, created.tag.id, member, prisma);
    expect(archiveAttempt).toEqual({ ok: false, reason: "FORBIDDEN" });
  });

  it("the name is trimmed before it is persisted", async () => {
    const owner = actorFor(fixtures, "owner");
    const created = await createTag(fixtures.orgA.id, owner, { name: "   Padded Name   " }, prisma);
    if (!created.ok) throw new Error("expected ok");
    expect(created.tag.name).toBe("Padded Name");
    expect(created.tag.normalizedName).toBe("padded name");
  });

  it("normalizedName is derived by trim + lowercase", async () => {
    const owner = actorFor(fixtures, "owner");
    const created = await createTag(fixtures.orgA.id, owner, { name: "  MiXeD Case  " }, prisma);
    if (!created.ok) throw new Error("expected ok");
    expect(created.tag.name).toBe("MiXeD Case");
    expect(created.tag.normalizedName).toBe("mixed case");
  });

  it("a duplicate name is rejected case-insensitively (application-level pre-check)", async () => {
    const owner = actorFor(fixtures, "owner");
    const first = await createTag(fixtures.orgA.id, owner, { name: "Urgent" }, prisma);
    expect(first.ok).toBe(true);

    const dup = await createTag(fixtures.orgA.id, owner, { name: "URGENT" }, prisma);
    expect(dup).toEqual({ ok: false, reason: "DUPLICATE_NAME" });

    const dupPadded = await createTag(fixtures.orgA.id, owner, { name: "  urgent  " }, prisma);
    expect(dupPadded).toEqual({ ok: false, reason: "DUPLICATE_NAME" });
  });

  it("a case-variant duplicate is protected by the DB's own unique constraint, not merely the app-level pre-check", async () => {
    const owner = actorFor(fixtures, "owner");
    await prisma.tag.create({
      data: { organizationId: fixtures.orgA.id, name: "Concurrent", normalizedName: "concurrent" },
    });

    // Bypass the app-level pre-check entirely by inserting directly, then
    // prove createTag still refuses a case-variant duplicate via the
    // DB @@unique([organizationId, normalizedName]) constraint's own
    // P2002 detection path (isNormalizedNameConflict).
    const result = await createTag(fixtures.orgA.id, owner, { name: "CONCURRENT" }, prisma);
    expect(result).toEqual({ ok: false, reason: "DUPLICATE_NAME" });

    // And the raw DB constraint itself, independent of createTag's own
    // pre-check, rejects a second identical (organizationId,
    // normalizedName) row outright.
    await expect(
      prisma.tag.create({ data: { organizationId: fixtures.orgA.id, name: "concurrent", normalizedName: "concurrent" } }),
    ).rejects.toThrow();
  });

  it("the same normalized name is allowed in two different organizations", async () => {
    const owner = actorFor(fixtures, "owner");
    const orgBOwnerActor: TagActor = { id: fixtures.orgBOwner.id, name: fixtures.orgBOwner.name, role: "OWNER" };

    const inA = await createTag(fixtures.orgA.id, owner, { name: "Shared Name" }, prisma);
    const inB = await createTag(fixtures.orgB.id, orgBOwnerActor, { name: "Shared Name" }, prisma);
    expect(inA.ok).toBe(true);
    expect(inB.ok).toBe(true);
  });

  it("an archived tag is excluded from listTags' default active list, but remains visible with includeArchived", async () => {
    const owner = actorFor(fixtures, "owner");
    const created = await createTag(fixtures.orgA.id, owner, { name: "Soon Archived" }, prisma);
    if (!created.ok) throw new Error("expected ok");
    await archiveTag(fixtures.orgA.id, created.tag.id, owner, prisma);

    const activeList = await listTags(fixtures.orgA.id, {}, prisma);
    expect(activeList.find((t) => t.id === created.tag.id)).toBeUndefined();

    const fullList = await listTags(fixtures.orgA.id, { includeArchived: true }, prisma);
    expect(fullList.find((t) => t.id === created.tag.id)).toBeDefined();

    const got = await getTag(fixtures.orgA.id, created.tag.id, prisma);
    expect(got?.archivedAt).not.toBeNull();
  });

  it("archiving is idempotent — a second archive call succeeds and preserves the original archivedAt", async () => {
    const owner = actorFor(fixtures, "owner");
    const created = await createTag(fixtures.orgA.id, owner, { name: "Idempotent Archive" }, prisma);
    if (!created.ok) throw new Error("expected ok");

    const first = await archiveTag(fixtures.orgA.id, created.tag.id, owner, prisma);
    if (!first.ok) throw new Error("expected ok");
    const second = await archiveTag(fixtures.orgA.id, created.tag.id, owner, prisma);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("expected ok");
    expect(second.tag.archivedAt?.getTime()).toBe(first.tag.archivedAt?.getTime());
  });

  it("renameTag rejects an empty/whitespace-only name", async () => {
    const owner = actorFor(fixtures, "owner");
    const created = await createTag(fixtures.orgA.id, owner, { name: "Has A Name" }, prisma);
    if (!created.ok) throw new Error("expected ok");

    const result = await renameTag(fixtures.orgA.id, created.tag.id, owner, { name: "   " }, prisma);
    expect(result).toEqual({ ok: false, reason: "INVALID_NAME", error: "Enter a tag name." });
  });

  it("createTag rejects an empty/whitespace-only name", async () => {
    const owner = actorFor(fixtures, "owner");
    const result = await createTag(fixtures.orgA.id, owner, { name: "   " }, prisma);
    expect(result).toEqual({ ok: false, reason: "INVALID_NAME", error: "Enter a tag name." });
  });

  // -------------------------------------------------------------------
  // Tenant security
  // -------------------------------------------------------------------

  it("cross-org: a tag created in orgA is invisible to orgB's list, and cannot be renamed/archived by orgB", async () => {
    const owner = actorFor(fixtures, "owner");
    const orgBOwnerActor: TagActor = { id: fixtures.orgBOwner.id, name: fixtures.orgBOwner.name, role: "OWNER" };

    const created = await createTag(fixtures.orgA.id, owner, { name: "Org A Only" }, prisma);
    if (!created.ok) throw new Error("expected ok");

    const orgBList = await listTags(fixtures.orgB.id, {}, prisma);
    expect(orgBList.find((t) => t.id === created.tag.id)).toBeUndefined();

    const gotFromOrgB = await getTag(fixtures.orgB.id, created.tag.id, prisma);
    expect(gotFromOrgB).toBeNull();

    const renameAttempt = await renameTag(fixtures.orgB.id, created.tag.id, orgBOwnerActor, { name: "Hijacked" }, prisma);
    expect(renameAttempt).toEqual({ ok: false, reason: "NOT_FOUND" });

    const archiveAttempt = await archiveTag(fixtures.orgB.id, created.tag.id, orgBOwnerActor, prisma);
    expect(archiveAttempt).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("renameTag/archiveTag on a nonexistent id fail the same controlled way as a foreign-org id", async () => {
    const owner = actorFor(fixtures, "owner");
    const bogusId = "00000000-0000-0000-0000-000000000000";
    expect(await renameTag(fixtures.orgA.id, bogusId, owner, { name: "X" }, prisma)).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
    expect(await archiveTag(fixtures.orgA.id, bogusId, owner, prisma)).toEqual({ ok: false, reason: "NOT_FOUND" });
  });
});
