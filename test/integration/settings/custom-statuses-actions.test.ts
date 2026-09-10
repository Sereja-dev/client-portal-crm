import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createCustomStatusAction,
  updateCustomStatusAction,
  archiveCustomStatusAction,
  unarchiveCustomStatusAction,
  setDefaultCustomStatusAction,
  moveCustomStatusAction,
} from "@/app/(dashboard)/settings/custom-statuses/actions";
import { createCustomStatusDefinition } from "@/lib/custom-statuses/definitions";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Custom Statuses Phase 2B — the Settings Server Action layer's own test
 * plan (Section Z SETTINGS 1-20, SECURITY 57-64 as they apply to this
 * thin wrapper). The underlying domain-layer behavior (create/update/
 * archive/unarchive/setDefault/move) is already covered exhaustively in
 * test/integration/custom-statuses/{definitions,security}.test.ts — this
 * file proves the Server Action wrapper itself (org resolution, form
 * parsing, the "isSystem/entityType/key never caller-controlled"
 * boundary) behaves correctly on top of it. Mirrors
 * test/integration/settings/custom-fields-actions.test.ts's own exact
 * structure.
 */

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

async function findSystemDef(organizationId: string, entityType: "CLIENT" | "LEAD" | "PROJECT", key: string) {
  return prisma.customStatusDefinition.findFirstOrThrow({ where: { organizationId, entityType, isSystem: true, key } });
}

