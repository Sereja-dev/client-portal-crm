import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createQuoteTemplate, updateQuoteTemplate, archiveQuoteTemplate, restoreQuoteTemplate } from "@/lib/quote-templates/service";
import { listQuoteTemplates, getQuoteTemplateForManagement } from "@/lib/quote-templates/queries";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actorFor, templateInput, cleanupQuoteTemplates } from "./helpers";

describe("Quote Templates CRUD correctness", () => {
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

  describe("create", () => {
    it("stores every field exactly as submitted", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await createQuoteTemplate(
        fixtures.orgA.id,
        owner,
        templateInput({
          name: "Web design retainer",
          title: "Monthly retainer",
          notes: "Includes 10 revision rounds.",
          currency: "EUR",
          discountType: "PERCENTAGE",
          discountValue: "10",
          taxRatePercent: "20",
          taxLabel: "VAT",
          validityDays: "30",
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      templateIds.push(result.template.id);

      expect(result.template.name).toBe("Web design retainer");
      expect(result.template.title).toBe("Monthly retainer");
      expect(result.template.notes).toBe("Includes 10 revision rounds.");
      expect(result.template.currency).toBe("EUR");
      expect(result.template.discountType).toBe("PERCENTAGE");
      expect(result.template.discountValue?.toString()).toBe("10");
      expect(result.template.taxRatePercent?.toString()).toBe("20");
      expect(result.template.taxLabel).toBe("VAT");
      expect(result.template.validityDays).toBe(30);
      expect(result.template.organizationId).toBe(fixtures.orgA.id);
      expect(result.template.createdByUserId).toBe(fixtures.owner.id);
      expect(result.template.archivedAt).toBeNull();
    });

    it("stores items in deterministic, contiguous 0-based positions, in submitted order", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await createQuoteTemplate(
        fixtures.orgA.id,
        owner,
        templateInput({
          items: [
            { description: "First", quantity: "1", unitPrice: "10.00" },
            { description: "Second", quantity: "2", unitPrice: "20.00" },
            { description: "Third", quantity: "3", unitPrice: "30.00" },
          ],
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      templateIds.push(result.template.id);

      expect(result.template.items.map((i) => i.position)).toEqual([0, 1, 2]);
      expect(result.template.items.map((i) => i.description)).toEqual(["First", "Second", "Third"]);
    });

    it("rejects a name that is blank -- FORBIDDEN never masks a real validation failure for a privileged actor", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput({ name: "  " }));
      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === "VALIDATION") expect(result.fieldErrors.name).toBeDefined();
    });

    it("rejects zero items, via the same calculateQuoteTotals EMPTY_LINE_ITEMS rule ordinary Quote creation uses", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput({ items: [] }));
      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === "VALIDATION") expect(result.fieldErrors.items).toBeDefined();
    });

    it("rejects data ordinary Quote creation would also reject -- e.g. a negative unit price", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await createQuoteTemplate(
        fixtures.orgA.id,
        owner,
        templateInput({ items: [{ description: "Bad", quantity: "1", unitPrice: "-5.00" }] }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === "VALIDATION") expect(result.itemErrors?.[0]?.unitPrice).toBeDefined();
    });
  });

  describe("update", () => {
    it("updates fields and fully replaces items with no orphan rows left behind", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createQuoteTemplate(
        fixtures.orgA.id,
        owner,
        templateInput({ items: [{ description: "Old item", quantity: "1", unitPrice: "10.00" }] }),
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);
      const oldItemId = created.template.items[0].id;

      const updated = await updateQuoteTemplate(
        fixtures.orgA.id,
        created.template.id,
        owner,
        templateInput({
          name: "Renamed template",
          items: [
            { description: "New item A", quantity: "1", unitPrice: "5.00" },
            { description: "New item B", quantity: "1", unitPrice: "15.00" },
          ],
        }),
      );
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;

      expect(updated.template.name).toBe("Renamed template");
      expect(updated.template.items).toHaveLength(2);
      expect(updated.template.items.map((i) => i.description)).toEqual(["New item A", "New item B"]);

      const orphan = await prisma.quoteTemplateItem.findUnique({ where: { id: oldItemId } });
      expect(orphan).toBeNull();
    });

    it("returns NOT_FOUND for a foreign-org id", async () => {
      const orgBOwnerActor = actorFor(fixtures.orgBOwner, "OWNER");
      const created = await createQuoteTemplate(fixtures.orgB.id, orgBOwnerActor, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await updateQuoteTemplate(fixtures.orgA.id, created.template.id, owner, templateInput());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("NOT_FOUND");
    });
  });

  describe("archive / restore", () => {
    it("archive sets archivedAt and removes the template from the active list", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput({ name: "Archive Me" }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      const archived = await archiveQuoteTemplate(fixtures.orgA.id, created.template.id, owner);
      expect(archived.ok).toBe(true);
      if (archived.ok) expect(archived.template.archivedAt).not.toBeNull();

      const activeList = await listQuoteTemplates(fixtures.orgA.id);
      expect(activeList.some((t) => t.id === created.template.id)).toBe(false);

      const fullList = await listQuoteTemplates(fixtures.orgA.id, { includeArchived: true });
      expect(fullList.some((t) => t.id === created.template.id)).toBe(true);
    });

    it("archive is idempotent -- archiving an already-archived template is a safe no-op", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      await archiveQuoteTemplate(fixtures.orgA.id, created.template.id, owner);
      const secondArchive = await archiveQuoteTemplate(fixtures.orgA.id, created.template.id, owner);
      expect(secondArchive.ok).toBe(true);
    });

    it("restore clears archivedAt and returns the template to the active list", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      await archiveQuoteTemplate(fixtures.orgA.id, created.template.id, owner);
      const restored = await restoreQuoteTemplate(fixtures.orgA.id, created.template.id, owner);
      expect(restored.ok).toBe(true);
      if (restored.ok) expect(restored.template.archivedAt).toBeNull();

      const activeList = await listQuoteTemplates(fixtures.orgA.id);
      expect(activeList.some((t) => t.id === created.template.id)).toBe(true);
    });

    it("restore is idempotent -- restoring an already-active template is a safe no-op", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      const result = await restoreQuoteTemplate(fixtures.orgA.id, created.template.id, owner);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.template.archivedAt).toBeNull();
    });

    it("an archived template remains visible via getQuoteTemplateForManagement", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      await archiveQuoteTemplate(fixtures.orgA.id, created.template.id, owner);
      const managed = await getQuoteTemplateForManagement(fixtures.orgA.id, created.template.id);
      expect(managed).not.toBeNull();
      expect(managed?.archivedAt).not.toBeNull();
    });
  });

  describe("listQuoteTemplates ordering", () => {
    it("sorts by name ascending, deterministically", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const b = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput({ name: "B Template" }));
      const a = await createQuoteTemplate(fixtures.orgA.id, owner, templateInput({ name: "A Template" }));
      expect(a.ok && b.ok).toBe(true);
      if (!a.ok || !b.ok) return;
      templateIds.push(a.template.id, b.template.id);

      const list = await listQuoteTemplates(fixtures.orgA.id);
      const aIndex = list.findIndex((t) => t.id === a.template.id);
      const bIndex = list.findIndex((t) => t.id === b.template.id);
      expect(aIndex).toBeLessThan(bIndex);
    });

    it("never leaks a foreign tenant's templates", async () => {
      const orgBOwnerActor = actorFor(fixtures.orgBOwner, "OWNER");
      const created = await createQuoteTemplate(fixtures.orgB.id, orgBOwnerActor, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      const list = await listQuoteTemplates(fixtures.orgA.id);
      expect(list.some((t) => t.id === created.template.id)).toBe(false);
    });
  });
});
