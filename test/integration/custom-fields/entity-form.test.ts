import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCustomFieldDefinition } from "@/lib/custom-fields/definitions";
import { createCustomFieldOption, archiveCustomFieldOption } from "@/lib/custom-fields/options";
import { upsertCustomFieldValue } from "@/lib/custom-fields/values";
import {
  getActiveCustomFieldFormDefinitions,
  getCustomFieldFormValues,
  parseCustomFieldFormValues,
  validateCustomFieldFormValues,
  persistCustomFieldValuesInTransaction,
} from "@/lib/custom-fields/entity-form";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { resetAuthMock } from "../../support/auth-mock";

/**
 * Custom Fields Phase 2B — coverage for the reusable entity-form helpers
 * themselves (src/lib/custom-fields/entity-form.ts), independent of any
 * one entity's Server Action. This is the module every Client/Lead/
 * Project create/edit action shares (Section N) — its own correctness is
 * proven once, here, rather than re-derived in each entity's own test
 * file.
 */

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("Custom Fields — entity-form helpers", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    resetAuthMock();
    await prisma.customFieldDefinition.deleteMany({ where: { organizationId: fixtures.orgA.id } });
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("getActiveCustomFieldFormDefinitions returns only active definitions, in position order, with SELECT options resolved", async () => {
    const first = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "First", fieldType: "TEXT" });
    const second = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Second", fieldType: "SELECT" });
    const archived = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Archived", fieldType: "TEXT" });
    if (!first.ok || !second.ok || !archived.ok) throw new Error("expected ok");
    await createCustomFieldOption(fixtures.orgA.id, second.definition.id, { label: "Low" });
    await createCustomFieldOption(fixtures.orgA.id, second.definition.id, { label: "High" });
    await prisma.customFieldDefinition.update({ where: { id: archived.definition.id }, data: { archivedAt: new Date() } });

    const definitions = await getActiveCustomFieldFormDefinitions(fixtures.orgA.id, "CLIENT");

    expect(definitions.map((d) => d.label)).toEqual(["First", "Second"]);
    expect(definitions[1].options.map((o) => o.label)).toEqual(["Low", "High"]);
  });

  it("parseCustomFieldFormValues never reads a FormData key that isn't one of the given definitions (forged/foreign keys ignored)", async () => {
    const def = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Notes", fieldType: "TEXT" });
    if (!def.ok) throw new Error("expected ok");
    const formData = buildFormData({
      [`customField_${def.definition.id}`]: "hello",
      customField_00000000_forged: "evil",
      unrelatedField: "ignored",
    });

    const parsed = parseCustomFieldFormValues(formData, [
      { id: def.definition.id, label: "Notes", fieldType: "TEXT", required: false, options: [] },
    ]);

    expect(parsed.get(def.definition.id)).toBe("hello");
    expect(parsed.size).toBe(1);
  });

  it("validateCustomFieldFormValues enforces TEXT/NUMBER/DATE required rules, and accepts NUMBER zero", async () => {
    const text = { id: "d1", label: "T", fieldType: "TEXT" as const, required: true, options: [] };
    const number = { id: "d2", label: "N", fieldType: "NUMBER" as const, required: true, options: [] };
    const date = { id: "d3", label: "D", fieldType: "DATE" as const, required: true, options: [] };

    const emptyText = validateCustomFieldFormValues([text], new Map([["d1", ""]]));
    expect(emptyText.ok).toBe(false);
    if (!emptyText.ok) expect(emptyText.fieldErrors.d1).toBeTruthy();

    const emptyNumber = validateCustomFieldFormValues([number], new Map([["d2", ""]]));
    expect(emptyNumber.ok).toBe(false);

    const zeroNumber = validateCustomFieldFormValues([number], new Map([["d2", "0"]]));
    expect(zeroNumber.ok).toBe(true);

    const emptyDate = validateCustomFieldFormValues([date], new Map([["d3", ""]]));
    expect(emptyDate.ok).toBe(false);

    const validDate = validateCustomFieldFormValues([date], new Map([["d3", "2026-03-15"]]));
    expect(validDate.ok).toBe(true);
  });

  it("validateCustomFieldFormValues: required CHECKBOX always succeeds — false is a valid explicit answer, never 'must be checked'", async () => {
    const checkbox = { id: "d1", label: "C", fieldType: "CHECKBOX" as const, required: true, options: [] };

    const unchecked = validateCustomFieldFormValues([checkbox], new Map([["d1", null]]));
    expect(unchecked.ok).toBe(true);
    if (unchecked.ok) expect(unchecked.decisions.get("d1")).toBe("set");

    const checked = validateCustomFieldFormValues([checkbox], new Map([["d1", "on"]]));
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.decisions.get("d1")).toBe("set");
  });

  it("validateCustomFieldFormValues: required SELECT rejects empty, accepts a real active option", async () => {
    const select = {
      id: "d1",
      label: "S",
      fieldType: "SELECT" as const,
      required: true,
      options: [{ id: "opt1", label: "Low" }],
    };

    const empty = validateCustomFieldFormValues([select], new Map([["d1", ""]]));
    expect(empty.ok).toBe(false);

    const valid = validateCustomFieldFormValues([select], new Map([["d1", "opt1"]]));
    expect(valid.ok).toBe(true);
  });

  it("validateCustomFieldFormValues: SELECT rejects a value that isn't one of the definition's own active options", async () => {
    const select = {
      id: "d1",
      label: "S",
      fieldType: "SELECT" as const,
      required: false,
      options: [{ id: "opt1", label: "Low" }],
    };
    const foreign = validateCustomFieldFormValues([select], new Map([["d1", "not-a-real-option"]]));
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.fieldErrors.d1).toBe("Select a valid option.");
  });

  it("getCustomFieldFormValues resolves an archived selected option's label and marks it archived", async () => {
    const def = await createCustomFieldDefinition(fixtures.orgA.id, "LEAD", { label: "Priority", fieldType: "SELECT" });
    if (!def.ok) throw new Error("expected ok");
    const option = await createCustomFieldOption(fixtures.orgA.id, def.definition.id, { label: "Deprecated" });
    if (!option.ok) throw new Error("expected ok");

    const lead = await prisma.lead.create({ data: { organizationId: fixtures.orgA.id, name: "L1" } });
    await upsertCustomFieldValue(fixtures.orgA.id, "LEAD", lead.id, def.definition.id, option.option.id);
    await archiveCustomFieldOption(fixtures.orgA.id, def.definition.id, option.option.id);

    const definitions = await getActiveCustomFieldFormDefinitions(fixtures.orgA.id, "LEAD");
    const values = await getCustomFieldFormValues(fixtures.orgA.id, "LEAD", lead.id, definitions);

    const value = values.get(def.definition.id);
    expect(value?.selectedOptionId).toBe(option.option.id);
    expect(value?.selectedOptionLabel).toBe("Deprecated");
    expect(value?.selectedOptionArchived).toBe(true);

    await prisma.customFieldValue.deleteMany({ where: { definitionId: def.definition.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
  });

  it("validateCustomFieldFormValues: resubmitting the SAME archived selectedOptionId is treated as unchanged and accepted, even when required", async () => {
    const def = await createCustomFieldDefinition(fixtures.orgA.id, "LEAD", { label: "Priority", fieldType: "SELECT", required: true });
    if (!def.ok) throw new Error("expected ok");
    const option = await createCustomFieldOption(fixtures.orgA.id, def.definition.id, { label: "Deprecated" });
    if (!option.ok) throw new Error("expected ok");

    const lead = await prisma.lead.create({ data: { organizationId: fixtures.orgA.id, name: "L2" } });
    await upsertCustomFieldValue(fixtures.orgA.id, "LEAD", lead.id, def.definition.id, option.option.id);
    await archiveCustomFieldOption(fixtures.orgA.id, def.definition.id, option.option.id);

    const definitions = await getActiveCustomFieldFormDefinitions(fixtures.orgA.id, "LEAD");
    const values = await getCustomFieldFormValues(fixtures.orgA.id, "LEAD", lead.id, definitions);

    // Resubmitting the exact same (now-archived) id — must succeed, "skip".
    const unchanged = validateCustomFieldFormValues(definitions, new Map([[def.definition.id, option.option.id]]), values);
    expect(unchanged.ok).toBe(true);
    if (unchanged.ok) expect(unchanged.decisions.get(def.definition.id)).toBe("skip");

    // Clearing it (submitting empty) — must FAIL, since the field is required.
    const cleared = validateCustomFieldFormValues(definitions, new Map([[def.definition.id, ""]]), values);
    expect(cleared.ok).toBe(false);

    await prisma.customFieldValue.deleteMany({ where: { definitionId: def.definition.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
  });

  it("persistCustomFieldValuesInTransaction: 'set' writes a value, 'clear' deletes it, 'skip' touches nothing", async () => {
    const textDef = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Notes", fieldType: "TEXT" });
    const numberDef = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", { label: "Score", fieldType: "NUMBER" });
    if (!textDef.ok || !numberDef.ok) throw new Error("expected ok");

    const client = await prisma.client.create({ data: { name: "PC1", organizationId: fixtures.orgA.id, userId: fixtures.owner.id } });
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", client.id, numberDef.definition.id, 42);

    const definitions = await getActiveCustomFieldFormDefinitions(fixtures.orgA.id, "CLIENT");
    const rawValues = new Map([
      [textDef.definition.id, "Hello"],
      [numberDef.definition.id, ""], // clearing the existing 42
    ]);

    await prisma.$transaction((tx) =>
      persistCustomFieldValuesInTransaction(tx, {
        organizationId: fixtures.orgA.id,
        entityType: "CLIENT",
        entityId: client.id,
        definitions,
        rawValues,
        decisions: new Map([
          [textDef.definition.id, "set"],
          [numberDef.definition.id, "clear"],
        ]),
      }),
    );

    const textValue = await prisma.customFieldValue.findFirst({ where: { definitionId: textDef.definition.id, entityId: client.id } });
    expect(textValue?.textValue).toBe("Hello");
    const numberValue = await prisma.customFieldValue.findFirst({ where: { definitionId: numberDef.definition.id, entityId: client.id } });
    expect(numberValue).toBeNull();

    await prisma.client.delete({ where: { id: client.id } });
  });
});
