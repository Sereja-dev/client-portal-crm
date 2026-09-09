import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listCustomFieldDefinitions,
  createCustomFieldDefinition,
  updateCustomFieldDefinition,
  archiveCustomFieldDefinition,
  unarchiveCustomFieldDefinition,
} from "@/lib/custom-fields/definitions";
import { slugifyCustomFieldIdentifier } from "@/lib/custom-fields/key";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { resetAuthMock } from "../../support/auth-mock";

/**
 * Custom Fields Phase 1 — Definition domain-layer coverage (test items
 * 1-11 of the originating task). Value coverage lives in values.test.ts;
 * schema/constraint-level coverage lives in schema-migration.test.ts;
 * delete-cleanup coverage lives in delete-cleanup.test.ts.
 */

async function cleanupDefinitions(organizationId: string) {
  await prisma.customFieldDefinition.deleteMany({ where: { organizationId } });
}

describe("Custom Fields — Definition domain layer", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    resetAuthMock();
    await cleanupDefinitions(fixtures.orgA.id);
    await cleanupDefinitions(fixtures.orgB.id);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("1. listCustomFieldDefinitions returns an empty array when none exist yet", async () => {
    const result = await listCustomFieldDefinitions(fixtures.orgA.id, "CLIENT");
    expect(result).toEqual([]);
  });

  it("2. createCustomFieldDefinition creates the first definition at position 0", async () => {
    const result = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", {
      label: "Account Manager",
      fieldType: "TEXT",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.definition.position).toBe(0);
    expect(result.definition.entityType).toBe("CLIENT");
    expect(result.definition.fieldType).toBe("TEXT");
    expect(result.definition.required).toBe(false);
    expect(result.definition.archivedAt).toBeNull();
  });

  it("3. a second definition for the same organization+entityType gets the next position", async () => {
    const first = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "First", fieldType: "TEXT" });
    const second = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Second", fieldType: "TEXT" });
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(second.definition.position).toBe(first.definition.position + 1);

    const list = await listCustomFieldDefinitions(fixtures.orgA.id, "CLIENT");
    expect(list.map((d) => d.label)).toEqual(["First", "Second"]);
  });

  it("4. key auto-derives from label — normalized to a lower-case, machine-safe slug", async () => {
    const result = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", {
      label: "Account Manager",
      fieldType: "TEXT",
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.definition.key).toBe("account_manager");
    expect(slugifyCustomFieldIdentifier("Account Manager")).toBe("account_manager");
  });

  it("5. an explicitly supplied key is still normalized — no arbitrary user-defined SQL-like name can reach the database", async () => {
    const result = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", {
      label: "Weird Field",
      fieldType: "TEXT",
      key: "DROP TABLE; weird key!!",
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.definition.key).toMatch(/^[a-z0-9_]+$/);
  });

  it("6. a duplicate label within the same organization+entityType gets a deterministic, suffixed key rather than colliding", async () => {
    const first = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Notes", fieldType: "TEXT" });
    const second = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Notes", fieldType: "TEXT" });
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(first.definition.key).toBe("notes");
    expect(second.definition.key).toBe("notes_2");
  });

  it("7. the same key is allowed to exist for the same organization across two different entityTypes", async () => {
    const clientDef = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Notes", fieldType: "TEXT" });
    const leadDef = await createCustomFieldDefinition(fixtures.orgA.id, "LEAD", { label: "Notes", fieldType: "TEXT" });
    if (!clientDef.ok || !leadDef.ok) throw new Error("expected ok");
    expect(clientDef.definition.key).toBe("notes");
    expect(leadDef.definition.key).toBe("notes");
  });

  it("8. `required` is stored on the definition but is not enforced anywhere in this phase — it's just a data field", async () => {
    const result = await createCustomFieldDefinition(fixtures.orgA.id, "PROJECT", {
      label: "Contract Signed",
      fieldType: "CHECKBOX",
      required: true,
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.definition.required).toBe(true);
    // No enforcement exists to test against — Project.create/.update never
    // read CustomFieldDefinition at all in this phase (Section I). This
    // assertion documents the boundary rather than exercising it.
  });

  it("9. updateCustomFieldDefinition changes the label; the key is never touched by a label rename", async () => {
    const created = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Account Manager", fieldType: "TEXT" });
    if (!created.ok) throw new Error("expected ok");

    const updated = await updateCustomFieldDefinition(fixtures.orgA.id, created.definition.id, { label: "AM (renamed)" });
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error("expected ok");
    expect(updated.definition.label).toBe("AM (renamed)");
    expect(updated.definition.key).toBe("account_manager");
  });

  it("10. updateCustomFieldDefinition's input type has no fieldType — an existing definition's fieldType is immutable through this domain layer", async () => {
    const created = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Notes", fieldType: "TEXT" });
    if (!created.ok) throw new Error("expected ok");

    await updateCustomFieldDefinition(fixtures.orgA.id, created.definition.id, { label: "Notes v2", required: true });
    const reloaded = await prisma.customFieldDefinition.findUnique({ where: { id: created.definition.id } });
    expect(reloaded?.fieldType).toBe("TEXT");
  });

  it("11. archiving hides a definition from the default active list; unarchiving restores it, both idempotent", async () => {
    const created = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Legacy Field", fieldType: "TEXT" });
    if (!created.ok) throw new Error("expected ok");

    const archived = await archiveCustomFieldDefinition(fixtures.orgA.id, created.definition.id);
    expect(archived.ok).toBe(true);
    if (!archived.ok) throw new Error("expected ok");
    expect(archived.definition.archivedAt).not.toBeNull();

    const activeList = await listCustomFieldDefinitions(fixtures.orgA.id, "CLIENT");
    expect(activeList.find((d) => d.id === created.definition.id)).toBeUndefined();

    const fullList = await listCustomFieldDefinitions(fixtures.orgA.id, "CLIENT", { includeArchived: true });
    expect(fullList.find((d) => d.id === created.definition.id)).toBeDefined();

    // Idempotent re-archive.
    const archivedAgain = await archiveCustomFieldDefinition(fixtures.orgA.id, created.definition.id);
    expect(archivedAgain.ok).toBe(true);
    if (!archivedAgain.ok) throw new Error("expected ok");
    expect(archivedAgain.definition.archivedAt?.getTime()).toBe(archived.definition.archivedAt?.getTime());

    const unarchived = await unarchiveCustomFieldDefinition(fixtures.orgA.id, created.definition.id);
    expect(unarchived.ok).toBe(true);
    if (!unarchived.ok) throw new Error("expected ok");
    expect(unarchived.definition.archivedAt).toBeNull();
    // Key/position survive unarchiving untouched.
    expect(unarchived.definition.key).toBe(created.definition.key);
    expect(unarchived.definition.position).toBe(created.definition.position);

    // Idempotent re-unarchive.
    const unarchivedAgain = await unarchiveCustomFieldDefinition(fixtures.orgA.id, created.definition.id);
    expect(unarchivedAgain.ok).toBe(true);

    const activeListAfter = await listCustomFieldDefinitions(fixtures.orgA.id, "CLIENT");
    expect(activeListAfter.find((d) => d.id === created.definition.id)).toBeDefined();
  });

  // ---------------------------------------------------------------------
  // Tenant security (folded in here since it's Definition-specific)
  // ---------------------------------------------------------------------

  it("cross-org: a definition created in orgA is invisible to orgB's list, and cannot be updated/archived by orgB", async () => {
    const created = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Org A Only", fieldType: "TEXT" });
    if (!created.ok) throw new Error("expected ok");

    const orgBList = await listCustomFieldDefinitions(fixtures.orgB.id, "CLIENT");
    expect(orgBList.find((d) => d.id === created.definition.id)).toBeUndefined();

    const updateAttempt = await updateCustomFieldDefinition(fixtures.orgB.id, created.definition.id, { label: "Hijacked" });
    expect(updateAttempt).toEqual({ ok: false, reason: "DEFINITION_NOT_FOUND" });

    const archiveAttempt = await archiveCustomFieldDefinition(fixtures.orgB.id, created.definition.id);
    expect(archiveAttempt).toEqual({ ok: false, reason: "DEFINITION_NOT_FOUND" });
  });

  it("updateCustomFieldDefinition/archiveCustomFieldDefinition on a nonexistent id both fail the same controlled way as a foreign-org id", async () => {
    const bogusId = "00000000-0000-0000-0000-000000000000";
    expect(await updateCustomFieldDefinition(fixtures.orgA.id, bogusId, { label: "X" })).toEqual({
      ok: false,
      reason: "DEFINITION_NOT_FOUND",
    });
    expect(await archiveCustomFieldDefinition(fixtures.orgA.id, bogusId)).toEqual({
      ok: false,
      reason: "DEFINITION_NOT_FOUND",
    });
  });

  it("createCustomFieldDefinition rejects an empty/whitespace-only label", async () => {
    const result = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "   ", fieldType: "TEXT" });
    expect(result).toEqual({ ok: false, reason: "INVALID_LABEL" });
  });
});
