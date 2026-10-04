import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createContractTemplate, archiveContractTemplate, duplicateContractTemplate } from "@/lib/contract-templates/service";
import { CONTRACT_TEMPLATE_NAME_MAX_LENGTH } from "@/lib/contract-templates/validation";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actorFor, templateInput, cleanupContractTemplates } from "./helpers";

describe("Contract Templates duplicate semantics", () => {
  let fixtures: TestFixtures;
  let templateIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupContractTemplates(templateIds);
    templateIds = [];
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("produces a new id, copied content, always active, current actor as creator", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const admin = actorFor(fixtures.admin, "ADMIN");

    const source = await createContractTemplate(
      fixtures.orgA.id,
      owner,
      templateInput({
        name: "Original",
        title: "Original Title",
        body: "Original body",
        defaultExpiryOffsetDays: "14",
        internalNotes: "Some internal notes",
      }),
    );
    expect(source.ok).toBe(true);
    if (!source.ok) return;
    templateIds.push(source.template.id);

    // Duplicated by a DIFFERENT privileged actor (ADMIN) than the
    // original creator (OWNER) -- proves the current actor, not the
    // source's own creator, becomes the duplicate's creator.
    const duplicated = await duplicateContractTemplate(fixtures.orgA.id, source.template.id, admin);
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    templateIds.push(duplicated.template.id);

    expect(duplicated.template.id).not.toBe(source.template.id);

    expect(duplicated.template.name).toBe("Original Copy");
    expect(duplicated.template.title).toBe("Original Title");
    expect(duplicated.template.body).toBe("Original body");
    expect(duplicated.template.defaultExpiryOffsetDays).toBe(14);
    expect(duplicated.template.internalNotes).toBe("Some internal notes");

    expect(duplicated.template.archivedAt).toBeNull();
    expect(duplicated.template.createdByUserId).toBe(fixtures.admin.id);
    expect(duplicated.template.organizationId).toBe(fixtures.orgA.id);
  });

  it("duplicating an ARCHIVED template produces an ACTIVE duplicate -- archived state is never copied", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const source = await createContractTemplate(fixtures.orgA.id, owner, templateInput({ name: "Will be archived" }));
    expect(source.ok).toBe(true);
    if (!source.ok) return;
    templateIds.push(source.template.id);

    await archiveContractTemplate(fixtures.orgA.id, source.template.id, owner);

    const duplicated = await duplicateContractTemplate(fixtures.orgA.id, source.template.id, owner);
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    templateIds.push(duplicated.template.id);

    expect(duplicated.template.archivedAt).toBeNull();
  });

  it("allows duplicate names -- no uniqueness conflict of any kind", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const source = await createContractTemplate(fixtures.orgA.id, owner, templateInput({ name: "Popular Name" }));
    expect(source.ok).toBe(true);
    if (!source.ok) return;
    templateIds.push(source.template.id);

    const another = await createContractTemplate(fixtures.orgA.id, owner, templateInput({ name: "Popular Name" }));
    expect(another.ok).toBe(true);
    if (another.ok) templateIds.push(another.template.id);
  });

  it("truncates an overlong name so the ' Copy' suffix always survives and the result never exceeds the name length bound", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const longName = "x".repeat(CONTRACT_TEMPLATE_NAME_MAX_LENGTH);
    const source = await createContractTemplate(fixtures.orgA.id, owner, templateInput({ name: longName }));
    expect(source.ok).toBe(true);
    if (!source.ok) return;
    templateIds.push(source.template.id);

    const duplicated = await duplicateContractTemplate(fixtures.orgA.id, source.template.id, owner);
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    templateIds.push(duplicated.template.id);

    expect(duplicated.template.name.length).toBeLessThanOrEqual(CONTRACT_TEMPLATE_NAME_MAX_LENGTH);
    expect(duplicated.template.name.endsWith(" Copy")).toBe(true);
  });

  it("returns NOT_FOUND for a foreign-org source id", async () => {
    const orgBOwnerActor = actorFor(fixtures.orgBOwner, "OWNER");
    const source = await createContractTemplate(fixtures.orgB.id, orgBOwnerActor, templateInput());
    expect(source.ok).toBe(true);
    if (!source.ok) return;
    templateIds.push(source.template.id);

    const owner = actorFor(fixtures.owner, "OWNER");
    const result = await duplicateContractTemplate(fixtures.orgA.id, source.template.id, owner);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NOT_FOUND");
  });

  it("MEMBER cannot duplicate", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const source = await createContractTemplate(fixtures.orgA.id, owner, templateInput());
    expect(source.ok).toBe(true);
    if (!source.ok) return;
    templateIds.push(source.template.id);

    const member = actorFor(fixtures.member, "MEMBER");
    const result = await duplicateContractTemplate(fixtures.orgA.id, source.template.id, member);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("FORBIDDEN");
  });
});
