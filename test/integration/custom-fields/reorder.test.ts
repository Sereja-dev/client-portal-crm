import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCustomFieldDefinition, moveCustomFieldDefinition } from "@/lib/custom-fields/definitions";
import { createCustomFieldOption, moveCustomFieldOption } from "@/lib/custom-fields/options";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { resetAuthMock } from "../../support/auth-mock";

/**
 * Custom Fields Phase 2A — coverage for the reorder domain functions
 * added alongside the Definitions UI (moveCustomFieldDefinition/
 * moveCustomFieldOption in definitions.ts/options.ts; test items 20, 28
 * of that phase's own test plan). Phase 1 deliberately shipped no
 * reorder function at all (foundation only, no UI to drive it) — this
 * is the first real coverage of position-swapping behavior.
 */

async function cleanupDefinitions(organizationId: string) {
  await prisma.customFieldDefinition.deleteMany({ where: { organizationId } });
}

describe("Custom Fields — reorder (moveCustomFieldDefinition / moveCustomFieldOption)", () => {
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

  async function makeThreeDefinitions(organizationId = fixtures.orgA.id) {
    const first = await createCustomFieldDefinition(organizationId, "CLIENT", { label: "First", fieldType: "TEXT" });
    const second = await createCustomFieldDefinition(organizationId, "CLIENT", { label: "Second", fieldType: "TEXT" });
    const third = await createCustomFieldDefinition(organizationId, "CLIENT", { label: "Third", fieldType: "TEXT" });
    if (!first.ok || !second.ok || !third.ok) throw new Error("expected ok");
    return [first.definition, second.definition, third.definition];
  }

  it("20a. moving the middle definition up swaps it with the first, both positions exchanged exactly", async () => {
    const [, second, third] = await makeThreeDefinitions();

    const result = await moveCustomFieldDefinition(fixtures.orgA.id, "CLIENT", second.id, "up");
    expect(result).toEqual({ ok: true });

    const reloaded = await prisma.customFieldDefinition.findMany({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT" },
      orderBy: { position: "asc" },
    });
    expect(reloaded.map((d) => d.label)).toEqual(["Second", "First", "Third"]);
    // Exactly the two positions swapped — nothing else moved.
    expect(reloaded.find((d) => d.id === third.id)?.position).toBe(third.position);
  });

  it("20b. moving the first definition up is a no-op (CANNOT_MOVE) — nothing changes", async () => {
    const [first] = await makeThreeDefinitions();

    const result = await moveCustomFieldDefinition(fixtures.orgA.id, "CLIENT", first.id, "up");
    expect(result).toEqual({ ok: false, reason: "CANNOT_MOVE" });

    const reloaded = await prisma.customFieldDefinition.findMany({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT" },
      orderBy: { position: "asc" },
    });
    expect(reloaded.map((d) => d.label)).toEqual(["First", "Second", "Third"]);
  });

  it("20c. moving the last definition down is a no-op (CANNOT_MOVE)", async () => {
    const [, , third] = await makeThreeDefinitions();

    const result = await moveCustomFieldDefinition(fixtures.orgA.id, "CLIENT", third.id, "down");
    expect(result).toEqual({ ok: false, reason: "CANNOT_MOVE" });
  });

  it("20d. moving down then up returns to the original order — deterministic round-trip, no drift", async () => {
    const [first, second, third] = await makeThreeDefinitions();

    await moveCustomFieldDefinition(fixtures.orgA.id, "CLIENT", first.id, "down");
    await moveCustomFieldDefinition(fixtures.orgA.id, "CLIENT", first.id, "up");

    const reloaded = await prisma.customFieldDefinition.findMany({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT" },
      orderBy: { position: "asc" },
    });
    expect(reloaded.map((d) => d.label)).toEqual(["First", "Second", "Third"]);
    expect(reloaded.map((d) => d.id)).toEqual([first.id, second.id, third.id]);
  });

  it("20e. archived definitions are excluded from the adjacency chain — moving up skips an archived neighbor entirely", async () => {
    const [, second, third] = await makeThreeDefinitions();
    await prisma.customFieldDefinition.update({ where: { id: second.id }, data: { archivedAt: new Date() } });

    // Moving "Third" up must swap with "First" (the nearest ACTIVE
    // definition), never with the archived "Second" in between.
    const result = await moveCustomFieldDefinition(fixtures.orgA.id, "CLIENT", third.id, "up");
    expect(result).toEqual({ ok: true });

    const reloaded = await prisma.customFieldDefinition.findMany({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT" },
      orderBy: { position: "asc" },
    });
    const activeLabelsByPosition = reloaded.filter((d) => d.archivedAt === null).map((d) => d.label);
    expect(activeLabelsByPosition).toEqual(["Third", "First"]);
  });

  it("cross-org: moving a definition that belongs to a different organization is rejected as DEFINITION_NOT_FOUND", async () => {
    const [first] = await makeThreeDefinitions(fixtures.orgA.id);

    const result = await moveCustomFieldDefinition(fixtures.orgB.id, "CLIENT", first.id, "up");
    expect(result).toEqual({ ok: false, reason: "DEFINITION_NOT_FOUND" });
  });

  async function makeThreeOptions(definitionId: string) {
    const first = await createCustomFieldOption(fixtures.orgA.id, definitionId, { label: "First" });
    const second = await createCustomFieldOption(fixtures.orgA.id, definitionId, { label: "Second" });
    const third = await createCustomFieldOption(fixtures.orgA.id, definitionId, { label: "Third" });
    if (!first.ok || !second.ok || !third.ok) throw new Error("expected ok");
    return [first.option, second.option, third.option];
  }

  it("28a. moving an option down swaps it with its active neighbor", async () => {
    const def = await createCustomFieldDefinition(fixtures.orgA.id, "LEAD", { label: "Priority", fieldType: "SELECT" });
    if (!def.ok) throw new Error("expected ok");
    const [first] = await makeThreeOptions(def.definition.id);

    const result = await moveCustomFieldOption(fixtures.orgA.id, def.definition.id, first.id, "down");
    expect(result).toEqual({ ok: true });

    const reloaded = await prisma.customFieldOption.findMany({
      where: { definitionId: def.definition.id },
      orderBy: { position: "asc" },
    });
    expect(reloaded.map((o) => o.label)).toEqual(["Second", "First", "Third"]);
  });

  it("28b. moving the first option up and the last option down are both no-ops (CANNOT_MOVE)", async () => {
    const def = await createCustomFieldDefinition(fixtures.orgA.id, "LEAD", { label: "Priority", fieldType: "SELECT" });
    if (!def.ok) throw new Error("expected ok");
    const [first, , third] = await makeThreeOptions(def.definition.id);

    expect(await moveCustomFieldOption(fixtures.orgA.id, def.definition.id, first.id, "up")).toEqual({
      ok: false,
      reason: "CANNOT_MOVE",
    });
    expect(await moveCustomFieldOption(fixtures.orgA.id, def.definition.id, third.id, "down")).toEqual({
      ok: false,
      reason: "CANNOT_MOVE",
    });
  });

  it("cross-org: moving an option on a definition belonging to a different organization is rejected as DEFINITION_NOT_FOUND", async () => {
    const def = await createCustomFieldDefinition(fixtures.orgA.id, "LEAD", { label: "Priority", fieldType: "SELECT" });
    if (!def.ok) throw new Error("expected ok");
    const [first] = await makeThreeOptions(def.definition.id);

    const result = await moveCustomFieldOption(fixtures.orgB.id, def.definition.id, first.id, "down");
    expect(result).toEqual({ ok: false, reason: "DEFINITION_NOT_FOUND" });
  });

  it("an option id that doesn't belong to the given definitionId is rejected as OPTION_NOT_FOUND", async () => {
    const defOne = await createCustomFieldDefinition(fixtures.orgA.id, "LEAD", { label: "Priority", fieldType: "SELECT" });
    const defTwo = await createCustomFieldDefinition(fixtures.orgA.id, "LEAD", { label: "Status", fieldType: "SELECT" });
    if (!defOne.ok || !defTwo.ok) throw new Error("expected ok");
    const [optionOnOne] = await makeThreeOptions(defOne.definition.id);

    const result = await moveCustomFieldOption(fixtures.orgA.id, defTwo.definition.id, optionOnOne.id, "down");
    expect(result).toEqual({ ok: false, reason: "OPTION_NOT_FOUND" });
  });
});
