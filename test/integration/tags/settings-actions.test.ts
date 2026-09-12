import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTagAction, updateTagAction, archiveTagAction } from "@/app/(dashboard)/settings/tags/actions";
import { listTags } from "@/lib/tags/definitions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Tags V2 (Settings → Tags) — Server Action layer. Every action here is a
 * thin OWNER/ADMIN-gated wrapper over src/lib/tags/definitions.ts's own
 * unchanged Phase 1 domain functions — this file proves the Server Action
 * boundary itself (role gating via getCurrentMembership(), FormData
 * parsing, error-shape mapping), not the underlying domain rules already
 * exhaustively covered by test/integration/tags/definitions.test.ts.
 */

function formData(fields: Record<string, string | undefined>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) fd.set(key, value);
  }
  return fd;
}

async function cleanupTags(organizationId: string) {
  await prisma.tagAssignment.deleteMany({ where: { organizationId } });
  await prisma.tag.deleteMany({ where: { organizationId } });
}

describe("Tags — Settings Server Actions", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    resetAuthMock();
    await cleanupTags(fixtures.orgA.id);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("OWNER can create, rename, and archive a tag through the Settings actions", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);

    const created = await createTagAction({ error: null }, formData({ name: "VIP", color: "SUCCESS" }));
    expect(created.error).toBeNull();
    const tag = await prisma.tag.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: "VIP" } });
    expect(tag.color).toBe("SUCCESS");

    const renamed = await updateTagAction(tag.id, { error: null }, formData({ name: "Very Important", color: "INFO" }));
    expect(renamed.error).toBeNull();
    const reloaded = await prisma.tag.findUniqueOrThrow({ where: { id: tag.id } });
    expect(reloaded.name).toBe("Very Important");
    expect(reloaded.color).toBe("INFO");

    await archiveTagAction(tag.id);
    const archived = await prisma.tag.findUniqueOrThrow({ where: { id: tag.id } });
    expect(archived.archivedAt).not.toBeNull();
  });

  it("ADMIN can create, rename, and archive a tag through the Settings actions", async () => {
    actAs(fixtures.admin, fixtures.orgA.id);

    const created = await createTagAction({ error: null }, formData({ name: "Priority", color: "WARNING" }));
    expect(created.error).toBeNull();
    const tag = await prisma.tag.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: "Priority" } });

    const renamed = await updateTagAction(tag.id, { error: null }, formData({ name: "High Priority", color: "DANGER" }));
    expect(renamed.error).toBeNull();

    await archiveTagAction(tag.id);
    const archived = await prisma.tag.findUniqueOrThrow({ where: { id: tag.id } });
    expect(archived.archivedAt).not.toBeNull();
  });

  it("MEMBER is rejected by create/rename/archive — the FORBIDDEN domain-layer rejection surfaces as a friendly error, not a thrown exception, for create/rename", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createTagAction({ error: null }, formData({ name: "Owner Tag", color: "NEUTRAL" }));
    const tag = await prisma.tag.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: "Owner Tag" } });
    expect(created.error).toBeNull();

    actAs(fixtures.member, fixtures.orgA.id);

    const createAttempt = await createTagAction({ error: null }, formData({ name: "Blocked", color: "NEUTRAL" }));
    expect(createAttempt.error).toBe("You don't have permission to do that.");
    expect(await prisma.tag.findFirst({ where: { organizationId: fixtures.orgA.id, name: "Blocked" } })).toBeNull();

    const renameAttempt = await updateTagAction(tag.id, { error: null }, formData({ name: "Hijacked", color: "NEUTRAL" }));
    expect(renameAttempt.error).toBe("You don't have permission to do that.");
    expect((await prisma.tag.findUniqueOrThrow({ where: { id: tag.id } })).name).toBe("Owner Tag");

    await expect(archiveTagAction(tag.id)).rejects.toThrow("You don't have permission to do that.");
    expect((await prisma.tag.findUniqueOrThrow({ where: { id: tag.id } })).archivedAt).toBeNull();
  });

  it("a duplicate normalized name is rejected as a field error, not a thrown exception", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await createTagAction({ error: null }, formData({ name: "Urgent", color: "NEUTRAL" }));

    const dup = await createTagAction({ error: null }, formData({ name: "URGENT", color: "NEUTRAL" }));
    expect(dup.error).toBeNull();
    expect(dup.fieldErrors?.name).toBe("A tag with this name already exists.");
  });

  it("the active tag list excludes an archived tag", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await createTagAction({ error: null }, formData({ name: "Soon Archived", color: "NEUTRAL" }));
    const tag = await prisma.tag.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: "Soon Archived" } });

    await archiveTagAction(tag.id);

    const activeList = await listTags(fixtures.orgA.id);
    expect(activeList.find((t) => t.id === tag.id)).toBeUndefined();

    const fullList = await listTags(fixtures.orgA.id, { includeArchived: true });
    expect(fullList.find((t) => t.id === tag.id)).toBeDefined();
  });
});
