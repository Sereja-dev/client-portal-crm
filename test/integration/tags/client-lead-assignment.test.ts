import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createClientAction } from "@/app/(dashboard)/clients/new/actions";
import { updateClientAction } from "@/app/(dashboard)/clients/[id]/edit/actions";
import { createLeadFormAction } from "@/app/(dashboard)/leads/new/actions";
import { updateLeadFormAction } from "@/app/(dashboard)/leads/[id]/edit/actions";
import { createTag, archiveTag, type TagActor } from "@/lib/tags/definitions";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * Tags V2 (Section 3/6) — Client/Lead assignment via the real embedded
 * "Tags" form section, exercised end-to-end through the actual Server
 * Actions (createClientAction/updateClientAction, createLeadFormAction/
 * updateLeadFormAction) — the same wiring a real submit goes through,
 * including src/lib/tags/entity-form.ts's own parseTagFormSelection/
 * persistTagAssignmentsInTransaction. Domain-layer assignment rules
 * (idempotency, archived-tag rejection, ownership) are already
 * exhaustively covered at the src/lib/tags/assignments.ts layer by
 * test/integration/tags/assignments.test.ts — this file proves the UI/
 * Server Action wiring built on top of it behaves the same way for a
 * real Client/Lead create-or-edit submission.
 */

function buildFormData(fields: Record<string, string>, multiValues: Record<string, string[]> = {}): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  for (const [key, values] of Object.entries(multiValues)) {
    for (const value of values) fd.append(key, value);
  }
  return fd;
}

async function expectRedirect(promise: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
}

let defaultClientStatusDefinitionId: string;

function baseClientFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    name: `Client-${randomUUID().slice(0, 8)}`,
    status: "ACTIVE",
    statusDefinitionId: defaultClientStatusDefinitionId,
    ...overrides,
  };
}

function ownerActor(fixtures: TestFixtures): TagActor {
  return { id: fixtures.owner.id, name: fixtures.owner.name, role: "OWNER" };
}

async function makeTag(fixtures: TestFixtures, name: string) {
  const result = await createTag(fixtures.orgA.id, ownerActor(fixtures), { name });
  if (!result.ok) throw new Error("expected ok");
  return result.tag;
}

async function findAssignments(tagId: string, entityType: "CLIENT" | "LEAD") {
  return prisma.tagAssignment.findMany({ where: { tagId, entityType } });
}

