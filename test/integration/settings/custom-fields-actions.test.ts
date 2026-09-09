import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createDefinitionAction,
  updateDefinitionAction,
  archiveDefinitionAction,
  unarchiveDefinitionAction,
  moveDefinitionAction,
  createOptionAction,
  updateOptionAction,
  archiveOptionAction,
  unarchiveOptionAction,
  moveOptionAction,
} from "@/app/(dashboard)/settings/custom-fields/actions";
import { createCustomFieldDefinition } from "@/lib/custom-fields/definitions";
import { createCustomFieldOption } from "@/lib/custom-fields/options";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Custom Fields Phase 2A — the Server Action layer's own test plan
 * (Definitions 1-20, SELECT Options 21-29, Security 30-35 of that
 * phase's test plan). The underlying domain-layer behavior (create/
 * update/archive/unarchive/move) is already covered exhaustively in
 * test/integration/custom-fields/{definitions,options,reorder}.test.ts —
 * this file proves the thin Server Action wrapper (org resolution, form
 * parsing, entityType/fieldType structural immutability, error mapping)
 * behaves correctly on top of it, not the domain logic itself again.
 */

function buildFormData(fields: Record<string, string | boolean>, repeated?: Record<string, string[]>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "boolean") {
      if (value) fd.set(key, "on");
    } else {
      fd.set(key, value);
    }
  }
  if (repeated) {
    for (const [key, values] of Object.entries(repeated)) {
      for (const value of values) fd.append(key, value);
    }
  }
  return fd;
}

