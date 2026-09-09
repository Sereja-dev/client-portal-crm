import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createLeadAction, updateLeadAction, convertLeadToClientAction } from "@/app/(dashboard)/leads/actions";
import { createCustomFieldDefinition } from "@/lib/custom-fields/definitions";
import { createCustomFieldOption } from "@/lib/custom-fields/options";
import { upsertCustomFieldValue } from "@/lib/custom-fields/values";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Custom Fields Phase 2B — Lead create/edit form integration.
 * Representative coverage only (Section X: "without unnecessary
 * combinatorial duplication") — the full TEXT/NUMBER/DATE/CHECKBOX/
 * SELECT/required/archived/security matrix is already exhaustively
 * proven against Client in custom-fields-form.test.ts, exercising the
 * exact same shared entity-form.ts logic. This file only adds what's
 * genuinely Lead-specific: createLeadAction/updateLeadAction's own
 * `customFieldFormData` plumbing, and — critically — Section P/item 36:
 * Lead -> Client conversion must NEVER copy LEAD custom field values
 * onto the new Client, even when a key would coincidentally match.
 *
 * createLeadAction/updateLeadAction/convertLeadToClientAction never call
 * redirect() themselves (only their own FormData adapters do — see
 * leads/new/actions.ts's createLeadFormAction) — called directly here,
 * their return values are asserted normally, no RedirectSignal handling
 * needed.
 */

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("Custom Fields — Lead create/edit form integration", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    resetAuthMock();
    await prisma.customFieldDefinition.deleteMany({ where: { organizationId: fixtures.orgA.id } });
    await prisma.lead.deleteMany({ where: { organizationId: fixtures.orgA.id } });
    await prisma.client.deleteMany({ where: { organizationId: fixtures.orgA.id, id: { not: fixtures.clientA.id } } });
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  async function makeDefinition(
    entityType: "LEAD" | "CLIENT",
    fieldType: "TEXT" | "NUMBER" | "DATE" | "CHECKBOX" | "SELECT",
    opts: { required?: boolean; key?: string } = {},
  ) {
    const result = await createCustomFieldDefinition(fixtures.orgA.id, entityType, {
      label: opts.key ?? `Field-${randomUUID().slice(0, 6)}`,
      fieldType,
      required: opts.required ?? false,
      key: opts.key,
    });
    if (!result.ok) throw new Error("expected ok");
    return result.definition;
  }

  it("create Lead with a TEXT custom field", async () => {
    const def = await makeDefinition("LEAD", "TEXT");
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createLeadAction({ name: "New Lead" }, buildFormData({ [`customField_${def.id}`]: "Hello" }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: result.leadId } });
    expect(value?.textValue).toBe("Hello");
  });

  it("create Lead with a SELECT custom field", async () => {
    const def = await makeDefinition("LEAD", "SELECT");
    const option = await createCustomFieldOption(fixtures.orgA.id, def.id, { label: "Hot" });
    if (!option.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createLeadAction({ name: "New Lead" }, buildFormData({ [`customField_${def.id}`]: option.option.id }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const value = await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: result.leadId } });
    expect(value?.selectedOptionId).toBe(option.option.id);
  });

  it("required TEXT empty is rejected — no Lead created", async () => {
    const def = await makeDefinition("LEAD", "TEXT", { required: true });
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createLeadAction({ name: "New Lead" }, new FormData());
    expect(result).toEqual({ ok: false, reason: "custom_field_validation", customFieldErrors: { [def.id]: "This field is required." } });
    expect(await prisma.lead.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("edit: pre-existing value loaded, changed, and clearing an optional value deletes the row", async () => {
    const def = await makeDefinition("LEAD", "TEXT");
    const lead = await prisma.lead.create({ data: { organizationId: fixtures.orgA.id, name: "Edit Lead" } });
    await upsertCustomFieldValue(fixtures.orgA.id, "LEAD", lead.id, def.id, "Original");
    actAs(fixtures.owner, fixtures.orgA.id);

    const changed = await updateLeadAction(lead.id, { name: "Edit Lead" }, buildFormData({ [`customField_${def.id}`]: "Changed" }));
    expect(changed.ok).toBe(true);
    expect((await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: lead.id } }))?.textValue).toBe("Changed");

    const cleared = await updateLeadAction(lead.id, { name: "Edit Lead" }, new FormData());
    expect(cleared.ok).toBe(true);
    expect(await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: lead.id } })).toBeNull();
  });

  it("foreign-org Lead access is rejected, no custom value written", async () => {
    const def = await makeDefinition("LEAD", "TEXT");
    const lead = await prisma.lead.create({ data: { organizationId: fixtures.orgA.id, name: "Org A Lead" } });
    actAs(fixtures.orgBOwner, fixtures.orgB.id);

    const result = await updateLeadAction(lead.id, { name: "Hijacked" }, buildFormData({ [`customField_${def.id}`]: "hijack" }));
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(await prisma.customFieldValue.findFirst({ where: { definitionId: def.id, entityId: lead.id } })).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Section P / item 36 — the critical Lead-specific regression.
  // ---------------------------------------------------------------------

  it("36. Lead -> Client conversion does NOT copy LEAD custom field values to the new Client, even when a key would coincide", async () => {
    // Deliberately the SAME key on both entity types — conversion must
    // still never treat this as "the same field."
    const leadDef = await makeDefinition("LEAD", "TEXT", { key: "priority_note" });
    const clientDef = await makeDefinition("CLIENT", "TEXT", { key: "priority_note" });

    const lead = await prisma.lead.create({ data: { organizationId: fixtures.orgA.id, name: "Convert Me", email: `convert-${randomUUID().slice(0, 8)}@example.com` } });
    await upsertCustomFieldValue(fixtures.orgA.id, "LEAD", lead.id, leadDef.id, "Lead-only note");

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await convertLeadToClientAction(lead.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    // The Lead's own value is untouched...
    const leadValue = await prisma.customFieldValue.findFirst({ where: { definitionId: leadDef.id, entityId: lead.id } });
    expect(leadValue?.textValue).toBe("Lead-only note");

    // ...and the new Client has NO value at all for the CLIENT definition
    // that happens to share the same key — nothing was copied across.
    const clientValue = await prisma.customFieldValue.findFirst({ where: { definitionId: clientDef.id, entityId: result.clientId } });
    expect(clientValue).toBeNull();

    // Sanity: the new Client also has no CustomFieldValue rows at all.
    const anyClientValues = await prisma.customFieldValue.count({ where: { entityId: result.clientId } });
    expect(anyClientValues).toBe(0);
  });
});
