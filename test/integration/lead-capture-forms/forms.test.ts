import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listLeadCaptureForms,
  getLeadCaptureForm,
  createLeadCaptureForm,
  updateLeadCaptureForm,
  setLeadCaptureFormActive,
  archiveLeadCaptureForm,
  unarchiveLeadCaptureForm,
} from "@/lib/lead-capture-forms/forms";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Public Lead Capture Forms, Phase 1 — staff management domain layer
 * (scenarios 1-2 of this phase's own 18-item test list). Mirrors
 * test/integration/custom-statuses/definitions.test.ts's own exact
 * seedTestData/cleanup pattern — no bootstrap needed here at all, since
 * none of these functions touch CustomStatusDefinition.
 */

async function cleanupForms(organizationIds: string[]) {
  await prisma.leadCaptureForm.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

describe("Lead Capture Forms — staff management domain layer", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupForms([fixtures.orgA.id, fixtures.orgB.id]);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("1. createLeadCaptureForm creates a form scoped to the caller's own organization, with a random opaque publicToken", async () => {
    const result = await createLeadCaptureForm(fixtures.orgA.id, {
      name: "Website Contact Form",
      title: "Get in touch",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.form.organizationId).toBe(fixtures.orgA.id);
    expect(result.form.isActive).toBe(true);
    expect(result.form.archivedAt).toBeNull();
    // A UUID, not derived from organizationId and not this row's own id.
    expect(result.form.publicToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(result.form.publicToken).not.toBe(result.form.id);
    expect(result.form.publicToken).not.toContain(fixtures.orgA.id);
  });

  it("createLeadCaptureForm rejects a blank name/title", async () => {
    const result = await createLeadCaptureForm(fixtures.orgA.id, { name: "  ", title: "Get in touch" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("VALIDATION");
  });

  it("listLeadCaptureForms only returns the caller's own organization's forms", async () => {
    const a = await createLeadCaptureForm(fixtures.orgA.id, { name: "Org A Form", title: "Org A" });
    const b = await createLeadCaptureForm(fixtures.orgB.id, { name: "Org B Form", title: "Org B" });
    if (!a.ok || !b.ok) throw new Error("expected ok");

    const listA = await listLeadCaptureForms(fixtures.orgA.id);
    expect(listA.map((f) => f.id)).toEqual([a.form.id]);

    const listB = await listLeadCaptureForms(fixtures.orgB.id);
    expect(listB.map((f) => f.id)).toEqual([b.form.id]);
  });

  it("2. cross-org staff cannot read another org's form — getLeadCaptureForm returns null, indistinguishable from a nonexistent id", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Org A Form", title: "Org A" });
    if (!created.ok) throw new Error("expected ok");

    const fromOwnOrg = await getLeadCaptureForm(fixtures.orgA.id, created.form.id);
    expect(fromOwnOrg?.id).toBe(created.form.id);

    const fromOtherOrg = await getLeadCaptureForm(fixtures.orgB.id, created.form.id);
    expect(fromOtherOrg).toBeNull();

    const genuinelyMissing = await getLeadCaptureForm(fixtures.orgA.id, "00000000-0000-0000-0000-000000000000");
    expect(genuinelyMissing).toBeNull();
  });

  it("2b. cross-org staff cannot update another org's form", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Org A Form", title: "Org A" });
    if (!created.ok) throw new Error("expected ok");

    const result = await updateLeadCaptureForm(fixtures.orgB.id, created.form.id, { title: "Hijacked" });
    expect(result).toEqual({ ok: false, reason: "FORM_NOT_FOUND" });

    const stillOriginal = await getLeadCaptureForm(fixtures.orgA.id, created.form.id);
    expect(stillOriginal?.title).toBe("Org A");
  });

  it("2c. cross-org staff cannot activate/deactivate or archive another org's form", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Org A Form", title: "Org A" });
    if (!created.ok) throw new Error("expected ok");

    expect(await setLeadCaptureFormActive(fixtures.orgB.id, created.form.id, false)).toEqual({ ok: false, reason: "FORM_NOT_FOUND" });
    expect(await archiveLeadCaptureForm(fixtures.orgB.id, created.form.id)).toEqual({ ok: false, reason: "FORM_NOT_FOUND" });

    const stillActive = await getLeadCaptureForm(fixtures.orgA.id, created.form.id);
    expect(stillActive?.isActive).toBe(true);
    expect(stillActive?.archivedAt).toBeNull();
  });

  it("updateLeadCaptureForm updates metadata within the caller's own organization", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Website Contact Form", title: "Get in touch" });
    if (!created.ok) throw new Error("expected ok");

    const updated = await updateLeadCaptureForm(fixtures.orgA.id, created.form.id, {
      title: "Contact us",
      description: "We reply within one business day.",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error("expected ok");
    expect(updated.form.title).toBe("Contact us");
    expect(updated.form.description).toBe("We reply within one business day.");
    // publicToken never changes on a metadata update.
    expect(updated.form.publicToken).toBe(created.form.publicToken);
  });

  it("setLeadCaptureFormActive toggles isActive, idempotently", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");

    const deactivated = await setLeadCaptureFormActive(fixtures.orgA.id, created.form.id, false);
    expect(deactivated.ok).toBe(true);
    if (!deactivated.ok) throw new Error("expected ok");
    expect(deactivated.form.isActive).toBe(false);

    // Idempotent re-call.
    const stillDeactivated = await setLeadCaptureFormActive(fixtures.orgA.id, created.form.id, false);
    expect(stillDeactivated.ok).toBe(true);
    if (!stillDeactivated.ok) throw new Error("expected ok");
    expect(stillDeactivated.form.isActive).toBe(false);

    const reactivated = await setLeadCaptureFormActive(fixtures.orgA.id, created.form.id, true);
    expect(reactivated.ok).toBe(true);
    if (!reactivated.ok) throw new Error("expected ok");
    expect(reactivated.form.isActive).toBe(true);
  });

  it("archiveLeadCaptureForm/unarchiveLeadCaptureForm round-trip, idempotently", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");

    const archived = await archiveLeadCaptureForm(fixtures.orgA.id, created.form.id);
    expect(archived.ok).toBe(true);
    if (!archived.ok) throw new Error("expected ok");
    expect(archived.form.archivedAt).not.toBeNull();

    const stillArchived = await archiveLeadCaptureForm(fixtures.orgA.id, created.form.id);
    expect(stillArchived.ok).toBe(true);
    if (!stillArchived.ok) throw new Error("expected ok");
    expect(stillArchived.form.archivedAt?.getTime()).toBe(archived.form.archivedAt?.getTime());

    const unarchived = await unarchiveLeadCaptureForm(fixtures.orgA.id, created.form.id);
    expect(unarchived.ok).toBe(true);
    if (!unarchived.ok) throw new Error("expected ok");
    expect(unarchived.form.archivedAt).toBeNull();
    expect(unarchived.form.publicToken).toBe(created.form.publicToken);
  });

  it("listLeadCaptureForms excludes archived forms by default, includes them with includeArchived", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");
    await archiveLeadCaptureForm(fixtures.orgA.id, created.form.id);

    const activeOnly = await listLeadCaptureForms(fixtures.orgA.id);
    expect(activeOnly).toEqual([]);

    const withArchived = await listLeadCaptureForms(fixtures.orgA.id, { includeArchived: true });
    expect(withArchived.map((f) => f.id)).toEqual([created.form.id]);
  });

  it("createLeadCaptureForm defaults fieldsConfig to the standard V1 field set when none is supplied", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");
    const config = created.form.fieldsConfig as Record<string, { visible: boolean; required: boolean }>;
    expect(config.name).toEqual({ visible: true, required: true, order: 0, label: null });
    expect(config.company.visible).toBe(true);
    expect(config.company.required).toBe(false);
  });

  it("createLeadCaptureForm rejects an invalid fieldsConfig (unknown field key)", async () => {
    const result = await createLeadCaptureForm(fixtures.orgA.id, {
      name: "Form",
      title: "Title",
      fieldsConfig: { budget: { visible: true } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("INVALID_FIELDS_CONFIG");
  });
});