describe("Custom Fields Settings — Server Actions", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    resetAuthMock();
    await prisma.customFieldDefinition.deleteMany({ where: { organizationId: fixtures.orgA.id } });
    await prisma.customFieldDefinition.deleteMany({ where: { organizationId: fixtures.orgB.id } });
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  // ---------------------------------------------------------------------
  // Definitions — create (5-11)
  // ---------------------------------------------------------------------

  it("5. createDefinitionAction(CLIENT) creates a TEXT definition", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createDefinitionAction(
      "CLIENT",
      { error: null },
      buildFormData({ label: "Account Manager", fieldType: "TEXT" }),
    );
    expect(result).toEqual({ error: null });

    const definition = await prisma.customFieldDefinition.findFirst({ where: { organizationId: fixtures.orgA.id, entityType: "CLIENT" } });
    expect(definition?.label).toBe("Account Manager");
    expect(definition?.fieldType).toBe("TEXT");
    expect(definition?.key).toBe("account_manager");
  });

  it("6. createDefinitionAction creates a NUMBER definition", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await createDefinitionAction("PROJECT", { error: null }, buildFormData({ label: "Budget Note", fieldType: "NUMBER" }));
    const definition = await prisma.customFieldDefinition.findFirst({ where: { organizationId: fixtures.orgA.id, entityType: "PROJECT" } });
    expect(definition?.fieldType).toBe("NUMBER");
  });

  it("7. createDefinitionAction creates a DATE definition", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await createDefinitionAction("PROJECT", { error: null }, buildFormData({ label: "Kickoff", fieldType: "DATE" }));
    const definition = await prisma.customFieldDefinition.findFirst({ where: { organizationId: fixtures.orgA.id, entityType: "PROJECT" } });
    expect(definition?.fieldType).toBe("DATE");
  });

  it("8. createDefinitionAction creates a CHECKBOX definition", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await createDefinitionAction("CLIENT", { error: null }, buildFormData({ label: "VIP", fieldType: "CHECKBOX" }));
    const definition = await prisma.customFieldDefinition.findFirst({ where: { organizationId: fixtures.orgA.id, entityType: "CLIENT" } });
    expect(definition?.fieldType).toBe("CHECKBOX");
  });

  it("9. createDefinitionAction creates a SELECT definition, with its batched option labels created as real options in order", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createDefinitionAction(
      "LEAD",
      { error: null },
      buildFormData({ label: "Priority", fieldType: "SELECT" }, { optionLabel: ["Low", "Medium", "High", ""] }),
    );
    expect(result).toEqual({ error: null });

    const definition = await prisma.customFieldDefinition.findFirst({ where: { organizationId: fixtures.orgA.id, entityType: "LEAD" } });
    expect(definition?.fieldType).toBe("SELECT");
    const options = await prisma.customFieldOption.findMany({ where: { definitionId: definition!.id }, orderBy: { position: "asc" } });
    // The trailing blank optionLabel is dropped, never becomes a real option.
    expect(options.map((o) => o.label)).toEqual(["Low", "Medium", "High"]);
  });

  it("10. key auto-generation: a label with mixed case/punctuation derives a lower-case, machine-safe key", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await createDefinitionAction("CLIENT", { error: null }, buildFormData({ label: "Contract Signed?!" , fieldType: "CHECKBOX" }));
    const definition = await prisma.customFieldDefinition.findFirst({ where: { organizationId: fixtures.orgA.id, entityType: "CLIENT" } });
    expect(definition?.key).toMatch(/^[a-z0-9_]+$/);
  });

  it("11. key collision suffixing: two definitions created with the same label get deterministically suffixed keys", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await createDefinitionAction("CLIENT", { error: null }, buildFormData({ label: "Notes", fieldType: "TEXT" }));
    await createDefinitionAction("CLIENT", { error: null }, buildFormData({ label: "Notes", fieldType: "TEXT" }));

    const definitions = await prisma.customFieldDefinition.findMany({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT" },
      orderBy: { position: "asc" },
    });
    expect(definitions.map((d) => d.key)).toEqual(["notes", "notes_2"]);
  });

  it("missing label surfaces a field error, creates nothing", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createDefinitionAction("CLIENT", { error: null }, buildFormData({ label: "", fieldType: "TEXT" }));
    expect(result.fieldErrors?.label).toBeTruthy();
    expect(await prisma.customFieldDefinition.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("missing field type surfaces a field error, creates nothing", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createDefinitionAction("CLIENT", { error: null }, buildFormData({ label: "Notes" }));
    expect(result.fieldErrors?.fieldType).toBeTruthy();
    expect(await prisma.customFieldDefinition.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Definitions — update / immutability (12-15)
  // ---------------------------------------------------------------------

  it("12. label rename keeps the key unchanged", async () => {
    const created = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Account Manager", fieldType: "TEXT" });
    if (!created.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await updateDefinitionAction(created.definition.id, { error: null }, buildFormData({ label: "AM (renamed)" }));
    expect(result).toEqual({ error: null });

    const reloaded = await prisma.customFieldDefinition.findUnique({ where: { id: created.definition.id } });
    expect(reloaded?.label).toBe("AM (renamed)");
    expect(reloaded?.key).toBe("account_manager");
  });

  it("13. fieldType is immutable through updateDefinitionAction — a crafted 'fieldType' form field is never read at all", async () => {
    const created = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Notes", fieldType: "TEXT" });
    if (!created.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    await updateDefinitionAction(created.definition.id, { error: null }, buildFormData({ label: "Notes", fieldType: "NUMBER" }));

    const reloaded = await prisma.customFieldDefinition.findUnique({ where: { id: created.definition.id } });
    expect(reloaded?.fieldType).toBe("TEXT");
  });

  it("14. entityType is immutable — there is no action that accepts an entityType for an existing definition at all", async () => {
    const created = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Notes", fieldType: "TEXT" });
    if (!created.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    // Even a crafted 'entityType' form field has nowhere to be read from —
    // updateDefinitionAction's own parser never looks at it.
    await updateDefinitionAction(created.definition.id, { error: null }, buildFormData({ label: "Notes", entityType: "LEAD" }));

    const reloaded = await prisma.customFieldDefinition.findUnique({ where: { id: created.definition.id } });
    expect(reloaded?.entityType).toBe("CLIENT");
  });

  it("15. the required toggle can be turned on and off", async () => {
    const created = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Notes", fieldType: "TEXT" });
    if (!created.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    await updateDefinitionAction(created.definition.id, { error: null }, buildFormData({ label: "Notes", required: true }));
    expect((await prisma.customFieldDefinition.findUnique({ where: { id: created.definition.id } }))?.required).toBe(true);

    await updateDefinitionAction(created.definition.id, { error: null }, buildFormData({ label: "Notes", required: false }));
    expect((await prisma.customFieldDefinition.findUnique({ where: { id: created.definition.id } }))?.required).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Definitions — archive / unarchive / move (16-20)
  // ---------------------------------------------------------------------

  it("16/17. archiveDefinitionAction archives, hiding it from the active-only domain list by default", async () => {
    const created = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Legacy", fieldType: "TEXT" });
    if (!created.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    await archiveDefinitionAction(created.definition.id);

    const reloaded = await prisma.customFieldDefinition.findUnique({ where: { id: created.definition.id } });
    expect(reloaded?.archivedAt).not.toBeNull();
  });

  it("18. an archived definition is retrievable — 'archived filter' means includeArchived:true still returns it", async () => {
    const created = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Legacy", fieldType: "TEXT" });
    if (!created.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);
    await archiveDefinitionAction(created.definition.id);

    const active = await prisma.customFieldDefinition.findMany({ where: { organizationId: fixtures.orgA.id, archivedAt: null } });
    const all = await prisma.customFieldDefinition.findMany({ where: { organizationId: fixtures.orgA.id } });
    expect(active).toHaveLength(0);
    expect(all).toHaveLength(1);
  });

  it("19. unarchiveDefinitionAction restores visibility", async () => {
    const created = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Legacy", fieldType: "TEXT" });
    if (!created.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);
    await archiveDefinitionAction(created.definition.id);

    await unarchiveDefinitionAction(created.definition.id);

    const reloaded = await prisma.customFieldDefinition.findUnique({ where: { id: created.definition.id } });
    expect(reloaded?.archivedAt).toBeNull();
  });

  it("20. moveDefinitionAction reorders two active definitions", async () => {
    const first = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "First", fieldType: "TEXT" });
    const second = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Second", fieldType: "TEXT" });
    if (!first.ok || !second.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    await moveDefinitionAction("CLIENT", second.definition.id, "up");

    const reloaded = await prisma.customFieldDefinition.findMany({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT" },
      orderBy: { position: "asc" },
    });
    expect(reloaded.map((d) => d.label)).toEqual(["Second", "First"]);
  });

  // ---------------------------------------------------------------------
  // SELECT options (21-29)
  // ---------------------------------------------------------------------

  async function makeSelectDefinition(organizationId = fixtures.orgA.id) {
    const result = await createCustomFieldDefinition(organizationId, "LEAD", { label: "Priority", fieldType: "SELECT" });
    if (!result.ok) throw new Error("expected ok");
    return result.definition;
  }

  it("21. createOptionAction adds an option to a SELECT definition", async () => {
    const definition = await makeSelectDefinition();
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await createOptionAction(definition.id, { error: null }, buildFormData({ label: "Low" }));
    expect(result).toEqual({ error: null });

    const option = await prisma.customFieldOption.findFirst({ where: { definitionId: definition.id } });
    expect(option?.label).toBe("Low");
    expect(option?.value).toBe("low");
  });

  it("22/23. updateOptionAction renames the label — the stable machine value never changes", async () => {
    const definition = await makeSelectDefinition();
    const option = await createCustomFieldOption(fixtures.orgA.id, definition.id, { label: "Low" });
    if (!option.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await updateOptionAction(definition.id, option.option.id, { error: null }, buildFormData({ label: "Low priority" }));
    expect(result).toEqual({ error: null });

    const reloaded = await prisma.customFieldOption.findUnique({ where: { id: option.option.id } });
    expect(reloaded?.label).toBe("Low priority");
    expect(reloaded?.value).toBe("low");
  });

  it("24. archiveOptionAction archives an option", async () => {
    const definition = await makeSelectDefinition();
    const option = await createCustomFieldOption(fixtures.orgA.id, definition.id, { label: "Deprecated" });
    if (!option.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    await archiveOptionAction(definition.id, option.option.id);

    const reloaded = await prisma.customFieldOption.findUnique({ where: { id: option.option.id } });
    expect(reloaded?.archivedAt).not.toBeNull();
  });

  it("25. an archived option is excluded from the active-only domain list, so it can't be freshly selected on a Value (Phase 1 behavior, unchanged)", async () => {
    const definition = await makeSelectDefinition();
    const option = await createCustomFieldOption(fixtures.orgA.id, definition.id, { label: "Deprecated" });
    if (!option.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);
    await archiveOptionAction(definition.id, option.option.id);

    const active = await prisma.customFieldOption.findMany({ where: { definitionId: definition.id, archivedAt: null } });
    expect(active).toHaveLength(0);
  });

  it("26. archived options remain retrievable via an explicit archived view", async () => {
    const definition = await makeSelectDefinition();
    const option = await createCustomFieldOption(fixtures.orgA.id, definition.id, { label: "Deprecated" });
    if (!option.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);
    await archiveOptionAction(definition.id, option.option.id);

    const all = await prisma.customFieldOption.findMany({ where: { definitionId: definition.id } });
    expect(all).toHaveLength(1);
    expect(all[0].archivedAt).not.toBeNull();
  });

  it("27. unarchiveOptionAction restores an option", async () => {
    const definition = await makeSelectDefinition();
    const option = await createCustomFieldOption(fixtures.orgA.id, definition.id, { label: "Deprecated" });
    if (!option.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);
    await archiveOptionAction(definition.id, option.option.id);

    await unarchiveOptionAction(definition.id, option.option.id);

    const reloaded = await prisma.customFieldOption.findUnique({ where: { id: option.option.id } });
    expect(reloaded?.archivedAt).toBeNull();
  });

  it("28. moveOptionAction reorders two active options", async () => {
    const definition = await makeSelectDefinition();
    const first = await createCustomFieldOption(fixtures.orgA.id, definition.id, { label: "Low" });
    const second = await createCustomFieldOption(fixtures.orgA.id, definition.id, { label: "High" });
    if (!first.ok || !second.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    await moveOptionAction(definition.id, second.option.id, "up");

    const reloaded = await prisma.customFieldOption.findMany({ where: { definitionId: definition.id }, orderBy: { position: "asc" } });
    expect(reloaded.map((o) => o.label)).toEqual(["High", "Low"]);
  });

  it("29. an already-selected archived option's historical CustomFieldValue relationship is preserved through the Server Action layer too", async () => {
    const definition = await makeSelectDefinition();
    const option = await createCustomFieldOption(fixtures.orgA.id, definition.id, { label: "Deprecated" });
    if (!option.ok) throw new Error("expected ok");

    // Simulate a Phase 2B-style existing selection (direct domain write —
    // Phase 2A itself never writes CustomFieldValue rows).
    await prisma.customFieldValue.create({
      data: {
        organizationId: fixtures.orgA.id,
        definitionId: definition.id,
        entityId: fixtures.clientA.id,
        selectedOptionId: option.option.id,
      },
    });

    actAs(fixtures.owner, fixtures.orgA.id);
    await archiveOptionAction(definition.id, option.option.id);

    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: definition.id, entityId: fixtures.clientA.id } });
    expect(value?.selectedOptionId).toBe(option.option.id);

    await prisma.customFieldValue.deleteMany({ where: { definitionId: definition.id } });
  });

  // ---------------------------------------------------------------------
  // Security (30-34)
  // ---------------------------------------------------------------------

  it("30. a foreign-org definition id is rejected by updateDefinitionAction/archiveDefinitionAction", async () => {
    const created = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Org A Only", fieldType: "TEXT" });
    if (!created.ok) throw new Error("expected ok");
    actAs(fixtures.orgBOwner, fixtures.orgB.id);

    const updateResult = await updateDefinitionAction(created.definition.id, { error: null }, buildFormData({ label: "Hijacked" }));
    expect(updateResult).toEqual({ error: "Custom field not found." });

    await expect(archiveDefinitionAction(created.definition.id)).rejects.toThrow("Custom field not found.");

    const reloaded = await prisma.customFieldDefinition.findUnique({ where: { id: created.definition.id } });
    expect(reloaded?.label).toBe("Org A Only");
    expect(reloaded?.archivedAt).toBeNull();
  });

  it("31. a foreign-org option id is rejected by updateOptionAction/archiveOptionAction", async () => {
    const definition = await makeSelectDefinition(fixtures.orgA.id);
    const option = await createCustomFieldOption(fixtures.orgA.id, definition.id, { label: "Low" });
    if (!option.ok) throw new Error("expected ok");
    actAs(fixtures.orgBOwner, fixtures.orgB.id);

    const renameResult = await updateOptionAction(definition.id, option.option.id, { error: null }, buildFormData({ label: "Hijacked" }));
    expect(renameResult).toEqual({ error: "Option not found." });

    await expect(archiveOptionAction(definition.id, option.option.id)).rejects.toThrow("Option not found.");
  });

  it("32. a crafted entityType form field can never change an existing definition's entityType (already covered structurally in test 14, re-asserted here as a security case)", async () => {
    const created = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Notes", fieldType: "TEXT" });
    if (!created.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    await updateDefinitionAction(
      created.definition.id,
      { error: null },
      buildFormData({ label: "Notes", entityType: "PROJECT" }),
    );

    expect((await prisma.customFieldDefinition.findUnique({ where: { id: created.definition.id } }))?.entityType).toBe("CLIENT");
  });

  it("33. a crafted fieldType form field can never change an existing definition's fieldType (already covered structurally in test 13, re-asserted here as a security case)", async () => {
    const created = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Notes", fieldType: "TEXT" });
    if (!created.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    await updateDefinitionAction(created.definition.id, { error: null }, buildFormData({ label: "Notes", fieldType: "SELECT" }));

    expect((await prisma.customFieldDefinition.findUnique({ where: { id: created.definition.id } }))?.fieldType).toBe("TEXT");
  });

  it("34. an option belonging to a different definition (same org) is rejected as OPTION_NOT_FOUND by the Server Action layer", async () => {
    const definitionOne = await makeSelectDefinition(fixtures.orgA.id);
    const definitionTwo = await createCustomFieldDefinition(fixtures.orgA.id, "LEAD", { label: "Status", fieldType: "SELECT" });
    if (!definitionTwo.ok) throw new Error("expected ok");
    const optionOnOne = await createCustomFieldOption(fixtures.orgA.id, definitionOne.id, { label: "Low" });
    if (!optionOnOne.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await updateOptionAction(
      definitionTwo.definition.id,
      optionOnOne.option.id,
      { error: null },
      buildFormData({ label: "Hijacked" }),
    );
    expect(result).toEqual({ error: "Option not found." });
  });

  it("every OWNER/ADMIN/MEMBER role can manage definitions — no extra role gate beyond org membership (matches Client-management permission model)", async () => {
    for (const [user, role] of [
      [fixtures.owner, "OWNER"],
      [fixtures.admin, "ADMIN"],
      [fixtures.member, "MEMBER"],
    ] as const) {
      actAs(user, fixtures.orgA.id);
      const result = await createDefinitionAction("CLIENT", { error: null }, buildFormData({ label: `Field by ${role}`, fieldType: "TEXT" }));
      expect(result).toEqual({ error: null });
      resetAuthMock();
    }

    expect(await prisma.customFieldDefinition.count({ where: { organizationId: fixtures.orgA.id } })).toBe(3);
  });
});
