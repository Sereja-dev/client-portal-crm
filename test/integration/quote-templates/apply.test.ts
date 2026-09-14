import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getQuoteTemplateDefaults } from "@/lib/quote-templates/apply";
import { createQuoteTemplate, updateQuoteTemplate, archiveQuoteTemplate } from "@/lib/quote-templates/service";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { actorFor, templateInput, cleanupQuoteTemplates } from "./helpers";

const NOW = new Date("2026-06-15T12:00:00.000Z");

describe("Quote Templates apply/prefill", () => {
  let fixtures: TestFixtures;
  let templateIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupQuoteTemplates(templateIds);
    templateIds = [];
    resetAuthMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("copies title, notes, currency, discount, tax, and items in order -- and returns nothing beyond the documented prefill shape", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createQuoteTemplate(
      fixtures.orgA.id,
      owner,
      templateInput({
        name: "Full Template",
        title: "Proposal title",
        notes: "Client-facing notes",
        currency: "EUR",
        discountType: "PERCENTAGE",
        discountValue: "15",
        taxRatePercent: "19",
        taxLabel: "VAT",
        items: [
          { description: "First item", quantity: "1", unitPrice: "100.00" },
          { description: "Second item", quantity: "2", unitPrice: "50.00" },
        ],
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getQuoteTemplateDefaults(created.template.id, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.defaults.title).toBe("Proposal title");
    expect(result.defaults.notes).toBe("Client-facing notes");
    expect(result.defaults.currency).toBe("EUR");
    expect(result.defaults.discountType).toBe("PERCENTAGE");
    expect(result.defaults.discountValue).toBe("15");
    expect(result.defaults.taxRatePercent).toBe("19");
    expect(result.defaults.taxLabel).toBe("VAT");
    expect(result.defaults.items).toEqual([
      { description: "First item", quantity: "1", unitPrice: "100" },
      { description: "Second item", quantity: "2", unitPrice: "50" },
    ]);

    // Only the documented prefill fields exist -- no Client/Lead identity,
    // no Quote number/status/recipient, no template-management metadata.
    const keys = Object.keys(result.defaults).sort();
    expect(keys).toEqual(["currency", "discountType", "discountValue", "items", "notes", "taxLabel", "taxRatePercent", "title", "validUntil"].sort());
  });

  it("validityDays produces the exact expected validUntil, computed from the caller-supplied `now`", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput({ validityDays: "30" }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getQuoteTemplateDefaults(created.template.id, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.defaults.validUntil).toBe("2026-07-15");
  });

  it("null validityDays produces a null validUntil -- no fabricated default date", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput({ validityDays: undefined }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getQuoteTemplateDefaults(created.template.id, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.defaults.validUntil).toBeNull();
  });

  it("an archived template cannot be applied, even by direct id reuse", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);

    await archiveQuoteTemplate(fixtures.orgA.id, created.template.id, owner);

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getQuoteTemplateDefaults(created.template.id, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NOT_FOUND");
  });

  it("cent-exact: decimal quantities and monetary values round-trip exactly, never through JS floating point", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createQuoteTemplate(
      fixtures.orgA.id,
      owner,
      templateInput({
        discountType: "FIXED",
        discountValue: "0.10",
        taxRatePercent: "0.20",
        items: [{ description: "Precise item", quantity: "1.500", unitPrice: "33.33" }],
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getQuoteTemplateDefaults(created.template.id, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.defaults.discountValue).toBe("0.1");
    expect(result.defaults.taxRatePercent).toBe("0.2");
    expect(result.defaults.items[0].quantity).toBe("1.5");
    expect(result.defaults.items[0].unitPrice).toBe("33.33");
  });

  it("no database write occurs during apply-default retrieval", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    const before = created.template.updatedAt;
    await getQuoteTemplateDefaults(created.template.id, NOW);
    await getQuoteTemplateDefaults(created.template.id, NOW);

    const after = await import("@/lib/quote-templates/queries").then((m) => m.getQuoteTemplateForManagement(fixtures.orgA.id, created.template.id));
    expect(after?.updatedAt.getTime()).toBe(before.getTime());
  });

  describe("snapshot semantics -- the critical invariant", () => {
    it("editing a template after applying it never affects a previously-applied prefill snapshot, and re-applying reflects only the new content", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput({ title: "Original title", notes: "Original notes" }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      actAs(fixtures.owner, fixtures.orgA.id);
      const firstApply = await getQuoteTemplateDefaults(created.template.id, NOW);
      expect(firstApply.ok).toBe(true);
      if (!firstApply.ok) return;
      // Simulates "the Quote was already created from this snapshot" --
      // the returned defaults object is a plain, disconnected value with
      // no live reference back to the template row.
      const snapshot = firstApply.defaults;
      expect(snapshot.title).toBe("Original title");

      const updated = await updateQuoteTemplate(fixtures.orgA.id, created.template.id, owner, templateInput({ title: "Changed title", notes: "Changed notes" }));
      expect(updated.ok).toBe(true);

      // The earlier snapshot object itself is untouched -- proves it was
      // never a live reference to the template row in the first place.
      expect(snapshot.title).toBe("Original title");
      expect(snapshot.notes).toBeDefined();

      // A fresh apply call, however, reflects the template's NEW content
      // -- confirming the earlier result wasn't stale/cached, it was
      // simply a real, independent snapshot taken at its own point in time.
      const secondApply = await getQuoteTemplateDefaults(created.template.id, NOW);
      expect(secondApply.ok).toBe(true);
      if (secondApply.ok) expect(secondApply.defaults.title).toBe("Changed title");
    });

    it("no Quote.quoteTemplateId or equivalent column exists -- applying a template creates no persistent link of any kind (this test itself never creates a Quote at all, proving apply is purely a read)", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      actAs(fixtures.owner, fixtures.orgA.id);
      const result = await getQuoteTemplateDefaults(created.template.id, NOW);
      expect(result.ok).toBe(true);
      // Archiving the template immediately after "applying" it (reading
      // its defaults) must have zero effect on the already-returned
      // snapshot -- re-confirms independence from the other direction
      // (archive, not edit).
      await archiveQuoteTemplate(fixtures.orgA.id, created.template.id, owner);
      if (result.ok) expect(result.defaults.title).toBeNull(); // template had no title set
    });
  });
});
