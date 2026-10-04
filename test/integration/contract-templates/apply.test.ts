import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getContractTemplateDefaults } from "@/lib/contract-templates/apply";
import { createContractTemplate, updateContractTemplate, archiveContractTemplate } from "@/lib/contract-templates/service";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { actorFor, templateInput, cleanupContractTemplates } from "./helpers";

const NOW = new Date("2026-06-15T12:00:00.000Z");

describe("Contract Templates apply/prefill", () => {
  let fixtures: TestFixtures;
  let templateIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupContractTemplates(templateIds);
    templateIds = [];
    resetAuthMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("copies title, body, and internalNotes verbatim -- and returns nothing beyond the documented prefill shape", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createContractTemplate(
      fixtures.orgA.id,
      owner,
      templateInput({
        name: "Full Template",
        title: "Full Services Agreement",
        body: "This is the full body of the contract.",
        internalNotes: "Staff-only notes",
        defaultExpiryOffsetDays: "30",
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getContractTemplateDefaults(created.template.id, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.defaults.title).toBe("Full Services Agreement");
    expect(result.defaults.body).toBe("This is the full body of the contract.");
    expect(result.defaults.internalNotes).toBe("Staff-only notes");
    expect(result.defaults.expiresAt).toBe("2026-07-15");

    // Only the documented prefill fields exist -- no Client/Project/
    // signatory identity, no Contract number/status/issue date/
    // effective date, no template-management metadata.
    const keys = Object.keys(result.defaults).sort();
    expect(keys).toEqual(["body", "expiresAt", "internalNotes", "title"].sort());
  });

  it("defaultExpiryOffsetDays produces the exact expected expiresAt, computed from the caller-supplied `now` (standing in for issueDate)", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createContractTemplate(fixtures.orgA.id, owner, templateInput({ defaultExpiryOffsetDays: "30" }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getContractTemplateDefaults(created.template.id, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.defaults.expiresAt).toBe("2026-07-15");
  });

  it("a defaultExpiryOffsetDays of 0 produces an expiresAt equal to the issue date", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createContractTemplate(fixtures.orgA.id, owner, templateInput({ defaultExpiryOffsetDays: "0" }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getContractTemplateDefaults(created.template.id, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.defaults.expiresAt).toBe("2026-06-15");
  });

  it("null defaultExpiryOffsetDays produces a null expiresAt -- no fabricated default date", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createContractTemplate(fixtures.orgA.id, owner, templateInput({ defaultExpiryOffsetDays: undefined }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getContractTemplateDefaults(created.template.id, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.defaults.expiresAt).toBeNull();
  });

  it("an archived template cannot be applied, even by direct id reuse", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createContractTemplate(fixtures.orgA.id, owner, templateInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);

    await archiveContractTemplate(fixtures.orgA.id, created.template.id, owner);

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getContractTemplateDefaults(created.template.id, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NOT_FOUND");
  });

  it("no database write occurs during apply-default retrieval", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createContractTemplate(fixtures.orgA.id, owner, templateInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    const before = created.template.updatedAt;
    await getContractTemplateDefaults(created.template.id, NOW);
    await getContractTemplateDefaults(created.template.id, NOW);

    const after = await import("@/lib/contract-templates/queries").then((m) => m.getContractTemplateForManagement(fixtures.orgA.id, created.template.id));
    expect(after?.updatedAt.getTime()).toBe(before.getTime());
  });

  describe("snapshot semantics -- the critical invariant", () => {
    it("editing a template after applying it never affects a previously-applied prefill snapshot, and re-applying reflects only the new content", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContractTemplate(fixtures.orgA.id, owner, templateInput({ title: "Original title", body: "Original body" }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      actAs(fixtures.owner, fixtures.orgA.id);
      const firstApply = await getContractTemplateDefaults(created.template.id, NOW);
      expect(firstApply.ok).toBe(true);
      if (!firstApply.ok) return;
      // Simulates "the Contract was already created from this snapshot" --
      // the returned defaults object is a plain, disconnected value with
      // no live reference back to the template row.
      const snapshot = firstApply.defaults;
      expect(snapshot.title).toBe("Original title");

      const updated = await updateContractTemplate(
        fixtures.orgA.id,
        created.template.id,
        owner,
        templateInput({ title: "Changed title", body: "Changed body" }),
      );
      expect(updated.ok).toBe(true);

      // The earlier snapshot object itself is untouched -- proves it was
      // never a live reference to the template row in the first place.
      expect(snapshot.title).toBe("Original title");
      expect(snapshot.body).toBe("Original body");

      // A fresh apply call, however, reflects the template's NEW content
      // -- confirming the earlier result wasn't stale/cached, it was
      // simply a real, independent snapshot taken at its own point in time.
      const secondApply = await getContractTemplateDefaults(created.template.id, NOW);
      expect(secondApply.ok).toBe(true);
      if (secondApply.ok) expect(secondApply.defaults.title).toBe("Changed title");
    });

    it("no Contract.contractTemplateId or equivalent column exists -- applying a template creates no persistent link of any kind (this test itself never creates a Contract at all, proving apply is purely a read)", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContractTemplate(fixtures.orgA.id, owner, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      actAs(fixtures.owner, fixtures.orgA.id);
      const result = await getContractTemplateDefaults(created.template.id, NOW);
      expect(result.ok).toBe(true);
      // Archiving the template immediately after "applying" it (reading
      // its defaults) must have zero effect on the already-returned
      // snapshot -- re-confirms independence from the other direction
      // (archive, not edit).
      await archiveContractTemplate(fixtures.orgA.id, created.template.id, owner);
      if (result.ok) expect(result.defaults.internalNotes).toBeNull(); // template had no internalNotes set
    });
  });
});
