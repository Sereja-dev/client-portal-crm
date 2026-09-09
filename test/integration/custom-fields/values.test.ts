import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCustomFieldDefinition } from "@/lib/custom-fields/definitions";
import { createCustomFieldOption, archiveCustomFieldOption } from "@/lib/custom-fields/options";
import { upsertCustomFieldValue, clearCustomFieldValue, listCustomFieldValues } from "@/lib/custom-fields/values";
import { assertCustomFieldEntityOwnership } from "@/lib/custom-fields/entity-ownership";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { resetAuthMock } from "../../support/auth-mock";

/**
 * Custom Fields Phase 1 — Value domain-layer coverage (test items 12-26
 * of the originating task) plus Security coverage (items 31-33, folded
 * in here since ownership validation is exercised on every value
 * mutation). Definition/Option coverage lives in definitions.test.ts/
 * options.test.ts; delete-cleanup coverage lives in
 * delete-cleanup.test.ts; schema/constraint-level coverage lives in
 * schema-migration.test.ts.
 */

async function cleanupOrgCustomFields(organizationId: string) {
  await prisma.customFieldDefinition.deleteMany({ where: { organizationId } });
}

async function makeLead(organizationId: string, name = `Lead-${randomUUID().slice(0, 8)}`) {
  return prisma.lead.create({ data: { organizationId, name } });
}