describe("Custom Statuses Settings — Server Actions", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgB.id);
  });

  afterEach(async () => {
    resetAuthMock();
    await prisma.customStatusDefinition.deleteMany({ where: { organizationId: fixtures.orgA.id, isSystem: false } });
    await prisma.customStatusDefinition.deleteMany({ where: { organizationId: fixtures.orgB.id, isSystem: false } });
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  // ---------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------

  it("createCustomStatusAction creates a CUSTOM CLIENT definition, isSystem false, key derived from label", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createCustomStatusAction("CLIENT", { error: null }, buildFormData({ label: "VIP Client", color: "SUCCESS" }));
    expect(result).toEqual({ error: null });

    const definition = await prisma.customStatusDefinition.findFirstOrThrow({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", isSystem: false },
    });
    expect(definition.label).toBe("VIP Client");
    expect(definition.key).toBe("vip_client");
    expect(definition.color).toBe("SUCCESS");
    expect(definition.isSystem).toBe(false);
    expect(definition.isDefault).toBe(false);
  });

  it("createCustomStatusAction lands after every existing definition's own position", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await createCustomStatusAction("CLIENT", { error: null }, buildFormData({ label: "VIP", color: "SUCCESS" }));
    const definition = await prisma.customStatusDefinition.findFirstOrThrow({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", key: "vip" },
    });
    // CLIENT's own 4 system definitions occupy positions 0-3.
    expect(definition.position).toBe(4);
  });

  it("an empty label is rejected, creates nothing", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createCustomStatusAction("CLIENT", { error: null }, buildFormData({ label: "  ", color: "SUCCESS" }));
    expect(result).toEqual({ error: null, fieldErrors: { label: "Label is required." } });
    const count = await prisma.customStatusDefinition.count({ where: { organizationId: fixtures.orgA.id, isSystem: false } });
    expect(count).toBe(0);
  });

  it("an invalid color falls back to NEUTRAL rather than being rejected (Section F/T — only the fixed enum, no hex picker)", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await createCustomStatusAction("CLIENT", { error: null }, buildFormData({ label: "Weird Color", color: "#ff00ff" }));
    const definition = await prisma.customStatusDefinition.findFirstOrThrow({
      where: { organizationId: fixtures.orgA.id, key: "weird_color" },
    });
    expect(definition.color).toBe("NEUTRAL");
  });

  it("the isDefault checkbox atomically makes the new definition the org's default, unsetting the previous one", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const oldDefault = await findSystemDef(fixtures.orgA.id, "CLIENT", "lead");
    expect(oldDefault.isDefault).toBe(true);

    await createCustomStatusAction("CLIENT", { error: null }, buildFormData({ label: "New Default", color: "INFO", isDefault: true }));

    const newDefault = await prisma.customStatusDefinition.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, key: "new_default" } });
    expect(newDefault.isDefault).toBe(true);
    const refreshedOld = await prisma.customStatusDefinition.findUniqueOrThrow({ where: { id: oldDefault.id } });
    expect(refreshedOld.isDefault).toBe(false);
  });

  it("a caller can never forge isSystem — createCustomStatusAction always creates isSystem: false regardless of entityType", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await createCustomStatusAction("LEAD", { error: null }, buildFormData({ label: "On Hold", color: "WARNING" }));
    const definition = await prisma.customStatusDefinition.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, key: "on_hold" } });
    expect(definition.isSystem).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------

  it("updateCustomStatusAction edits a CUSTOM definition's label/color, never its key", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createCustomStatusDefinition(fixtures.orgA.id, "PROJECT", { label: "Blocked", color: "DANGER" });
    if (!created.ok) throw new Error("expected ok");

    const result = await updateCustomStatusAction(created.definition.id, { error: null }, buildFormData({ label: "On Hold", color: "WARNING" }));
    expect(result).toEqual({ error: null });

    const updated = await prisma.customStatusDefinition.findUniqueOrThrow({ where: { id: created.definition.id } });
    expect(updated.label).toBe("On Hold");
    expect(updated.color).toBe("WARNING");
    // Label rename never changes key (Section G).
    expect(updated.key).toBe("blocked");
  });

  it("updateCustomStatusAction rejects a SYSTEM definition server-side, even though the UI never offers this dialog for one", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const systemDef = await findSystemDef(fixtures.orgA.id, "CLIENT", "active");

    const result = await updateCustomStatusAction(systemDef.id, { error: null }, buildFormData({ label: "Hacked", color: "DANGER" }));
    expect(result).toEqual({ error: "Built-in statuses can't be edited." });

    const unchanged = await prisma.customStatusDefinition.findUniqueOrThrow({ where: { id: systemDef.id } });
    expect(unchanged.label).toBe("Active");
    expect(unchanged.color).toBe("SUCCESS");
  });

  it("updateCustomStatusAction rejects a definition id belonging to a DIFFERENT organization, treated as not found", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const orgBDef = await createCustomStatusDefinition(fixtures.orgB.id, "CLIENT", { label: "OrgB Only" });
    if (!orgBDef.ok) throw new Error("expected ok");

    const result = await updateCustomStatusAction(orgBDef.definition.id, { error: null }, buildFormData({ label: "Hijacked", color: "DANGER" }));
    expect(result).toEqual({ error: "Status not found." });

    const unchanged = await prisma.customStatusDefinition.findUniqueOrThrow({ where: { id: orgBDef.definition.id } });
    expect(unchanged.label).toBe("OrgB Only");
  });

  // ---------------------------------------------------------------------
  // Archive / unarchive
  // ---------------------------------------------------------------------

  it("archiveCustomStatusAction archives a non-default CUSTOM definition", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "Seasonal" });
    if (!created.ok) throw new Error("expected ok");

    await archiveCustomStatusAction(created.definition.id);

    const archived = await prisma.customStatusDefinition.findUniqueOrThrow({ where: { id: created.definition.id } });
    expect(archived.archivedAt).not.toBeNull();
  });

  it("archiveCustomStatusAction rejects a SYSTEM definition", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const systemDef = await findSystemDef(fixtures.orgA.id, "PROJECT", "planning");

    await expect(archiveCustomStatusAction(systemDef.id)).rejects.toThrow("Built-in statuses can't be archived.");

    const unchanged = await prisma.customStatusDefinition.findUniqueOrThrow({ where: { id: systemDef.id } });
    expect(unchanged.archivedAt).toBeNull();
  });

  it("archiveCustomStatusAction rejects the current default, even a CUSTOM one", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "New Default" });
    if (!created.ok) throw new Error("expected ok");
    await setDefaultCustomStatusAction("CLIENT", created.definition.id);

    await expect(archiveCustomStatusAction(created.definition.id)).rejects.toThrow(
      "Set a different default before archiving this status.",
    );

    const unchanged = await prisma.customStatusDefinition.findUniqueOrThrow({ where: { id: created.definition.id } });
    expect(unchanged.archivedAt).toBeNull();
  });

  it("unarchiveCustomStatusAction restores an archived CUSTOM definition to active, without making it the default", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "Comeback" });
    if (!created.ok) throw new Error("expected ok");
    await archiveCustomStatusAction(created.definition.id);

    await unarchiveCustomStatusAction(created.definition.id);

    const restored = await prisma.customStatusDefinition.findUniqueOrThrow({ where: { id: created.definition.id } });
    expect(restored.archivedAt).toBeNull();
    expect(restored.isDefault).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Set default
  // ---------------------------------------------------------------------

  it("setDefaultCustomStatusAction rejects an archived target", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "Retired" });
    if (!created.ok) throw new Error("expected ok");
    await archiveCustomStatusAction(created.definition.id);

    await expect(setDefaultCustomStatusAction("CLIENT", created.definition.id)).rejects.toThrow(
      "An archived status can't be made the default.",
    );
  });

  it("setDefaultCustomStatusAction works for a SYSTEM target too (Section H/K)", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const activeDef = await findSystemDef(fixtures.orgA.id, "CLIENT", "active");

    await setDefaultCustomStatusAction("CLIENT", activeDef.id);

    const refreshed = await prisma.customStatusDefinition.findUniqueOrThrow({ where: { id: activeDef.id } });
    expect(refreshed.isDefault).toBe(true);
    const oldDefault = await findSystemDef(fixtures.orgA.id, "CLIENT", "lead");
    expect(oldDefault.isDefault).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Move (reorder)
  // ---------------------------------------------------------------------

  it("moveCustomStatusAction moves a definition up/down within its shared ordered list", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const before = await prisma.customStatusDefinition.findMany({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", archivedAt: null },
      orderBy: { position: "asc" },
    });
    const second = before[1];

    await moveCustomStatusAction("CLIENT", second.id, "up");

    const after = await prisma.customStatusDefinition.findMany({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", archivedAt: null },
      orderBy: { position: "asc" },
    });
    expect(after[0].id).toBe(second.id);
  });

  it("moveCustomStatusAction at the top of the list is a benign no-op, not an error", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const before = await prisma.customStatusDefinition.findMany({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", archivedAt: null },
      orderBy: { position: "asc" },
    });
    await expect(moveCustomStatusAction("CLIENT", before[0].id, "up")).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // Security (Section S)
  // ---------------------------------------------------------------------

  it("every action re-derives organizationId server-side — acting as orgB can never mutate orgA's own definitions", async () => {
    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    const orgADef = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "OrgA Only" });
    if (!orgADef.ok) throw new Error("expected ok");

    const result = await updateCustomStatusAction(orgADef.definition.id, { error: null }, buildFormData({ label: "Hijacked", color: "DANGER" }));
    expect(result).toEqual({ error: "Status not found." });

    await expect(archiveCustomStatusAction(orgADef.definition.id)).rejects.toThrow("Status not found.");

    const unchanged = await prisma.customStatusDefinition.findUniqueOrThrow({ where: { id: orgADef.definition.id } });
    expect(unchanged.label).toBe("OrgA Only");
    expect(unchanged.archivedAt).toBeNull();
  });
});
