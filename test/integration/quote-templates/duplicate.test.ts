import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createQuoteTemplate, archiveQuoteTemplate, duplicateQuoteTemplate } from "@/lib/quote-templates/service";
import { QUOTE_TEMPLATE_NAME_MAX_LENGTH } from "@/lib/quote-templates/validation";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actorFor, templateInput, cleanupQuoteTemplates } from "./helpers";

describe("Quote Templates duplicate semantics", () => {
  let fixtures: TestFixtures;
  let templateIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupQuoteTemplates(templateIds);
    templateIds = [];
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("produces a new parent id, new item ids, copied content, always active, current actor as creator", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const admin = actorFor(fixtures.admin, "ADMIN");

    const source = await createQuoteTemplate(
      fixtures.orgA.id,
      owner,
      templateInput({
        name: "Original",
        title: "A title",
        notes: "Some notes",
        currency: "EUR",
        discountType: "FIXED",
        discountValue: "5.00",
        taxRatePercent: "20",
        taxLabel: "VAT",
        validityDays: "14",
        items: [
          { description: "Item A", quantity: "1", unitPrice: "10.00" },
          { description: "Item B", quantity: "2", unitPrice: "20.00" },
        ],
      }),
    );
    expect(source.ok).toBe(true);
    if (!source.ok) return;
    templateIds.push(source.template.id);

    // Duplicated by a DIFFERENT privileged actor (ADMIN) than the
    // original creator (OWNER) -- proves the current actor, not the
    // source's own creator, becomes the duplicate's creator.
    const duplicated = await duplicateQuoteTemplate(fixtures.orgA.id, source.template.id, admin);
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    templateIds.push(duplicated.template.id);

    expect(duplicated.template.id).not.toBe(source.template.id);
    expect(duplicated.template.items.map((i) => i.id)).not.toEqual(source.template.items.map((i) => i.id));

    expect(duplicated.template.name).toBe("Original Copy");
    expect(duplicated.template.title).toBe("A title");
    expect(duplicated.template.notes).toBe("Some notes");
    expect(duplicated.template.currency).toBe("EUR");
    expect(duplicated.template.discountType).toBe("FIXED");
    expect(duplicated.template.discountValue?.toString()).toBe("5");
    expect(duplicated.template.taxRatePercent?.toString()).toBe("20");
    expect(duplicated.template.taxLabel).toBe("VAT");
    expect(duplicated.template.validityDays).toBe(14);
    expect(duplicated.template.items.map((i) => i.description)).toEqual(["Item A", "Item B"]);

    expect(duplicated.template.archivedAt).toBeNull();
    expect(duplicated.template.createdByUserId).toBe(fixtures.admin.id);
    expect(duplicated.template.organizationId).toBe(fixtures.orgA.id);
  });

  it("duplicating an ARCHIVED template produces an ACTIVE duplicate -- archived state is never copied", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const source = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput({ name: "Will be archived" }));
    expect(source.ok).toBe(true);
    if (!source.ok) return;
    templateIds.push(source.template.id);

    await archiveQuoteTemplate(fixtures.orgA.id, source.template.id, owner);

    const duplicated = await duplicateQuoteTemplate(fixtures.orgA.id, source.template.id, owner);
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    templateIds.push(duplicated.template.id);

    expect(duplicated.template.archivedAt).toBeNull();
  });

  it("allows duplicate names -- no uniqueness conflict of any kind", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const source = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput({ name: "Popular Name" }));
    expect(source.ok).toBe(true);
    if (!source.ok) return;
    templateIds.push(source.template.id);

    const another = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput({ name: "Popular Name" }));
    expect(another.ok).toBe(true);
    if (another.ok) templateIds.push(another.template.id);
  });

  it("truncates an overlong name so the ' Copy' suffix always survives and the result never exceeds the name length bound", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const longName = "x".repeat(QUOTE_TEMPLATE_NAME_MAX_LENGTH);
    const source = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput({ name: longName }));
    expect(source.ok).toBe(true);
    if (!source.ok) return;
    templateIds.push(source.template.id);

    const duplicated = await duplicateQuoteTemplate(fixtures.orgA.id, source.template.id, owner);
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    templateIds.push(duplicated.template.id);

    expect(duplicated.template.name.length).toBeLessThanOrEqual(QUOTE_TEMPLATE_NAME_MAX_LENGTH);
    expect(duplicated.template.name.endsWith(" Copy")).toBe(true);
  });

  it("returns NOT_FOUND for a foreign-org source id", async () => {
    const orgBOwnerActor = actorFor(fixtures.orgBOwner, "OWNER");
    const source = await createQuoteTemplate(fixtures.orgB.id, orgBOwnerActor, templateInput());
    expect(source.ok).toBe(true);
    if (!source.ok) return;
    templateIds.push(source.template.id);

    const owner = actorFor(fixtures.owner, "OWNER");
    const result = await duplicateQuoteTemplate(fixtures.orgA.id, source.template.id, owner);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NOT_FOUND");
  });

  it("MEMBER cannot duplicate", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const source = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput());
    expect(source.ok).toBe(true);
    if (!source.ok) return;
    templateIds.push(source.template.id);

    const member = actorFor(fixtures.member, "MEMBER");
    const result = await duplicateQuoteTemplate(fixtures.orgA.id, source.template.id, member);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("FORBIDDEN");
  });
});
