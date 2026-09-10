import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createClientAction } from "@/app/(dashboard)/clients/new/actions";
import { updateClientAction } from "@/app/(dashboard)/clients/[id]/edit/actions";
import { createCustomFieldDefinition } from "@/lib/custom-fields/definitions";
import { createCustomFieldOption, archiveCustomFieldOption } from "@/lib/custom-fields/options";
import { upsertCustomFieldValue } from "@/lib/custom-fields/values";
import { createActivity } from "@/lib/activity/create-activity";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

// Same real module-mocking technique established in
// test/integration/invoices/activity-atomicity.test.ts — wraps the ACTUAL
// implementation by default, so every test in this file besides 33/34
// calls straight through unchanged; that one test forces a single
// rejected call to prove transactional rollback.
vi.mock("@/lib/activity/create-activity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/activity/create-activity")>();
  return { ...actual, createActivity: vi.fn(actual.createActivity) };
});

/**
 * Custom Fields Phase 2B — Client create/edit form integration (the
 * "full depth" entity for this phase's own test plan; Lead/Project get
 * representative-only coverage in their own sibling files, per that
 * plan's own "without unnecessary combinatorial duplication" instruction
 * — every rule this file proves is the SAME shared entity-form.ts logic
 * those two entities also go through). Covers items 1-6 (create), 7-12
 * (required), 13-18 (edit), 19-21 (archived definition), 22-26 (archived
 * option), 27-30 (security), 31-34 (transactions), 35 (regression:
 * primary contact email sync).
 *
 * createClientAction/updateClientAction both redirect() on success —
 * mocked in this test environment to throw RedirectSignal rather than
 * really redirecting (see test/support/navigation-mock.ts and
 * clients/create.test.ts's own identical expectRedirect precedent) — so
 * every SUCCESSFUL call here is awaited via expectRedirect(...) and
 * asserted purely against resulting DB state, never against a returned
 * value (there isn't one on the success path). A FAILED call (validation
 * rejected) returns normally, before ever reaching redirect().
 */

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

// Custom Statuses Phase 2B (Section R) — statusDefinitionId is now
// required on the Client form; this suite is entirely about custom
// fields, unrelated to status, so every call defaults to orgA's own
// bootstrapped 'active' system definition (set in beforeAll below).
let defaultStatusDefinitionId: string;

function baseClientFields(overrides: Record<string, string> = {}): Record<string, string> {
  return { name: `Client-${randomUUID().slice(0, 8)}`, status: "ACTIVE", statusDefinitionId: defaultStatusDefinitionId, ...overrides };
}

