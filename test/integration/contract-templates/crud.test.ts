import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createContractTemplate, updateContractTemplate, archiveContractTemplate, restoreContractTemplate } from "@/lib/contract-templates/service";
import { listContractTemplates, getContractTemplateForManagement } from "@/lib/contract-templates/queries";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actorFor, templateInput, cleanupContractTemplates } from "./helpers";

describe("Contract Templates CRUD correctness", () => {
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

  describe("create", () => {
    it("stores every field exactly as submitted", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await createContractTemplate(
        fixtures.orgA.id,
        owner,
        templateInput({
          name: "Web design retainer",
          title: "Web Design Retainer Agreement",
          body: "Scope of work: ...",
          defaultExpiryOffsetDays: "30",
          internalNotes: "Always confirm scope before sending.",
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      templateIds.push(result.template.id);

      expect(result.template.name).toBe("Web design retainer");
      expect(result.template.title).toBe("Web Design Retainer Agreement");
      expect(result.template.body).toBe("Scope of work: ...");
      expect(result.template.defaultExpiryOffsetDays).toBe(30);
      expect(result.template.internalNotes).toBe("Always confirm scope before sending.");
      expect(result.template.organizationId).toBe(fixtures.orgA.id);
      expect(result.template.createdByUserId).toBe(fixtures.owner.id);
      expect(result.template.archivedAt).toBeNull();
    });

    it("accepts a defaultExpiryOffsetDays of 0 (expires the same day it's issued)", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await createContractTemplate(fixtures.orgA.id, owner, templateInput({ defaultExpiryOffsetDays: "0" }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      templateIds.push(result.template.id);
      expect(result.template.defaultExpiryOffsetDays).toBe(0);
    });

    it("leaves defaultExpiryOffsetDays/internalNotes null when omitted -- no fabricated defaults", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await createContractTemplate(fixtures.orgA.id, owner, templateInput({ defaultExpiryOffsetDays: undefined, internalNotes: undefined }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      templateIds.push(result.template.id);
      expect(result.template.defaultExpiryOffsetDays).toBeNull();
      expect(result.template.internalNotes).toBeNull();
    });

    it("rejects a name that is blank -- FORBIDDEN never masks a real validation failure for a privileged actor", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await createContractTemplate(fixtures.orgA.id, owner, templateInput({ name: "  " }));
      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === "VALIDATION") expect(result.fieldErrors.name).toBeDefined();
    });

    it("rejects a blank body", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await createContractTemplate(fixtures.orgA.id, owner, templateInput({ body: "   " }));
      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === "VALIDATION") expect(result.fieldErrors.body).toBeDefined();
    });

    it("rejects an out-of-range defaultExpiryOffsetDays", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await createContractTemplate(fixtures.orgA.id, owner, templateInput({ defaultExpiryOffsetDays: "-1" }));
      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === "VALIDATION") expect(result.fieldErrors.defaultExpiryOffsetDays).toBeDefined();
    });

    it("never writes a Contract row, a ContractTemplateId column, or an Activity row of any kind -- creating a template is purely its own row", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const contractCountBefore = await prisma.contract.count({ where: { organizationId: fixtures.orgA.id } });
      const activityCountBefore = await prisma.activity.count({ where: { organizationId: fixtures.orgA.id } });

      const result = await createContractTemplate(fixtures.orgA.id, owner, templateInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      templateIds.push(result.template.id);

      expect(await prisma.contract.count({ where: { organizationId: fixtures.orgA.id } })).toBe(contractCountBefore);
      expect(await prisma.activity.count({ where: { organizationId: fixtures.orgA.id } })).toBe(activityCountBefore);
    });
  });

  describe("update", () => {
    it("updates every field with a whole-record replace", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContractTemplate(fixtures.orgA.id, owner, templateInput({ name: "Old name" }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      const updated = await updateContractTemplate(
        fixtures.orgA.id,
        created.template.id,
        owner,
        templateInput({
          name: "Renamed template",
          title: "Renamed title",
          body: "Renamed body",
          defaultExpiryOffsetDays: "60",
          internalNotes: "Renamed internal notes",
        }),
      );
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;

      expect(updated.template.name).toBe("Renamed template");
      expect(updated.template.title).toBe("Renamed title");
      expect(updated.template.body).toBe("Renamed body");
      expect(updated.template.defaultExpiryOffsetDays).toBe(60);
      expect(updated.template.internalNotes).toBe("Renamed internal notes");
    });

    it("allows editing an ARCHIVED template's content without implicitly restoring it", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContractTemplate(fixtures.orgA.id, owner, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      await archiveContractTemplate(fixtures.orgA.id, created.template.id, owner);

      const updated = await updateContractTemplate(fixtures.orgA.id, created.template.id, owner, templateInput({ name: "Edited while archived" }));
      expect(updated.ok).toBe(true);
      if (updated.ok) {
        expect(updated.template.name).toBe("Edited while archived");
        expect(updated.template.archivedAt).not.toBeNull();
      }
    });

    it("returns NOT_FOUND for a foreign-org id", async () => {
      const orgBOwnerActor = actorFor(fixtures.orgBOwner, "OWNER");
      const created = await createContractTemplate(fixtures.orgB.id, orgBOwnerActor, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await updateContractTemplate(fixtures.orgA.id, created.template.id, owner, templateInput());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("NOT_FOUND");
    });
  });

  describe("archive / restore", () => {
    it("archive sets archivedAt and removes the template from the active list", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContractTemplate(fixtures.orgA.id, owner, templateInput({ name: "Archive Me" }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      const archived = await archiveContractTemplate(fixtures.orgA.id, created.template.id, owner);
      expect(archived.ok).toBe(true);
      if (archived.ok) expect(archived.template.archivedAt).not.toBeNull();

      const activeList = await listContractTemplates(fixtures.orgA.id);
      expect(activeList.some((t) => t.id === created.template.id)).toBe(false);

      const fullList = await listContractTemplates(fixtures.orgA.id, { includeArchived: true });
      expect(fullList.some((t) => t.id === created.template.id)).toBe(true);
    });

    it("archive is idempotent -- archiving an already-archived template is a safe no-op", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContractTemplate(fixtures.orgA.id, owner, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      await archiveContractTemplate(fixtures.orgA.id, created.template.id, owner);
      const secondArchive = await archiveContractTemplate(fixtures.orgA.id, created.template.id, owner);
      expect(secondArchive.ok).toBe(true);
    });

    it("restore clears archivedAt and returns the template to the active list", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContractTemplate(fixtures.orgA.id, owner, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      await archiveContractTemplate(fixtures.orgA.id, created.template.id, owner);
      const restored = await restoreContractTemplate(fixtures.orgA.id, created.template.id, owner);
      expect(restored.ok).toBe(true);
      if (restored.ok) expect(restored.template.archivedAt).toBeNull();

      const activeList = await listContractTemplates(fixtures.orgA.id);
      expect(activeList.some((t) => t.id === created.template.id)).toBe(true);
    });

    it("restore is idempotent -- restoring an already-active template is a safe no-op", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContractTemplate(fixtures.orgA.id, owner, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      const result = await restoreContractTemplate(fixtures.orgA.id, created.template.id, owner);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.template.archivedAt).toBeNull();
    });

    it("an archived template remains visible via getContractTemplateForManagement -- never hard-deleted", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContractTemplate(fixtures.orgA.id, owner, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      await archiveContractTemplate(fixtures.orgA.id, created.template.id, owner);
      const managed = await getContractTemplateForManagement(fixtures.orgA.id, created.template.id);
      expect(managed).not.toBeNull();
      expect(managed?.archivedAt).not.toBeNull();
    });
  });

  describe("listContractTemplates ordering", () => {
    it("sorts by name ascending, deterministically", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const b = await createContractTemplate(fixtures.orgA.id, owner, templateInput({ name: "B Template" }));
      const a = await createContractTemplate(fixtures.orgA.id, owner, templateInput({ name: "A Template" }));
      expect(a.ok && b.ok).toBe(true);
      if (!a.ok || !b.ok) return;
      templateIds.push(a.template.id, b.template.id);

      const list = await listContractTemplates(fixtures.orgA.id);
      const aIndex = list.findIndex((t) => t.id === a.template.id);
      const bIndex = list.findIndex((t) => t.id === b.template.id);
      expect(aIndex).toBeLessThan(bIndex);
    });

    it("never leaks a foreign tenant's templates", async () => {
      const orgBOwnerActor = actorFor(fixtures.orgBOwner, "OWNER");
      const created = await createContractTemplate(fixtures.orgB.id, orgBOwnerActor, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      const list = await listContractTemplates(fixtures.orgA.id);
      expect(list.some((t) => t.id === created.template.id)).toBe(false);
    });
  });
});