describe("Tags — Client/Lead assignment (entity form + Server Actions)", () => {
  let fixtures: TestFixtures;
  const extraClientIds: string[] = [];
  const extraLeadIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    defaultClientStatusDefinitionId = (
      await prisma.customStatusDefinition.findFirstOrThrow({
        where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", isSystem: true, key: "active" },
      })
    ).id;
  });

  afterEach(async () => {
    resetAuthMock();
    await prisma.tagAssignment.deleteMany({ where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    await prisma.tag.deleteMany({ where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    if (extraClientIds.length) {
      await prisma.client.deleteMany({ where: { id: { in: extraClientIds } } });
      extraClientIds.length = 0;
    }
    if (extraLeadIds.length) {
      await prisma.lead.deleteMany({ where: { id: { in: extraLeadIds } } });
      extraLeadIds.length = 0;
    }
    await prisma.client.deleteMany({ where: { organizationId: fixtures.orgA.id, id: { not: fixtures.clientA.id } } });
    await prisma.lead.deleteMany({ where: { organizationId: fixtures.orgA.id } });
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("assigns multiple tags to a Client on create", async () => {
    const tagA = await makeTag(fixtures, "VIP");
    const tagB = await makeTag(fixtures, "Follow-up");
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(
      createClientAction({ error: null }, buildFormData(baseClientFields(), { tagIds: [tagA.id, tagB.id] })),
    );

    const client = await prisma.client.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: { startsWith: "Client-" } } });
    const assignments = await prisma.tagAssignment.findMany({ where: { entityType: "CLIENT", entityId: client.id } });
    expect(assignments.map((a) => a.tagId).sort()).toEqual([tagA.id, tagB.id].sort());
  });

  it("assigns a tag to a Lead on create", async () => {
    const tag = await makeTag(fixtures, "Hot lead");
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(
      createLeadFormAction({ error: null }, buildFormData({ name: `Lead-${randomUUID().slice(0, 8)}` }, { tagIds: [tag.id] })),
    );

    const lead = await prisma.lead.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id } });
    extraLeadIds.push(lead.id);
    const assignments = await findAssignments(tag.id, "LEAD");
    expect(assignments).toHaveLength(1);
    expect(assignments[0].entityId).toBe(lead.id);
  });

  it("editing a Client adds newly selected tags and removes deselected ones", async () => {
    const tagA = await makeTag(fixtures, "Keep");
    const tagB = await makeTag(fixtures, "Remove Me");
    const tagC = await makeTag(fixtures, "Add Me");
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(
      createClientAction({ error: null }, buildFormData(baseClientFields({ name: "Edit Target" }), { tagIds: [tagA.id, tagB.id] })),
    );
    const client = await prisma.client.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: "Edit Target" } });

    await expectRedirect(
      updateClientAction(
        client.id,
        { error: null },
        buildFormData(baseClientFields({ name: "Edit Target" }), { tagIds: [tagA.id, tagC.id] }),
      ),
    );

    const assignments = await prisma.tagAssignment.findMany({ where: { entityType: "CLIENT", entityId: client.id } });
    expect(assignments.map((a) => a.tagId).sort()).toEqual([tagA.id, tagC.id].sort());
  });

  it("editing a Lead adds newly selected tags and removes deselected ones", async () => {
    const tagA = await makeTag(fixtures, "Keep Lead Tag");
    const tagB = await makeTag(fixtures, "Remove Lead Tag");
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(
      createLeadFormAction({ error: null }, buildFormData({ name: "Lead Edit Target" }, { tagIds: [tagA.id, tagB.id] })),
    );
    const lead = await prisma.lead.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: "Lead Edit Target" } });
    extraLeadIds.push(lead.id);

    await expectRedirect(
      updateLeadFormAction(lead.id, { error: null }, buildFormData({ name: "Lead Edit Target" }, { tagIds: [tagA.id] })),
    );

    const assignments = await prisma.tagAssignment.findMany({ where: { entityType: "LEAD", entityId: lead.id } });
    expect(assignments.map((a) => a.tagId)).toEqual([tagA.id]);
  });

  it("a MEMBER can assign/unassign tags via the entity form action (any Staff role may edit)", async () => {
    const tag = await makeTag(fixtures, "Member Assignable");
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(createClientAction({ error: null }, buildFormData(baseClientFields({ name: "Member Target" }))));
    const client = await prisma.client.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: "Member Target" } });

    actAs(fixtures.member, fixtures.orgA.id);
    await expectRedirect(
      updateClientAction(client.id, { error: null }, buildFormData(baseClientFields({ name: "Member Target" }), { tagIds: [tag.id] })),
    );

    const assignments = await findAssignments(tag.id, "CLIENT");
    expect(assignments).toHaveLength(1);
    expect(assignments[0].entityId).toBe(client.id);

    await expectRedirect(
      updateClientAction(client.id, { error: null }, buildFormData(baseClientFields({ name: "Member Target" }))),
    );
    expect(await findAssignments(tag.id, "CLIENT")).toHaveLength(0);
  });

  it("an archived tag cannot be newly assigned — its id is silently dropped, not an error", async () => {
    const tag = await makeTag(fixtures, "Will Be Archived");
    await archiveTag(fixtures.orgA.id, tag.id, ownerActor(fixtures));
    actAs(fixtures.owner, fixtures.orgA.id);

    // Never rejects the whole Client create — the invalid id is simply
    // never assigned (Section 3: "no arbitrary tag IDs accepted without
    // server revalidation"); the create itself succeeds and redirects
    // exactly as if no tagIds had been submitted at all.
    await expectRedirect(
      createClientAction({ error: null }, buildFormData(baseClientFields({ name: "Archived Attempt" }), { tagIds: [tag.id] })),
    );

    const client = await prisma.client.findFirst({ where: { organizationId: fixtures.orgA.id, name: "Archived Attempt" } });
    expect(client).not.toBeNull();
    expect(await findAssignments(tag.id, "CLIENT")).toHaveLength(0);
  });

  it("an existing archived-tag assignment survives a re-save that no longer includes it in the submission", async () => {
    const tag = await makeTag(fixtures, "Archived After Assign");
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(
      createClientAction({ error: null }, buildFormData(baseClientFields({ name: "Preserve Target" }), { tagIds: [tag.id] })),
    );
    const client = await prisma.client.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: "Preserve Target" } });
    expect(await findAssignments(tag.id, "CLIENT")).toHaveLength(1);

    await archiveTag(fixtures.orgA.id, tag.id, ownerActor(fixtures));

    // The archived tag is no longer offered as a checkbox at all, so a
    // real re-save's own FormData simply never includes it — this is
    // the "not selectable for new assignment... never touched by a
    // save" case, not a user unchecking anything.
    await expectRedirect(
      updateClientAction(client.id, { error: null }, buildFormData(baseClientFields({ name: "Preserve Target" }))),
    );

    const stillAssigned = await findAssignments(tag.id, "CLIENT");
    expect(stillAssigned).toHaveLength(1);
    expect(stillAssigned[0].entityId).toBe(client.id);
  });

  it("a cross-org tag id submitted via tagIds is silently dropped, never assigned", async () => {
    const orgBOwnerActor: TagActor = { id: fixtures.orgBOwner.id, name: fixtures.orgBOwner.name, role: "OWNER" };
    const foreignTagResult = await createTag(fixtures.orgB.id, orgBOwnerActor, { name: "Org B Tag" });
    if (!foreignTagResult.ok) throw new Error("expected ok");
    const foreignTag = foreignTagResult.tag;

    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(
      createClientAction({ error: null }, buildFormData(baseClientFields({ name: "Cross Org Attempt" }), { tagIds: [foreignTag.id] })),
    );

    const client = await prisma.client.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: "Cross Org Attempt" } });
    expect(await prisma.tagAssignment.findMany({ where: { entityType: "CLIENT", entityId: client.id } })).toHaveLength(0);
    expect(await findAssignments(foreignTag.id, "CLIENT")).toHaveLength(0);
  });

  it("a wholly invented/tampered tag id submitted via tagIds is silently dropped, never assigned", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const bogusId = randomUUID();

    await expectRedirect(
      createClientAction({ error: null }, buildFormData(baseClientFields({ name: "Bogus Tag Attempt" }), { tagIds: [bogusId] })),
    );

    const client = await prisma.client.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: "Bogus Tag Attempt" } });
    expect(await prisma.tagAssignment.findMany({ where: { entityType: "CLIENT", entityId: client.id } })).toHaveLength(0);
  });

  it("a Client with a null organizationId is never reachable through updateClientAction at all — including its tags", async () => {
    const tag = await makeTag(fixtures, "Null Org Guard");
    const orphanClient = await prisma.client.create({
      data: { name: "Orphan Client", organizationId: null, userId: fixtures.owner.id },
    });
    extraClientIds.push(orphanClient.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await updateClientAction(
      orphanClient.id,
      { error: null },
      buildFormData(baseClientFields({ name: "Orphan Client" }), { tagIds: [tag.id] }),
    );

    expect(result.error).toBe("This client could not be found.");
    expect(await prisma.tagAssignment.findMany({ where: { entityType: "CLIENT", entityId: orphanClient.id } })).toHaveLength(0);
  });
});