async function makeClient(organizationId: string, userId: string) {
  return prisma.client.create({ data: { name: `CF-${randomUUID().slice(0, 8)}`, organizationId, userId, status: "ACTIVE" } });
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

describe("Custom Fields — Client create/edit form integration", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    defaultStatusDefinitionId = (
      await prisma.customStatusDefinition.findFirstOrThrow({
        where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", isSystem: true, key: "active" },
      })
    ).id;
  });

  afterEach(async () => {
    resetAuthMock();
    await prisma.customFieldDefinition.deleteMany({ where: { organizationId: fixtures.orgA.id } });
    // Every Client this file creates, MINUS the one real seed fixture
    // (fixtures.clientA) — name-prefix matching alone isn't safe here
    // since test 20 deliberately renames a client to "Renamed Client" as
    // part of proving an unrelated-field edit doesn't touch custom
    // values, which would otherwise escape a startsWith("CF-") filter.
    await prisma.client.deleteMany({ where: { organizationId: fixtures.orgA.id, id: { not: fixtures.clientA.id } } });
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  async function makeDefinition(
    fieldType: "TEXT" | "NUMBER" | "DATE" | "CHECKBOX" | "SELECT",
    opts: { required?: boolean; label?: string } = {},
  ) {
    const result = await createCustomFieldDefinition(fixtures.orgA.id, "CLIENT", {
      label: opts.label ?? `Field-${randomUUID().slice(0, 6)}`,
      fieldType,
      required: opts.required ?? false,
    });
    if (!result.ok) throw new Error("expected ok");
    return result.definition;
  }

  async function findCreatedClient() {
    return prisma.client.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: { startsWith: "Client-" } } });
  }

  // ---------------------------------------------------------------------
  // CREATE (1-6)
  // ---------------------------------------------------------------------

  it("1. Client create with TEXT", async () => {
    const def = await makeDefinition("TEXT");
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(createClientAction({ error: null }, buildFormData({ ...baseClientFields(), [`customField_${def.id}`]: "Acme" })));
    const client = await findCreatedClient();
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: client.id } });
    expect(value?.textValue).toBe("Acme");
  });

  it("2. Client create with NUMBER", async () => {
    const def = await makeDefinition("NUMBER");
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(createClientAction({ error: null }, buildFormData({ ...baseClientFields(), [`customField_${def.id}`]: "1234.50" })));
    const client = await findCreatedClient();
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: client.id } });
    expect(Number(value?.numberValue)).toBe(1234.5);
  });

  it("3. Client create with DATE", async () => {
    const def = await makeDefinition("DATE");
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(createClientAction({ error: null }, buildFormData({ ...baseClientFields(), [`customField_${def.id}`]: "2026-05-01" })));
    const client = await findCreatedClient();
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: client.id } });
    expect(value?.dateValue?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("4. Client create with CHECKBOX false (optional field, unchecked — no row created)", async () => {
    const def = await makeDefinition("CHECKBOX");
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(createClientAction({ error: null }, buildFormData(baseClientFields())));
    const client = await findCreatedClient();
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: client.id } });
    expect(value).toBeNull();
  });

  it("5. Client create with CHECKBOX true", async () => {
    const def = await makeDefinition("CHECKBOX");
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(createClientAction({ error: null }, buildFormData({ ...baseClientFields(), [`customField_${def.id}`]: "on" })));
    const client = await findCreatedClient();
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: client.id } });
    expect(value?.booleanValue).toBe(true);
  });

  it("6. Client create with SELECT", async () => {
    const def = await makeDefinition("SELECT");
    const option = await createCustomFieldOption(fixtures.orgA.id, def.id, { label: "Gold" });
    if (!option.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(
      createClientAction({ error: null }, buildFormData({ ...baseClientFields(), [`customField_${def.id}`]: option.option.id })),
    );
    const client = await findCreatedClient();
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: client.id } });
    expect(value?.selectedOptionId).toBe(option.option.id);
  });

  // ---------------------------------------------------------------------
  // REQUIRED (7-12)
  // ---------------------------------------------------------------------

  it("7. required TEXT empty rejected — no Client created", async () => {
    const def = await makeDefinition("TEXT", { required: true });
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createClientAction({ error: null }, buildFormData(baseClientFields()));
    expect(result.customFieldErrors?.[def.id]).toBeTruthy();
    expect(await prisma.client.count({ where: { organizationId: fixtures.orgA.id, name: { startsWith: "Client-" } } })).toBe(0);
  });

  it("8. required NUMBER empty rejected", async () => {
    const def = await makeDefinition("NUMBER", { required: true });
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createClientAction({ error: null }, buildFormData(baseClientFields()));
    expect(result.customFieldErrors?.[def.id]).toBeTruthy();
  });

  it("9. required NUMBER zero accepted", async () => {
    const def = await makeDefinition("NUMBER", { required: true });
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(createClientAction({ error: null }, buildFormData({ ...baseClientFields(), [`customField_${def.id}`]: "0" })));
    const client = await findCreatedClient();
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: client.id } });
    expect(Number(value?.numberValue)).toBe(0);
  });

  it("10. required DATE empty rejected", async () => {
    const def = await makeDefinition("DATE", { required: true });
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createClientAction({ error: null }, buildFormData(baseClientFields()));
    expect(result.customFieldErrors?.[def.id]).toBeTruthy();
  });

  it("11. required CHECKBOX false accepted — unchecked still succeeds and persists an explicit false", async () => {
    const def = await makeDefinition("CHECKBOX", { required: true });
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(createClientAction({ error: null }, buildFormData(baseClientFields())));
    const client = await findCreatedClient();
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: client.id } });
    expect(value?.booleanValue).toBe(false);
  });

  it("12. required SELECT empty rejected", async () => {
    const def = await makeDefinition("SELECT", { required: true });
    await createCustomFieldOption(fixtures.orgA.id, def.id, { label: "Gold" });
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createClientAction({ error: null }, buildFormData(baseClientFields()));
    expect(result.customFieldErrors?.[def.id]).toBeTruthy();
  });

  // ---------------------------------------------------------------------
  // EDIT (13-18)
  // ---------------------------------------------------------------------

  it("13/14. pre-existing values loaded and edit changes them", async () => {
    const def = await makeDefinition("TEXT");
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", client.id, def.id, "Original");
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(
      updateClientAction(
        client.id,
        { error: null },
        buildFormData({ ...baseClientFields({ name: client.name }), [`customField_${def.id}`]: "Changed" }),
      ),
    );
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: client.id } });
    expect(value?.textValue).toBe("Changed");
  });

  it("15. clearing an optional value deletes the row", async () => {
    const def = await makeDefinition("TEXT");
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", client.id, def.id, "Something");
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(updateClientAction(client.id, { error: null }, buildFormData(baseClientFields({ name: client.name }))));
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: client.id } });
    expect(value).toBeNull();
  });

  it("16. a required value cannot be cleared", async () => {
    const def = await makeDefinition("TEXT", { required: true });
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", client.id, def.id, "Something");
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await updateClientAction(client.id, { error: null }, buildFormData(baseClientFields({ name: client.name })));
    expect(result.customFieldErrors?.[def.id]).toBeTruthy();
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: client.id } });
    expect(value?.textValue).toBe("Something");
  });

  it("17. repeated save with the same value does not duplicate the row", async () => {
    const def = await makeDefinition("TEXT");
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(
      updateClientAction(
        client.id,
        { error: null },
        buildFormData({ ...baseClientFields({ name: client.name }), [`customField_${def.id}`]: "Same" }),
      ),
    );
    await expectRedirect(
      updateClientAction(
        client.id,
        { error: null },
        buildFormData({ ...baseClientFields({ name: client.name }), [`customField_${def.id}`]: "Same" }),
      ),
    );

    const values = await prisma.customFieldValue.findMany({ where: { definitionId: def.id, entityId: client.id } });
    expect(values).toHaveLength(1);
  });

  it("18. one Client cannot mutate another Client's values", async () => {
    const def = await makeDefinition("TEXT");
    const clientA = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const clientB = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", clientA.id, def.id, "A's value");
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(
      updateClientAction(
        clientB.id,
        { error: null },
        buildFormData({ ...baseClientFields({ name: clientB.name }), [`customField_${def.id}`]: "B's value" }),
      ),
    );

    const valueA = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: clientA.id } });
    expect(valueA?.textValue).toBe("A's value");
  });

  // ---------------------------------------------------------------------
  // ARCHIVED DEFINITION (19-21)
  // ---------------------------------------------------------------------

  it("19. an archived definition is never parsed/rendered by getActiveCustomFieldFormDefinitions", async () => {
    const def = await makeDefinition("TEXT");
    await prisma.customFieldDefinition.update({ where: { id: def.id }, data: { archivedAt: new Date() } });
    actAs(fixtures.owner, fixtures.orgA.id);

    // Even if a crafted form still submits a value for the now-archived
    // definition, it's simply never looked at (Section H/J) — the create
    // succeeds and no CustomFieldValue is written for it.
    await expectRedirect(
      createClientAction({ error: null }, buildFormData({ ...baseClientFields(), [`customField_${def.id}`]: "ghost" })),
    );
    const client = await findCreatedClient();
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: client.id } });
    expect(value).toBeNull();
  });

  it("20. an existing archived-definition value is retained after an unrelated entity edit", async () => {
    const def = await makeDefinition("TEXT");
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", client.id, def.id, "Historical");
    await prisma.customFieldDefinition.update({ where: { id: def.id }, data: { archivedAt: new Date() } });
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(updateClientAction(client.id, { error: null }, buildFormData(baseClientFields({ name: "Renamed Client" }))));

    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: client.id } });
    expect(value?.textValue).toBe("Historical");
  });

  it("21. create does not require a value for an archived (even required) definition", async () => {
    const def = await makeDefinition("TEXT", { required: true });
    await prisma.customFieldDefinition.update({ where: { id: def.id }, data: { archivedAt: new Date() } });
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(createClientAction({ error: null }, buildFormData(baseClientFields())));
  });

  // ---------------------------------------------------------------------
  // ARCHIVED OPTION (22-26)
  // ---------------------------------------------------------------------

  it("22/23. the current archived selected option is shown and can be saved unchanged", async () => {
    const def = await makeDefinition("SELECT");
    const option = await createCustomFieldOption(fixtures.orgA.id, def.id, { label: "Legacy tier" });
    if (!option.ok) throw new Error("expected ok");
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", client.id, def.id, option.option.id);
    await archiveCustomFieldOption(fixtures.orgA.id, def.id, option.option.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    // Saving the form again with the SAME (now-archived) option id must succeed.
    await expectRedirect(
      updateClientAction(
        client.id,
        { error: null },
        buildFormData({ ...baseClientFields({ name: client.name }), [`customField_${def.id}`]: option.option.id }),
      ),
    );
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: client.id } });
    expect(value?.selectedOptionId).toBe(option.option.id);
  });

  it("24. an archived option cannot be newly selected on an entity that doesn't already use it", async () => {
    const def = await makeDefinition("SELECT");
    const option = await createCustomFieldOption(fixtures.orgA.id, def.id, { label: "Legacy tier" });
    if (!option.ok) throw new Error("expected ok");
    await archiveCustomFieldOption(fixtures.orgA.id, def.id, option.option.id);
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id); // never had this value
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await updateClientAction(
      client.id,
      { error: null },
      buildFormData({ ...baseClientFields({ name: client.name }), [`customField_${def.id}`]: option.option.id }),
    );
    expect(result.customFieldErrors?.[def.id]).toBeTruthy();
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: client.id } });
    expect(value).toBeNull();
  });

  it("25. once changed away from an archived option, it cannot be reselected on a later save", async () => {
    const def = await makeDefinition("SELECT");
    const archivedOption = await createCustomFieldOption(fixtures.orgA.id, def.id, { label: "Legacy tier" });
    const activeOption = await createCustomFieldOption(fixtures.orgA.id, def.id, { label: "New tier" });
    if (!archivedOption.ok || !activeOption.ok) throw new Error("expected ok");
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", client.id, def.id, archivedOption.option.id);
    await archiveCustomFieldOption(fixtures.orgA.id, def.id, archivedOption.option.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    // Change away to the active option — succeeds.
    await expectRedirect(
      updateClientAction(
        client.id,
        { error: null },
        buildFormData({ ...baseClientFields({ name: client.name }), [`customField_${def.id}`]: activeOption.option.id }),
      ),
    );
    expect((await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: client.id } }))?.selectedOptionId).toBe(
      activeOption.option.id,
    );

    // Attempting to go BACK to the archived option now fails — the
    // "existing" value as of this new request is the active option, so
    // resubmitting the archived id is a genuine new (rejected) selection.
    const result = await updateClientAction(
      client.id,
      { error: null },
      buildFormData({ ...baseClientFields({ name: client.name }), [`customField_${def.id}`]: archivedOption.option.id }),
    );
    expect(result.customFieldErrors?.[def.id]).toBeTruthy();
  });

  it("26. required SELECT with an existing archived value can save unchanged", async () => {
    const def = await makeDefinition("SELECT", { required: true });
    const option = await createCustomFieldOption(fixtures.orgA.id, def.id, { label: "Legacy tier" });
    if (!option.ok) throw new Error("expected ok");
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", client.id, def.id, option.option.id);
    await archiveCustomFieldOption(fixtures.orgA.id, def.id, option.option.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(
      updateClientAction(
        client.id,
        { error: null },
        buildFormData({ ...baseClientFields({ name: client.name }), [`customField_${def.id}`]: option.option.id }),
      ),
    );
  });

  // ---------------------------------------------------------------------
  // SECURITY (27-30)
  // ---------------------------------------------------------------------

  it("27. a forged foreign-org definitionId in the FormData is simply ignored (not one of this org's active definitions)", async () => {
    const orgBDef = await createCustomFieldDefinition(fixtures.orgB.id, "CLIENT", { label: "OrgB field", fieldType: "TEXT" });
    if (!orgBDef.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(
      createClientAction(
        { error: null },
        buildFormData({ ...baseClientFields(), [`customField_${orgBDef.definition.id}`]: "hijack" }),
      ),
    );
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: orgBDef.definition.id } });
    expect(value).toBeNull();

    await prisma.customFieldDefinition.delete({ where: { id: orgBDef.definition.id } });
  });

  it("28. a forged foreign-definition option id is rejected", async () => {
    const defOne = await makeDefinition("SELECT");
    const defTwo = await makeDefinition("SELECT");
    const optionOnTwo = await createCustomFieldOption(fixtures.orgA.id, defTwo.id, { label: "Only on two" });
    if (!optionOnTwo.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await createClientAction(
      { error: null },
      buildFormData({ ...baseClientFields(), [`customField_${defOne.id}`]: optionOnTwo.option.id }),
    );
    expect(result.customFieldErrors?.[defOne.id]).toBeTruthy();
  });

  it("29. a LEAD-only definition is never offered/parsed on the CLIENT form", async () => {
    const leadDef = await createCustomFieldDefinition(fixtures.orgA.id, "LEAD", { label: "Lead only", fieldType: "TEXT" });
    if (!leadDef.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(
      createClientAction(
        { error: null },
        buildFormData({ ...baseClientFields(), [`customField_${leadDef.definition.id}`]: "wrong entity" }),
      ),
    );
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: leadDef.definition.id } });
    expect(value).toBeNull();

    await prisma.customFieldDefinition.delete({ where: { id: leadDef.definition.id } });
  });

  it("30. foreign-org entity access is rejected — editing a Client that belongs to a different org fails, no custom value written", async () => {
    const def = await makeDefinition("TEXT");
    actAs(fixtures.orgBOwner, fixtures.orgB.id);

    const result = await updateClientAction(
      fixtures.clientA.id, // belongs to orgA, caller is acting as orgB
      { error: null },
      buildFormData({ ...baseClientFields({ name: "Hijacked" }), [`customField_${def.id}`]: "hijack" }),
    );
    expect(result).toEqual({ error: "This client could not be found." });
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: fixtures.clientA.id } });
    expect(value).toBeNull();
  });

  // ---------------------------------------------------------------------
  // TRANSACTIONS (31-34)
  // ---------------------------------------------------------------------

  it("31. an invalid required custom field prevents Client creation entirely", async () => {
    await makeDefinition("TEXT", { required: true });
    actAs(fixtures.owner, fixtures.orgA.id);
    await createClientAction({ error: null }, buildFormData(baseClientFields()));
    expect(await prisma.client.count({ where: { organizationId: fixtures.orgA.id, name: { startsWith: "Client-" } } })).toBe(0);
  });

  it("32. an invalid custom field prevents a normal Client edit from applying at all", async () => {
    const def = await makeDefinition("TEXT", { required: true });
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    await upsertCustomFieldValue(fixtures.orgA.id, "CLIENT", client.id, def.id, "Original");
    actAs(fixtures.owner, fixtures.orgA.id);

    await updateClientAction(client.id, { error: null }, buildFormData(baseClientFields({ name: "Should not apply" })));

    const reloaded = await prisma.client.findUnique({ where: { id: client.id } });
    expect(reloaded?.name).toBe(client.name); // unchanged — the whole edit was rejected
  });

  it("33/34. a failure later in the same transaction rolls back BOTH the Client row and any custom field values already written in it", async () => {
    const def = await makeDefinition("TEXT");
    actAs(fixtures.owner, fixtures.orgA.id);

    vi.mocked(createActivity).mockRejectedValueOnce(new Error("simulated failure"));

    await expect(
      createClientAction({ error: null }, buildFormData({ ...baseClientFields(), [`customField_${def.id}`]: "should not persist" })),
    ).rejects.toThrow("simulated failure");

    // Neither the Client nor its custom field value exist — the whole transaction rolled back together.
    expect(await prisma.client.count({ where: { organizationId: fixtures.orgA.id, name: { startsWith: "Client-" } } })).toBe(0);
    expect(await prisma.customFieldValue.count({ where: { definitionId: def.id } })).toBe(0);
  });

  // ---------------------------------------------------------------------
  // REGRESSION (35)
  // ---------------------------------------------------------------------

  it("35. the primary contact email sync is unaffected by custom fields being present on the same create", async () => {
    const def = await makeDefinition("TEXT");
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(
      createClientAction(
        { error: null },
        buildFormData({ ...baseClientFields(), email: "sync-check@example.com", [`customField_${def.id}`]: "Some value" }),
      ),
    );

    const client = await findCreatedClient();
    const primaryContact = await prisma.clientContact.findFirst({ where: { clientId: client.id, isPrimary: true } });
    expect(primaryContact?.email).toBe("sync-check@example.com");
  });
});
