import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createClientAction } from "@/app/(dashboard)/clients/new/actions";
import { createProjectAction } from "@/app/(dashboard)/projects/new/actions";
import { createCustomStatusAction, setDefaultCustomStatusAction } from "@/app/(dashboard)/settings/custom-statuses/actions";
import {
  createCustomStatusDefinition,
  setDefaultCustomStatusDefinition,
} from "@/lib/custom-statuses/definitions";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { buildStatusSelectOptions } from "@/lib/custom-statuses/entity-form";
import { resolveClientIsActive, resolveProjectIsInProgress } from "@/lib/custom-statuses/semantics";
import { getDashboardAnalytics } from "@/app/(dashboard)/dashboard/query";
import { getPortalOverview } from "@/lib/client-portal/queries";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * Custom Statuses Phase 2B — Completion Pass. Covers:
 *   - Section B/C: the LEAD default is permanently locked to the system
 *     NEW definition, enforced at the domain/Server Action boundary, not
 *     only by hiding UI.
 *   - Section D/E: reverifies the CLIENT/PROJECT custom-default CREATE
 *     path end-to-end (set a custom default → create through the real
 *     Server Action → definition/legacy/semantic-isolation all correct),
 *     going one step further than phase2b-assignment.test.ts's own
 *     "submit an arbitrary custom statusDefinitionId" coverage by
 *     proving it through the org's own actual configured default.
 * Lead WON/LOST/conversion itself is not re-tested here — already
 * exhaustively covered by phase2b-assignment.test.ts and
 * phase2a-read-semantics.test.ts; this file only re-confirms nothing
 * about that regressed (item at the bottom).
 */