describe("Custom Fields — Value domain layer", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    resetAuthMock();
    await cleanupOrgCustomFields(fixtures.orgA.id);
    await cleanupOrgCustomFields(fixtures.orgB.id);
    await prisma.lead.deleteMany({ where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  async function makeDefinition(
    entityType: "CLIENT" | "LEAD" | "PROJECT",
    fieldType: "TEXT" | "NUMBER" | "DATE" | "CHECKBOX" | "SELECT",
    label = `Field-${randomUUID().slice(0, 8)}`,
    organizationId = fixtures.orgA.id,
  ) {
    const result = await createCustomFieldDefinition(organizationId, entityType, { label, fieldType });
    if (!result.ok) throw new Error("expected ok");
    return result.definition;
  }

  // ---------------------------------------------------------------------
  // TEXT (12-13)
  // ---------------------------------------------------------------------

  it("12. upsertCustomFieldValue(TEXT) creates a value row with the trimmed text", async () => {
    const definition = await makeDefinition("CLIENT", "TEXT");
    const result = await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, definition.id, "  Acme Corp  ");
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) throw new Error("expected a value");
    expect(result.value.textValue).toBe("Acme Corp");
    expect(result.value.numberValue).toBeNull();
    expect(result.value.organizationId).toBe(fixtures.orgA.id);
  });

  it("13. upserting TEXT with an empty string clears the value — no row is left behind", async () => {
    const definition = await makeDefinition("CLIENT", "TEXT");
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, definition.id, "Something");
    const cleared = await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, definition.id, "");
    expect(cleared).toEqual({ ok: true, value: null });

    const row = await prisma.customFieldValue.findFirst({ where: { definitionId: definition.id, entityId: fixtures.clientA.id } });
    expect(row).toBeNull();
  });

  // ---------------------------------------------------------------------
  // NUMBER (14-16)
  // ---------------------------------------------------------------------

  it("14. upsertCustomFieldValue(NUMBER) stores a valid decimal", async () => {
    const definition = await makeDefinition("PROJECT", "NUMBER");
    const result = await upsertCustomFieldValue(fixtures.orgA.id, "PROJECT", fixtures.project.id, definition.id, 1234.56);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) throw new Error("expected a value");
    expect(Number(result.value.numberValue)).toBe(1234.56);
  });

  it("15. upsertCustomFieldValue(NUMBER) rejects a non-numeric value", async () => {
    const definition = await makeDefinition("PROJECT", "NUMBER");
    const result = await upsertCustomFieldValue(fixtures.orgA.id, "PROJECT", fixtures.project.id, definition.id, "not-a-number");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("INVALID_VALUE");
  });

  it("16. upsertCustomFieldValue(NUMBER) rejects a value outside the Decimal(10,2) representable range", async () => {
    const definition = await makeDefinition("PROJECT", "NUMBER");
    const result = await upsertCustomFieldValue(fixtures.orgA.id, "PROJECT", fixtures.project.id, definition.id, 999_999_999_999);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("INVALID_VALUE");
  });

  // ---------------------------------------------------------------------
  // DATE (17-18)
  // ---------------------------------------------------------------------

  it("17. upsertCustomFieldValue(DATE) stores a date-only string as UTC midnight, with no timezone drift", async () => {
    const definition = await makeDefinition("PROJECT", "DATE");
    const result = await upsertCustomFieldValue(fixtures.orgA.id, "PROJECT", fixtures.project.id, definition.id, "2026-03-15");
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) throw new Error("expected a value");
    expect(result.value.dateValue?.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("18. upsertCustomFieldValue(DATE) rejects an invalid calendar date and a non-date-only string", async () => {
    const definition = await makeDefinition("PROJECT", "DATE");
    const invalidDay = await upsertCustomFieldValue(fixtures.orgA.id, "PROJECT", fixtures.project.id, definition.id, "2026-02-30");
    expect(invalidDay.ok).toBe(false);
    const fullDatetime = await upsertCustomFieldValue(fixtures.orgA.id, "PROJECT", fixtures.project.id, definition.id, "2026-03-15T10:00:00Z");
    expect(fullDatetime.ok).toBe(false);
  });

  // ---------------------------------------------------------------------
  // CHECKBOX (19)
  // ---------------------------------------------------------------------

  it("19. upsertCustomFieldValue(CHECKBOX) stores true/false but rejects a non-boolean", async () => {
    const definition = await makeDefinition("CLIENT", "CHECKBOX");
    const trueResult = await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, definition.id, true);
    expect(trueResult.ok).toBe(true);
    if (!trueResult.ok || !trueResult.value) throw new Error("expected a value");
    expect(trueResult.value.booleanValue).toBe(true);

    const invalid = await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, definition.id, "true");
    expect(invalid.ok).toBe(false);
    if (invalid.ok) throw new Error("expected failure");
    expect(invalid.reason).toBe("INVALID_VALUE");
  });

  // ---------------------------------------------------------------------
  // SELECT (20-22)
  // ---------------------------------------------------------------------

  it("20. upsertCustomFieldValue(SELECT) sets selectedOptionId for a valid, active option belonging to the definition", async () => {
    const definition = await makeDefinition("LEAD", "SELECT");
    const option = await createCustomFieldOption(fixtures.orgA.id, definition.id, { label: "High" });
    if (!option.ok) throw new Error("expected ok");
    const lead = await makeLead(fixtures.orgA.id);

    const result = await upsertCustomFieldValue(fixtures.orgA.id, "LEAD", lead.id, definition.id, option.option.id);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) throw new Error("expected a value");
    expect(result.value.selectedOptionId).toBe(option.option.id);
  });

  it("21. upsertCustomFieldValue(SELECT) rejects an option id that belongs to a different definition", async () => {
    const definitionOne = await makeDefinition("LEAD", "SELECT");
    const definitionTwo = await makeDefinition("LEAD", "SELECT");
    const optionOnTwo = await createCustomFieldOption(fixtures.orgA.id, definitionTwo.id, { label: "High" });
    if (!optionOnTwo.ok) throw new Error("expected ok");
    const lead = await makeLead(fixtures.orgA.id);

    const result = await upsertCustomFieldValue(fixtures.orgA.id, "LEAD", lead.id, definitionOne.id, optionOnTwo.option.id);
    expect(result).toEqual({ ok: false, reason: "OPTION_NOT_FOUND" });
  });

  it("22. upsertCustomFieldValue(SELECT) refuses to newly select an archived option, but an existing selection of it survives untouched", async () => {
    const definition = await makeDefinition("LEAD", "SELECT");
    const option = await createCustomFieldOption(fixtures.orgA.id, definition.id, { label: "Deprecated" });
    if (!option.ok) throw new Error("expected ok");
    const leadAlreadySelected = await makeLead(fixtures.orgA.id);
    const leadTryingFresh = await makeLead(fixtures.orgA.id);

    // Select it while still active.
    const before = await upsertCustomFieldValue(fixtures.orgA.id, "LEAD", leadAlreadySelected.id, definition.id, option.option.id);
    expect(before.ok).toBe(true);

    await archiveCustomFieldOption(fixtures.orgA.id, definition.id, option.option.id);

    // A fresh selection of the now-archived option is refused.
    const freshAttempt = await upsertCustomFieldValue(fixtures.orgA.id, "LEAD", leadTryingFresh.id, definition.id, option.option.id);
    expect(freshAttempt).toEqual({ ok: false, reason: "ARCHIVED_OPTION" });

    // The prior selection is retained, not silently cleared (Section O).
    const existingRow = await prisma.customFieldValue.findFirst({
      where: { definitionId: definition.id, entityId: leadAlreadySelected.id },
    });
    expect(existingRow?.selectedOptionId).toBe(option.option.id);
  });

  // ---------------------------------------------------------------------
  // Clear / uniqueness / listing / cross-type safety (23-26)
  // ---------------------------------------------------------------------

  it("23. clearCustomFieldValue deletes the row, and is idempotent when there was never a value", async () => {
    const definition = await makeDefinition("CLIENT", "TEXT");
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, definition.id, "Something");

    const cleared = await clearCustomFieldValue(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, definition.id);
    expect(cleared).toEqual({ ok: true });
    expect(
      await prisma.customFieldValue.findFirst({ where: { definitionId: definition.id, entityId: fixtures.clientA.id } }),
    ).toBeNull();

    // Idempotent — clearing an already-clear value is still a success.
    const clearedAgain = await clearCustomFieldValue(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, definition.id);
    expect(clearedAgain).toEqual({ ok: true });
  });

  it("24. upserting the same definition+entity twice updates the existing row rather than creating a duplicate (Section J)", async () => {
    const definition = await makeDefinition("CLIENT", "TEXT");
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, definition.id, "First");
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, definition.id, "Second");

    const rows = await prisma.customFieldValue.findMany({ where: { definitionId: definition.id, entityId: fixtures.clientA.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].textValue).toBe("Second");
  });

  it("25. listCustomFieldValues returns every value for one entity, across multiple definitions", async () => {
    const textDef = await makeDefinition("CLIENT", "TEXT");
    const numberDef = await makeDefinition("CLIENT", "NUMBER");
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, textDef.id, "Acme");
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, numberDef.id, 42);

    const result = await listCustomFieldValues(fixtures.orgA.id, "CLIENT", fixtures.clientA.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.values).toHaveLength(2);
    expect(result.values.map((v) => v.definitionId).sort()).toEqual([textDef.id, numberDef.id].sort());
  });

  it("26. every persisted value row has exactly one typed column populated, regardless of field type", async () => {
    const textDef = await makeDefinition("CLIENT", "TEXT");
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, textDef.id, "Acme");

    const row = await prisma.customFieldValue.findFirstOrThrow({ where: { definitionId: textDef.id, entityId: fixtures.clientA.id } });
    const populated = [row.textValue, row.numberValue, row.dateValue, row.booleanValue, row.selectedOptionId].filter(
      (v) => v !== null,
    );
    expect(populated).toHaveLength(1);
  });

  // ---------------------------------------------------------------------
  // Security (31-33)
  // ---------------------------------------------------------------------

  it("31. assertCustomFieldEntityOwnership returns false for an entity that belongs to a different organization — indistinguishable from nonexistent", async () => {
    const ownedByA = await assertCustomFieldEntityOwnership({
      organizationId: fixtures.orgA.id,
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
    });
    expect(ownedByA).toBe(true);

    const crossOrgAttempt = await assertCustomFieldEntityOwnership({
      organizationId: fixtures.orgB.id,
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
    });
    expect(crossOrgAttempt).toBe(false);

    const nonexistentAttempt = await assertCustomFieldEntityOwnership({
      organizationId: fixtures.orgA.id,
      entityType: "CLIENT",
      entityId: "00000000-0000-0000-0000-000000000000",
    });
    expect(nonexistentAttempt).toBe(false);
  });

  it("32. upsertCustomFieldValue rejects an entityType that doesn't match the definition's own entityType, even for a real entityId in the same org", async () => {
    const leadDefinition = await makeDefinition("LEAD", "TEXT");
    // clientA.id is a real, same-org entity — just not what this definition is for.
    const result = await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", fixtures.clientA.id, leadDefinition.id, "value");
    expect(result).toEqual({ ok: false, reason: "DEFINITION_NOT_FOUND" });
  });

  it("33. every value function refuses a foreign-org entityId even when the definition itself is valid and owned by the caller's org", async () => {
    const definition = await makeDefinition("CLIENT", "TEXT");
    // clientB belongs to orgB — orgA has no access to it.
    const result = await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", fixtures.clientB.id, definition.id, "value");
    expect(result).toEqual({ ok: false, reason: "ENTITY_NOT_FOUND" });

    const listResult = await listCustomFieldValues(fixtures.orgA.id, "CLIENT", fixtures.clientB.id);
    expect(listResult).toEqual({ ok: false, reason: "ENTITY_NOT_FOUND" });

    const clearResult = await clearCustomFieldValue(fixtures.orgA.id, "CLIENT", fixtures.clientB.id, definition.id);
    expect(clearResult).toEqual({ ok: false, reason: "ENTITY_NOT_FOUND" });
  });
});
