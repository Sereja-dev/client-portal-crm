import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createContractTemplateAction,
  updateContractTemplateAction,
  archiveContractTemplateAction,
  restoreContractTemplateAction,
  duplicateContractTemplateAction,
} from "@/app/(dashboard)/settings/contract-templates/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal, resetNavigationMock } from "../../support/navigation-mock";

/**
 * Contract Templates V1 (Settings → Contract templates) — Server Action
 * layer. Every action here is a thin OWNER/ADMIN-gated wrapper over
 * src/lib/contract-templates/service.ts's own unchanged domain functions
 * (see actions.ts's own header comment) — this file proves the Server
 * Action boundary itself (organizationId/actor re-resolved from the
 * session via getCurrentMembership(), never trusted from the caller),
 * not the underlying domain rules already exhaustively covered by
 * test/integration/contract-templates/authorization.test.ts. Mirrors
 * test/integration/settings/invoice-templates-actions.test.ts's own
 * identical shape exactly.
 */

function templateInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Standard services agreement",
    title: "Services Agreement",
    body: "These are the standard terms and conditions...",
    ...overrides,
  };
}

describe("Contract Templates — Settings Server Actions", () => {
  let fixtures: TestFixtures;
  let templateIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    if (templateIds.length > 0) {
      await prisma.contractTemplate.deleteMany({ where: { id: { in: templateIds } } });
      templateIds = [];
    }
    resetAuthMock();
    resetNavigationMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("OWNER can create, update, archive, restore, and duplicate through the Settings actions", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);

    const created = await createContractTemplateAction(templateInput({ name: "Retainer" }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);

    const updated = await updateContractTemplateAction(created.template.id, templateInput({ name: "Retainer (renamed)" }));
    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.template.name).toBe("Retainer (renamed)");

    const archived = await archiveContractTemplateAction(created.template.id);
    expect(archived).toEqual({ ok: true });
    const archivedRow = await prisma.contractTemplate.findUniqueOrThrow({ where: { id: created.template.id } });
    expect(archivedRow.archivedAt).not.toBeNull();

    const restored = await restoreContractTemplateAction(created.template.id);
    expect(restored).toEqual({ ok: true });

    const duplicated = await duplicateContractTemplateAction(created.template.id);
    expect(duplicated.ok).toBe(true);
    if (duplicated.ok) {
      templateIds.push(duplicated.newTemplateId);
      const copy = await prisma.contractTemplate.findUniqueOrThrow({ where: { id: duplicated.newTemplateId } });
      expect(copy.name).toBe("Retainer (renamed) Copy");
      expect(copy.archivedAt).toBeNull();
    }
  });

  it("ADMIN can create, update, archive, restore, and duplicate through the Settings actions", async () => {
    actAs(fixtures.admin, fixtures.orgA.id);

    const created = await createContractTemplateAction(templateInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);

    expect((await updateContractTemplateAction(created.template.id, templateInput())).ok).toBe(true);
    expect(await archiveContractTemplateAction(created.template.id)).toEqual({ ok: true });
    expect(await restoreContractTemplateAction(created.template.id)).toEqual({ ok: true });
    const duplicated = await duplicateContractTemplateAction(created.template.id);
    if (duplicated.ok) templateIds.push(duplicated.newTemplateId);
  });

  it("MEMBER's mutation actions are all denied — the Server Action never trusts the caller's own privilege, it re-derives the role from the session and relies on the domain layer's own FORBIDDEN gate", async () => {
    const owner = fixtures.owner;
    actAs(owner, fixtures.orgA.id);
    const created = await createContractTemplateAction(templateInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);
    resetAuthMock();

    actAs(fixtures.member, fixtures.orgA.id);
    const createAttempt = await createContractTemplateAction(templateInput());
    expect(createAttempt.ok).toBe(false);
    if (!createAttempt.ok) expect(createAttempt.reason).toBe("FORBIDDEN");

    const updateAttempt = await updateContractTemplateAction(created.template.id, templateInput());
    expect(updateAttempt.ok).toBe(false);
    if (!updateAttempt.ok) expect(updateAttempt.reason).toBe("FORBIDDEN");

    expect(await archiveContractTemplateAction(created.template.id)).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(await restoreContractTemplateAction(created.template.id)).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(await duplicateContractTemplateAction(created.template.id)).toEqual({ ok: false, reason: "FORBIDDEN" });
  });

  it("a foreign-org template id fails closed as NOT_FOUND for every mutation action, even for a privileged OWNER of a different organization", async () => {
    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    const created = await createContractTemplateAction(templateInput({ name: "Org B template" }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);
    resetAuthMock();

    actAs(fixtures.owner, fixtures.orgA.id);
    const updateAttempt = await updateContractTemplateAction(created.template.id, templateInput());
    expect(updateAttempt.ok).toBe(false);
    if (!updateAttempt.ok) expect(updateAttempt.reason).toBe("NOT_FOUND");

    expect(await archiveContractTemplateAction(created.template.id)).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(await restoreContractTemplateAction(created.template.id)).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(await duplicateContractTemplateAction(created.template.id)).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("a nonexistent template id behaves identically to a foreign-org one", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await updateContractTemplateAction(randomUUID(), templateInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NOT_FOUND");
  });

  it("a Client Portal identity is redirected away before any action's own logic runs", async () => {
    actAs({ id: fixtures.portalUser.id, email: fixtures.portalUser.email }, fixtures.orgA.id);
    await expect(createContractTemplateAction(templateInput())).rejects.toBeInstanceOf(RedirectSignal);
  });
});
