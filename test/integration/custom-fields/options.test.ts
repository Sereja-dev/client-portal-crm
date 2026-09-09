import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCustomFieldDefinition } from "@/lib/custom-fields/definitions";
import {
  listCustomFieldOptions,
  createCustomFieldOption,
  renameCustomFieldOption,
  archiveCustomFieldOption,
  unarchiveCustomFieldOption,
} from "@/lib/custom-fields/options";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { resetAuthMock } from "../../support/auth-mock";

/**
 * Custom Fields Phase 1 — SELECT option domain-layer coverage (Section O
 * of the originating task; folds into the "Definition" numbered range
 * since CustomFieldOption is a child of CustomFieldDefinition). SELECT
 * value-selection coverage (choosing/clearing an option on an entity)
 * lives in values.test.ts.
 */

async function cleanupDefinitions(organizationId: string) {
  await prisma.customFieldDefinition.deleteMany({ where: { organizationId } });
}

describe("Custom Fields — Option domain layer", () => {
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

  async function makeSelectDefinition(organizationId = fixtures.orgA.id) {
    const result = await createCustomFieldDefinition(organizationId, "LEAD", { label: "Priority", fieldType: "SELECT" });
    if (!result.ok) throw new Error("expected ok");
    return result.definition;
  }

  it("listCustomFieldOptions returns an empty array for a fresh SELECT definition", async () => {
    const definition = await makeSelectDefinition();
    const result = await listCustomFieldOptions(fixtures.orgA.id, definition.id);
    expect(result).toEqual([]);
  });

  it("createCustomFieldOption is rejected for a non-SELECT definition", async () => {
    const textDef = await createCustomFieldDefinition(fixtures.orgA.id, "LEAD", { label: "Notes", fieldType: "TEXT" });
    if (!textDef.ok) throw new Error("expected ok");

    const result = await createCustomFieldOption(fixtures.orgA.id, textDef.definition.id, { label: "Nope" });
    expect(result).toEqual({ ok: false, reason: "NOT_SELECT_FIELD" });
  });

  it("createCustomFieldOption derives a stable, deduplicated `value` from the label, and assigns sequential positions", async () => {
    const definition = await makeSelectDefinition();

    const low = await createCustomFieldOption(fixtures.orgA.id, definition.id, { label: "Low" });
    const high = await createCustomFieldOption(fixtures.orgA.id, definition.id, { label: "High" });
    const dup = await createCustomFieldOption(fixtures.orgA.id, definition.id, { label: "Low" });
    if (!low.ok || !high.ok || !dup.ok) throw new Error("expected ok");

    expect(low.option.value).toBe("low");
    expect(low.option.position).toBe(0);
    expect(high.option.value).toBe("high");
    expect(high.option.position).toBe(1);
    // Deterministic collision handling, same as CustomFieldDefinition.key.
    expect(dup.option.value).toBe("low_2");
    expect(dup.option.position).toBe(2);

    const list = await listCustomFieldOptions(fixtures.orgA.id, definition.id);
    if (!Array.isArray(list)) throw new Error("expected array");
    expect(list.map((o) => o.label)).toEqual(["Low", "High", "Low"]);
  });

  it("renameCustomFieldOption changes only the label — `value` (the stable machine identity) never changes", async () => {
    const definition = await makeSelectDefinition();
    const created = await createCustomFieldOption(fixtures.orgA.id, definition.id, { label: "Low" });
    if (!created.ok) throw new Error("expected ok");

    const renamed = await renameCustomFieldOption(fixtures.orgA.id, definition.id, created.option.id, "Low priority");
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) throw new Error("expected ok");
    expect(renamed.option.label).toBe("Low priority");
    expect(renamed.option.value).toBe("low");
  });

  it("archiving an option hides it from the default active list; unarchiving restores it, both idempotent", async () => {
    const definition = await makeSelectDefinition();
    const created = await createCustomFieldOption(fixtures.orgA.id, definition.id, { label: "Deprecated" });
    if (!created.ok) throw new Error("expected ok");

    const archived = await archiveCustomFieldOption(fixtures.orgA.id, definition.id, created.option.id);
    expect(archived.ok).toBe(true);
    if (!archived.ok) throw new Error("expected ok");
    expect(archived.option.archivedAt).not.toBeNull();

    const activeList = await listCustomFieldOptions(fixtures.orgA.id, definition.id);
    if (!Array.isArray(activeList)) throw new Error("expected array");
    expect(activeList.find((o) => o.id === created.option.id)).toBeUndefined();

    const fullList = await listCustomFieldOptions(fixtures.orgA.id, definition.id, { includeArchived: true });
    if (!Array.isArray(fullList)) throw new Error("expected array");
    expect(fullList.find((o) => o.id === created.option.id)).toBeDefined();

    // Idempotent re-archive.
    const archivedAgain = await archiveCustomFieldOption(fixtures.orgA.id, definition.id, created.option.id);
    expect(archivedAgain.ok).toBe(true);

    const unarchived = await unarchiveCustomFieldOption(fixtures.orgA.id, definition.id, created.option.id);
    expect(unarchived.ok).toBe(true);
    if (!unarchived.ok) throw new Error("expected ok");
    expect(unarchived.option.archivedAt).toBeNull();
    expect(unarchived.option.value).toBe(created.option.value);

    // Idempotent re-unarchive.
    const unarchivedAgain = await unarchiveCustomFieldOption(fixtures.orgA.id, definition.id, created.option.id);
    expect(unarchivedAgain.ok).toBe(true);
  });

  it("cross-org: options for a definition in orgA are invisible to/unmutable by orgB", async () => {
    const definition = await makeSelectDefinition(fixtures.orgA.id);
    const created = await createCustomFieldOption(fixtures.orgA.id, definition.id, { label: "Low" });
    if (!created.ok) throw new Error("expected ok");

    const orgBList = await listCustomFieldOptions(fixtures.orgB.id, definition.id);
    expect(orgBList).toEqual({ ok: false, reason: "DEFINITION_NOT_FOUND" });

    const renameAttempt = await renameCustomFieldOption(fixtures.orgB.id, definition.id, created.option.id, "Hijacked");
    expect(renameAttempt).toEqual({ ok: false, reason: "DEFINITION_NOT_FOUND" });

    const archiveAttempt = await archiveCustomFieldOption(fixtures.orgB.id, definition.id, created.option.id);
    expect(archiveAttempt).toEqual({ ok: false, reason: "DEFINITION_NOT_FOUND" });
  });

  it("an option id that doesn't belong to the given definitionId is rejected as OPTION_NOT_FOUND, even within the same organization", async () => {
    const definitionOne = await makeSelectDefinition();
    const definitionTwo = await makeSelectDefinition();
    const optionOnOne = await createCustomFieldOption(fixtures.orgA.id, definitionOne.id, { label: "Low" });
    if (!optionOnOne.ok) throw new Error("expected ok");

    const result = await renameCustomFieldOption(fixtures.orgA.id, definitionTwo.id, optionOnOne.option.id, "Hijacked");
    expect(result).toEqual({ ok: false, reason: "OPTION_NOT_FOUND" });
  });
});