function uniqueName(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function buildFormData(fields: Record<string, string | boolean>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "boolean") {
      if (value) fd.set(key, "on");
    } else {
      fd.set(key, value);
    }
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

async function findSystemDef(organizationId: string, entityType: "CLIENT" | "LEAD" | "PROJECT", key: string) {
  return prisma.customStatusDefinition.findFirstOrThrow({ where: { organizationId, entityType, isSystem: true, key } });
}

describe("Custom Statuses Phase 2B — Completion Pass", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
  });

  afterEach(async () => {
    resetAuthMock();
    // Client/Project rows referencing a CUSTOM definition via
    // statusDefinitionId must go first — deleting the definition while a
    // row still points at it violates Client_statusDefinitionId_fkey /
    // Project_statusDefinitionId_fkey.
    await prisma.client.deleteMany({ where: { organizationId: fixtures.orgA.id, id: { not: fixtures.clientA.id } } });
    await prisma.project.deleteMany({ where: { organizationId: fixtures.orgA.id, id: { not: fixtures.project.id } } });
    await prisma.customStatusDefinition.deleteMany({ where: { organizationId: fixtures.orgA.id, isSystem: false } });
    // Restore the system NEW default in case a test left it changed
    // (every real caller in this file goes through the guarded path, so
    // this is only ever a no-op safety net).
    await prisma.customStatusDefinition.updateMany({
      where: { organizationId: fixtures.orgA.id, entityType: "LEAD" },
      data: { isDefault: false },
    });
    await prisma.customStatusDefinition.updateMany({
      where: { organizationId: fixtures.orgA.id, entityType: "LEAD", isSystem: true, key: "new" },
      data: { isDefault: true },
    });
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  // ---------------------------------------------------------------------
  // Section B/C — LEAD default lock
  // ---------------------------------------------------------------------

  describe("LEAD default lock", () => {
    it("setDefaultCustomStatusDefinition rejects a CUSTOM LEAD target with LEAD_DEFAULT_LOCKED", async () => {
      const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD", { label: "Nurturing" });
      if (!customDef.ok) throw new Error("expected ok");

      const result = await setDefaultCustomStatusDefinition(fixtures.orgA.id, "LEAD", customDef.definition.id);
      expect(result).toEqual({ ok: false, reason: "LEAD_DEFAULT_LOCKED" });

      const newDef = await findSystemDef(fixtures.orgA.id, "LEAD", "new");
      expect(newDef.isDefault).toBe(true);
    });

    it("setDefaultCustomStatusDefinition rejects a non-NEW SYSTEM LEAD target (e.g. QUALIFIED) too — the lock isn't just 'no custom defaults'", async () => {
      const qualifiedDef = await findSystemDef(fixtures.orgA.id, "LEAD", "qualified");

      const result = await setDefaultCustomStatusDefinition(fixtures.orgA.id, "LEAD", qualifiedDef.id);
      expect(result).toEqual({ ok: false, reason: "LEAD_DEFAULT_LOCKED" });

      const refreshed = await prisma.customStatusDefinition.findUniqueOrThrow({ where: { id: qualifiedDef.id } });
      expect(refreshed.isDefault).toBe(false);
    });

    it("setDefaultCustomStatusDefinition allows re-confirming the system NEW definition itself (idempotent no-op)", async () => {
      const newDef = await findSystemDef(fixtures.orgA.id, "LEAD", "new");
      const result = await setDefaultCustomStatusDefinition(fixtures.orgA.id, "LEAD", newDef.id);
      expect(result).toEqual({ ok: true, definition: expect.objectContaining({ id: newDef.id, isDefault: true }) });
    });

    it("setDefaultCustomStatusAction (Server Action) throws a clear error for a crafted LEAD default change, never silently no-ops", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const lostDef = await findSystemDef(fixtures.orgA.id, "LEAD", "lost");

      await expect(setDefaultCustomStatusAction("LEAD", lostDef.id)).rejects.toThrow(
        "New leads always start as New — the Lead default can't be changed.",
      );

      const newDef = await findSystemDef(fixtures.orgA.id, "LEAD", "new");
      expect(newDef.isDefault).toBe(true);
    });

    it("createCustomStatusAction rejects makeDefault=true for entityType LEAD with an explicit error, and creates NOTHING", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const before = await prisma.customStatusDefinition.count({ where: { organizationId: fixtures.orgA.id, entityType: "LEAD", isSystem: false } });

      const result = await createCustomStatusAction("LEAD", { error: null }, buildFormData({ label: "Sneaky Default", color: "INFO", isDefault: true }));
      expect(result).toEqual({ error: "New leads always start as New — leads can't have a different default status." });

      const after = await prisma.customStatusDefinition.count({ where: { organizationId: fixtures.orgA.id, entityType: "LEAD", isSystem: false } });
      expect(after).toBe(before);
    });

    it("createCustomStatusAction for LEAD without makeDefault still creates normally (regression: the guard doesn't over-reject)", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const result = await createCustomStatusAction("LEAD", { error: null }, buildFormData({ label: "On Hold", color: "WARNING" }));
      expect(result).toEqual({ error: null });

      const created = await prisma.customStatusDefinition.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, key: "on_hold" } });
      expect(created.isDefault).toBe(false);
    });

    it("CLIENT and PROJECT default-setting are completely unaffected by the LEAD lock (regression)", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);

      const clientDef = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "VIP" });
      if (!clientDef.ok) throw new Error("expected ok");
      await setDefaultCustomStatusAction("CLIENT", clientDef.definition.id);
      expect((await prisma.customStatusDefinition.findUniqueOrThrow({ where: { id: clientDef.definition.id } })).isDefault).toBe(true);

      const projectDef = await createCustomStatusDefinition(fixtures.orgA.id, "PROJECT", { label: "Discovery" });
      if (!projectDef.ok) throw new Error("expected ok");
      await setDefaultCustomStatusAction("PROJECT", projectDef.definition.id);
      expect((await prisma.customStatusDefinition.findUniqueOrThrow({ where: { id: projectDef.definition.id } })).isDefault).toBe(true);

      // Reset for other tests' own assumptions about the default.
      await setDefaultCustomStatusAction("CLIENT", (await findSystemDef(fixtures.orgA.id, "CLIENT", "lead")).id);
      await setDefaultCustomStatusAction("PROJECT", (await findSystemDef(fixtures.orgA.id, "PROJECT", "planning")).id);
    });
  });

  // ---------------------------------------------------------------------
  // Section D — CLIENT custom default, end-to-end through the real default
  // ---------------------------------------------------------------------

  describe("CLIENT custom default — end-to-end create", () => {
    it("a CUSTOM CLIENT default is offered as the form's own default option, and creating with it produces the documented compatibility write with no ACTIVE semantic leak", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "Warm Lead" });
      if (!customDef.ok) throw new Error("expected ok");
      await setDefaultCustomStatusAction("CLIENT", customDef.definition.id);

      // Exactly what the real create form would compute as its own
      // preselected <select> value (client-form.tsx: statusOptions.find(o
      // => o.isDefault)).
      const options = await buildStatusSelectOptions(fixtures.orgA.id, "CLIENT", null);
      const formDefault = options.find((o) => o.isDefault);
      expect(formDefault?.id).toBe(customDef.definition.id);

      const name = uniqueName("Client");
      await expectRedirect(createClientAction({ error: null }, buildFormData({ name, statusDefinitionId: formDefault!.id })));

      const client = await prisma.client.findFirstOrThrow({ where: { name } });
      expect(client.statusDefinitionId).toBe(customDef.definition.id);
      // The documented smallest-safe-compatibility value (Section H,
      // Phase 2B) — never a newly-invented value.
      expect(client.status).toBe("LEAD");
      // No ACTIVE semantic leak — resolveClientIsActive is identity-based
      // (isSystem + key), never fooled by the legacy compatibility value.
      expect(resolveClientIsActive({ status: client.status, statusDefinition: { isSystem: false, entityType: "CLIENT", key: customDef.definition.key } })).toBe(false);

      await setDefaultCustomStatusAction("CLIENT", (await findSystemDef(fixtures.orgA.id, "CLIENT", "lead")).id);
    });
  });

  // ---------------------------------------------------------------------
  // Section E — PROJECT custom default, end-to-end through the real default
  // ---------------------------------------------------------------------

  describe("PROJECT custom default — end-to-end create", () => {
    it("a CUSTOM PROJECT default is offered as the form's own default option, produces the documented compatibility write, and is excluded from both the dashboard KPI and the Portal active-project count", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "PROJECT", { label: "Discovery" });
      if (!customDef.ok) throw new Error("expected ok");
      await setDefaultCustomStatusAction("PROJECT", customDef.definition.id);

      const options = await buildStatusSelectOptions(fixtures.orgA.id, "PROJECT", null);
      const formDefault = options.find((o) => o.isDefault);
      expect(formDefault?.id).toBe(customDef.definition.id);

      const before = await getDashboardAnalytics({ organizationId: fixtures.orgA.id, period: "30d", now: new Date() });
      const portalBefore = await getPortalOverview(fixtures.clientA.id, fixtures.orgA.id);

      const name = uniqueName("Project");
      await expectRedirect(
        createProjectAction({ error: null }, buildFormData({ name, clientId: fixtures.clientA.id, statusDefinitionId: formDefault!.id })),
      );

      const project = await prisma.project.findFirstOrThrow({ where: { name } });
      expect(project.statusDefinitionId).toBe(customDef.definition.id);
      // The documented smallest-safe-compatibility value.
      expect(project.status).toBe("PLANNING");
      expect(
        resolveProjectIsInProgress({ status: project.status, statusDefinition: { isSystem: false, entityType: "PROJECT", key: customDef.definition.key } }),
      ).toBe(false);

      const after = await getDashboardAnalytics({ organizationId: fixtures.orgA.id, period: "30d", now: new Date() });
      expect(after.kpis.activeProjects).toBe(before.kpis.activeProjects);

      const portalAfter = await getPortalOverview(fixtures.clientA.id, fixtures.orgA.id);
      expect(portalAfter.activeProjectsCount).toBe(portalBefore.activeProjectsCount);

      await setDefaultCustomStatusAction("PROJECT", (await findSystemDef(fixtures.orgA.id, "PROJECT", "planning")).id);
    });
  });
});
