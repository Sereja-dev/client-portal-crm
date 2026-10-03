import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createInvoiceTemplate, updateInvoiceTemplate, archiveInvoiceTemplate, restoreInvoiceTemplate, duplicateInvoiceTemplate } from "@/lib/invoice-templates/service";
import { getInvoiceTemplateDefaults } from "@/lib/invoice-templates/apply";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal, resetNavigationMock } from "../../support/navigation-mock";
import { actorFor, templateInput, cleanupInvoiceTemplates } from "./helpers";

describe("Invoice Templates authorization", () => {
  let fixtures: TestFixtures;
  let templateIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupInvoiceTemplates(templateIds);
    templateIds = [];
    resetAuthMock();
    resetNavigationMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  describe("management -- create/update/archive/restore/duplicate", () => {
    it("OWNER can create, edit, archive, restore, and duplicate", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");

      const created = await createInvoiceTemplate(fixtures.orgA.id, owner, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      const updated = await updateInvoiceTemplate(fixtures.orgA.id, created.template.id, owner, templateInput({ name: "Renamed" }));
      expect(updated.ok).toBe(true);

      const archived = await archiveInvoiceTemplate(fixtures.orgA.id, created.template.id, owner);
      expect(archived.ok).toBe(true);
      if (archived.ok) expect(archived.template.archivedAt).not.toBeNull();

      const restored = await restoreInvoiceTemplate(fixtures.orgA.id, created.template.id, owner);
      expect(restored.ok).toBe(true);
      if (restored.ok) expect(restored.template.archivedAt).toBeNull();

      const duplicated = await duplicateInvoiceTemplate(fixtures.orgA.id, created.template.id, owner);
      expect(duplicated.ok).toBe(true);
      if (duplicated.ok) templateIds.push(duplicated.template.id);
    });

    it("ADMIN can create, edit, archive, restore, and duplicate", async () => {
      const admin = actorFor(fixtures.admin, "ADMIN");

      const created = await createInvoiceTemplate(fixtures.orgA.id, admin, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      expect((await updateInvoiceTemplate(fixtures.orgA.id, created.template.id, admin, templateInput())).ok).toBe(true);
      expect((await archiveInvoiceTemplate(fixtures.orgA.id, created.template.id, admin)).ok).toBe(true);
      expect((await restoreInvoiceTemplate(fixtures.orgA.id, created.template.id, admin)).ok).toBe(true);
      const duplicated = await duplicateInvoiceTemplate(fixtures.orgA.id, created.template.id, admin);
      expect(duplicated.ok).toBe(true);
      if (duplicated.ok) templateIds.push(duplicated.template.id);
    });

    it("MEMBER cannot create, edit, archive, restore, or duplicate", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const member = actorFor(fixtures.member, "MEMBER");

      const createAttempt = await createInvoiceTemplate(fixtures.orgA.id, member, templateInput());
      expect(createAttempt.ok).toBe(false);
      if (!createAttempt.ok) expect(createAttempt.reason).toBe("FORBIDDEN");

      // A real template, created by OWNER, to prove MEMBER is blocked from
      // every OTHER management action too -- not just create.
      const created = await createInvoiceTemplate(fixtures.orgA.id, owner, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      const updateAttempt = await updateInvoiceTemplate(fixtures.orgA.id, created.template.id, member, templateInput());
      expect(updateAttempt.ok).toBe(false);
      if (!updateAttempt.ok) expect(updateAttempt.reason).toBe("FORBIDDEN");

      const archiveAttempt = await archiveInvoiceTemplate(fixtures.orgA.id, created.template.id, member);
      expect(archiveAttempt.ok).toBe(false);
      if (!archiveAttempt.ok) expect(archiveAttempt.reason).toBe("FORBIDDEN");

      const restoreAttempt = await restoreInvoiceTemplate(fixtures.orgA.id, created.template.id, member);
      expect(restoreAttempt.ok).toBe(false);
      if (!restoreAttempt.ok) expect(restoreAttempt.reason).toBe("FORBIDDEN");

      const duplicateAttempt = await duplicateInvoiceTemplate(fixtures.orgA.id, created.template.id, member);
      expect(duplicateAttempt.ok).toBe(false);
      if (!duplicateAttempt.ok) expect(duplicateAttempt.reason).toBe("FORBIDDEN");
    });

    it("MEMBER is rejected before any database read -- a nonexistent template id still returns FORBIDDEN, not NOT_FOUND", async () => {
      const member = actorFor(fixtures.member, "MEMBER");
      const result = await updateInvoiceTemplate(fixtures.orgA.id, randomUUID(), member, templateInput());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("FORBIDDEN");
    });
  });

  describe("application -- getInvoiceTemplateDefaults", () => {
    it("MEMBER can apply an ACTIVE template even though MEMBER cannot manage templates -- matches MEMBER's existing, unrestricted Invoice-create permission", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createInvoiceTemplate(fixtures.orgA.id, owner, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      actAs(fixtures.member, fixtures.orgA.id);
      const result = await getInvoiceTemplateDefaults(created.template.id);
      expect(result.ok).toBe(true);
    });

    it("OWNER and ADMIN can also apply", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createInvoiceTemplate(fixtures.orgA.id, owner, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      actAs(fixtures.owner, fixtures.orgA.id);
      expect((await getInvoiceTemplateDefaults(created.template.id)).ok).toBe(true);

      actAs(fixtures.admin, fixtures.orgA.id);
      expect((await getInvoiceTemplateDefaults(created.template.id)).ok).toBe(true);
    });

    it("a Client Portal identity is redirected away before it could ever reach a template default", async () => {
      actAs({ id: fixtures.portalUser.id, email: fixtures.portalUser.email }, fixtures.orgA.id);
      await expect(getInvoiceTemplateDefaults(randomUUID())).rejects.toBeInstanceOf(RedirectSignal);
    });
  });

  describe("tenant isolation", () => {
    it("a foreign-org template id fails closed for every management action, indistinguishable from a nonexistent one", async () => {
      const orgBOwnerActor = actorFor(fixtures.orgBOwner, "OWNER");
      const created = await createInvoiceTemplate(fixtures.orgB.id, orgBOwnerActor, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      const owner = actorFor(fixtures.owner, "OWNER");
      const updateAttempt = await updateInvoiceTemplate(fixtures.orgA.id, created.template.id, owner, templateInput());
      expect(updateAttempt.ok).toBe(false);
      if (!updateAttempt.ok) expect(updateAttempt.reason).toBe("NOT_FOUND");

      const archiveAttempt = await archiveInvoiceTemplate(fixtures.orgA.id, created.template.id, owner);
      expect(archiveAttempt.ok).toBe(false);
      if (!archiveAttempt.ok) expect(archiveAttempt.reason).toBe("NOT_FOUND");

      const duplicateAttempt = await duplicateInvoiceTemplate(fixtures.orgA.id, created.template.id, owner);
      expect(duplicateAttempt.ok).toBe(false);
      if (!duplicateAttempt.ok) expect(duplicateAttempt.reason).toBe("NOT_FOUND");
    });

    it("a nonexistent template id behaves identically to a foreign-org one", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await updateInvoiceTemplate(fixtures.orgA.id, randomUUID(), owner, templateInput());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("NOT_FOUND");
    });

    it("a malformed (non-UUID) template id is rejected the same safe way, never reaching the database as a raw string", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await updateInvoiceTemplate(fixtures.orgA.id, "not-a-real-uuid", owner, templateInput());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("NOT_FOUND");
    });

    it("a foreign-org template can never be applied -- getInvoiceTemplateDefaults returns NOT_FOUND, not the foreign org's real content", async () => {
      const orgBOwnerActor = actorFor(fixtures.orgBOwner, "OWNER");
      const created = await createInvoiceTemplate(fixtures.orgB.id, orgBOwnerActor, templateInput({ name: "Org B Secret Template" }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      actAs(fixtures.owner, fixtures.orgA.id);
      const result = await getInvoiceTemplateDefaults(created.template.id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("NOT_FOUND");
    });

    it("forged organizationId cannot influence anything -- getInvoiceTemplateDefaults never accepts organizationId as a parameter at all; only the session's own active organization is ever used", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createInvoiceTemplate(fixtures.orgA.id, owner, templateInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      templateIds.push(created.template.id);

      // Switching the active-organization cookie to org B (a different,
      // real organization) is the only way this session's own
      // organizationId can change -- there is no other input this
      // function reads.
      actAs(fixtures.orgBOwner, fixtures.orgB.id);
      const result = await getInvoiceTemplateDefaults(created.template.id);
      expect(result.ok).toBe(false);
    });
  });
});
