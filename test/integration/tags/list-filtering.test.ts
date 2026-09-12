import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildClientWhere, parseClientListParams } from "@/app/(dashboard)/clients/query";
import { buildLeadWhere, parseLeadListParams } from "@/app/(dashboard)/leads/query";
import { getTagsForEntities, resolveTagAssignedEntityIds } from "@/lib/tags/list-query";
import { createTag, archiveTag, type TagActor } from "@/lib/tags/definitions";
import { assignTag } from "@/lib/tags/assignments";
import { PAGE_SIZE, getOffset } from "@/lib/list-params";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Tags V2 (Section 4/5) — the Clients/Leads list pages' own bulk display
 * (getTagsForEntities) and single-tag filter (resolveTagAssignedEntityIds,
 * folded into buildClientWhere/buildLeadWhere) — tested directly against
 * the real database, mirroring leads/list-query.test.ts's own precedent
 * of proving the query-building layer independent of the page/Server
 * Component that calls it.
 */

function ownerActor(fixtures: TestFixtures): TagActor {
  return { id: fixtures.owner.id, name: fixtures.owner.name, role: "OWNER" };
}

const NAME_PREFIX = "TagsListFilter";

function uniqueName(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

describe("Tags — list display and single-tag filtering", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterAll(async () => {
    await prisma.tagAssignment.deleteMany({ where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    await prisma.tag.deleteMany({ where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    await prisma.lead.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
    await cleanupTestData(fixtures);
  });

  // ---------------------------------------------------------------------
  // Display (getTagsForEntities)
  // ---------------------------------------------------------------------

  it("getTagsForEntities returns every assigned tag for each entity, grouped by entityId, including an archived one marked distinctly", async () => {
    const active = await createTag(fixtures.orgA.id, ownerActor(fixtures), { name: "Display Active" });
    const toArchive = await createTag(fixtures.orgA.id, ownerActor(fixtures), { name: "Display Archived" });
    if (!active.ok || !toArchive.ok) throw new Error("expected ok");

    const client = await prisma.client.create({
      data: { name: uniqueName(), organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    await assignTag(fixtures.orgA.id, active.tag.id, "CLIENT", client.id);
    await assignTag(fixtures.orgA.id, toArchive.tag.id, "CLIENT", client.id);
    await archiveTag(fixtures.orgA.id, toArchive.tag.id, ownerActor(fixtures));

    const map = await getTagsForEntities(fixtures.orgA.id, "CLIENT", [client.id, fixtures.clientA.id]);
    const forClient = map.get(client.id) ?? [];
    expect(forClient).toHaveLength(2);
    expect(forClient.find((t) => t.id === active.tag.id)?.archived).toBe(false);
    expect(forClient.find((t) => t.id === toArchive.tag.id)?.archived).toBe(true);
    // The other entity (no assignments) simply has no map entry.
    expect(map.get(fixtures.clientA.id)).toBeUndefined();

    await prisma.tagAssignment.deleteMany({ where: { entityId: client.id } });
    await prisma.client.delete({ where: { id: client.id } });
  });

  it("getTagsForEntities returns an empty map without querying when entityIds is empty", async () => {
    const map = await getTagsForEntities(fixtures.orgA.id, "CLIENT", []);
    expect(map.size).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Filtering (resolveTagAssignedEntityIds + buildClientWhere/buildLeadWhere)
  // ---------------------------------------------------------------------

  it("resolveTagAssignedEntityIds returns exactly the entities assigned this tag, scoped to this organization+entityType", async () => {
    const tag = await createTag(fixtures.orgA.id, ownerActor(fixtures), { name: "Resolve Filter" });
    if (!tag.ok) throw new Error("expected ok");

    const taggedClient = await prisma.client.create({
      data: { name: uniqueName(), organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    const untaggedClient = await prisma.client.create({
      data: { name: uniqueName(), organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    await assignTag(fixtures.orgA.id, tag.tag.id, "CLIENT", taggedClient.id);

    const entityIds = await resolveTagAssignedEntityIds(fixtures.orgA.id, "CLIENT", tag.tag.id);
    expect(entityIds).toEqual([taggedClient.id]);
    expect(entityIds).not.toContain(untaggedClient.id);

    await prisma.tagAssignment.deleteMany({ where: { tagId: tag.tag.id } });
    await prisma.client.deleteMany({ where: { id: { in: [taggedClient.id, untaggedClient.id] } } });
  });

  it("a foreign-org tagId resolves to zero entities, never leaking another organization's assignments", async () => {
    const orgBOwnerActor: TagActor = { id: fixtures.orgBOwner.id, name: fixtures.orgBOwner.name, role: "OWNER" };
    const foreignTag = await createTag(fixtures.orgB.id, orgBOwnerActor, { name: "Foreign Filter Tag" });
    if (!foreignTag.ok) throw new Error("expected ok");
    await assignTag(fixtures.orgB.id, foreignTag.tag.id, "CLIENT", fixtures.clientB.id);

    const entityIds = await resolveTagAssignedEntityIds(fixtures.orgA.id, "CLIENT", foreignTag.tag.id);
    expect(entityIds).toEqual([]);

    await prisma.tagAssignment.deleteMany({ where: { tagId: foreignTag.tag.id } });
  });

  it("buildClientWhere's tag filter returns exactly the tagged clients, and composes with search", async () => {
    const tag = await createTag(fixtures.orgA.id, ownerActor(fixtures), { name: "Client Where Filter" });
    if (!tag.ok) throw new Error("expected ok");

    const matching = await prisma.client.create({
      data: { name: uniqueName(), organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    const nonMatching = await prisma.client.create({
      data: { name: uniqueName(), organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    await assignTag(fixtures.orgA.id, tag.tag.id, "CLIENT", matching.id);

    const where = await buildClientWhere(fixtures.orgA.id, parseClientListParams({ tag: tag.tag.id }));
    const results = await prisma.client.findMany({ where });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(matching.id);
    expect(ids).not.toContain(nonMatching.id);

    // Composes with search: the tag filter narrows to `matching`, and a
    // search term that only `matching`'s own name satisfies must still
    // return it; a search term matching neither returns nothing.
    const whereWithMatchingSearch = await buildClientWhere(
      fixtures.orgA.id,
      parseClientListParams({ tag: tag.tag.id, q: matching.name }),
    );
    expect((await prisma.client.findMany({ where: whereWithMatchingSearch })).map((r) => r.id)).toEqual([matching.id]);

    const whereWithNonMatchingSearch = await buildClientWhere(
      fixtures.orgA.id,
      parseClientListParams({ tag: tag.tag.id, q: "zzz-does-not-exist-zzz" }),
    );
    expect(await prisma.client.findMany({ where: whereWithNonMatchingSearch })).toEqual([]);

    await prisma.tagAssignment.deleteMany({ where: { tagId: tag.tag.id } });
    await prisma.client.deleteMany({ where: { id: { in: [matching.id, nonMatching.id] } } });
  });

  it("buildClientWhere's tag filter returns zero rows (not all rows) when the tag has zero assignments", async () => {
    const tag = await createTag(fixtures.orgA.id, ownerActor(fixtures), { name: "Never Assigned Filter" });
    if (!tag.ok) throw new Error("expected ok");

    const where = await buildClientWhere(fixtures.orgA.id, parseClientListParams({ tag: tag.tag.id }));
    const results = await prisma.client.findMany({ where });
    expect(results).toEqual([]);
  });

  it("buildClientWhere's tag filter composes correctly with pagination (skip/take) — the full matching set is stable across pages", async () => {
    const tag = await createTag(fixtures.orgA.id, ownerActor(fixtures), { name: "Pagination Filter" });
    if (!tag.ok) throw new Error("expected ok");

    const clients = await Promise.all(
      Array.from({ length: 3 }, () =>
        prisma.client.create({ data: { name: uniqueName(), organizationId: fixtures.orgA.id, userId: fixtures.owner.id } }),
      ),
    );
    for (const client of clients) {
      await assignTag(fixtures.orgA.id, tag.tag.id, "CLIENT", client.id);
    }

    const where = await buildClientWhere(fixtures.orgA.id, parseClientListParams({ tag: tag.tag.id }));
    const total = await prisma.client.count({ where });
    expect(total).toBe(3);

    const page1 = await prisma.client.findMany({ where, orderBy: { createdAt: "asc" }, skip: getOffset(1), take: PAGE_SIZE });
    expect(page1).toHaveLength(3);

    await prisma.tagAssignment.deleteMany({ where: { tagId: tag.tag.id } });
    await prisma.client.deleteMany({ where: { id: { in: clients.map((c) => c.id) } } });
  });

  it("buildLeadWhere's tag filter returns exactly the tagged leads, scoped to LEAD (not CLIENT) assignments", async () => {
    const tag = await createTag(fixtures.orgA.id, ownerActor(fixtures), { name: "Lead Where Filter" });
    if (!tag.ok) throw new Error("expected ok");

    const matchingLead = await prisma.lead.create({ data: { name: uniqueName(), organizationId: fixtures.orgA.id } });
    const nonMatchingLead = await prisma.lead.create({ data: { name: uniqueName(), organizationId: fixtures.orgA.id } });
    // Same tag, assigned to a Client too — must never leak into the LEAD filter.
    await assignTag(fixtures.orgA.id, tag.tag.id, "CLIENT", fixtures.clientA.id);
    await assignTag(fixtures.orgA.id, tag.tag.id, "LEAD", matchingLead.id);

    const where = await buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ tag: tag.tag.id }));
    const results = await prisma.lead.findMany({ where });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(matchingLead.id);
    expect(ids).not.toContain(nonMatchingLead.id);

    await prisma.tagAssignment.deleteMany({ where: { tagId: tag.tag.id } });
    await prisma.lead.deleteMany({ where: { id: { in: [matchingLead.id, nonMatchingLead.id] } } });
  });

  it("an invalid (non-UUID) ?tag= value is parsed as no filter at all, never an error", async () => {
    const params = parseClientListParams({ tag: "not-a-real-uuid" });
    expect(params.tagId).toBeUndefined();
    const where = await buildClientWhere(fixtures.orgA.id, params);
    // No `id` key at all — the tag filter contributes nothing when tagId is undefined.
    expect((where as Record<string, unknown>).id).toBeUndefined();
  });

  it("an archived tag is excluded from the active tag list feeding the filter's own option list", async () => {
    const { listTags } = await import("@/lib/tags/definitions");
    const tag = await createTag(fixtures.orgA.id, ownerActor(fixtures), { name: "Archived Filter Option" });
    if (!tag.ok) throw new Error("expected ok");
    await archiveTag(fixtures.orgA.id, tag.tag.id, ownerActor(fixtures));

    const activeTags = await listTags(fixtures.orgA.id);
    expect(activeTags.find((t) => t.id === tag.tag.id)).toBeUndefined();
  });
});
