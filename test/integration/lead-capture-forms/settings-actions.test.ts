import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createLeadCaptureFormAction,
  updateLeadCaptureFormAction,
  archiveLeadCaptureFormAction,
  unarchiveLeadCaptureFormAction,
  setLeadCaptureFormActiveAction,
} from "@/app/(dashboard)/settings/lead-capture-forms/actions";
import { createLeadCaptureForm, listLeadCaptureForms, getLeadCaptureForm } from "@/lib/lead-capture-forms/forms";
import { defaultLeadCaptureFormFieldsConfig } from "@/lib/lead-capture-forms/fields";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

async function expectRedirect(promise: Promise<unknown>): Promise<RedirectSignal> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
  return caught as RedirectSignal;
}

/**
 * Public Lead Capture Forms Phase 2A (Staff UI) — the Server Action layer
 * (test items 1, 2, 3, 4, 9, 10, 12). Mirrors
 * test/integration/leads/create-rate-limit.test.ts's own
 * seedTestData/actAs pattern for exercising an authenticated Server
 * Action directly, and test/integration/lead-capture-forms/forms.test.ts's
 * own cleanup shape. Field-visibility/required/reorder logic (items 5-8)
 * is covered at the pure-logic unit level (see
 * fields-config-editor-logic.test.ts) and at the domain-validation level
 * (fields.ts's own "hidden field can't be required" tests) — this file
 * is about the Server Action boundary: auth, org-scoping, and wiring into
 * the existing Phase 1 domain functions unchanged.
 */

function fieldsConfigFormData(): string {
  return JSON.stringify(defaultLeadCaptureFormFieldsConfig());
}

async function cleanupForms(organizationIds: string[]) {
  await prisma.leadCaptureForm.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

describe("Lead Capture Forms Settings — Server Actions", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupForms([fixtures.orgA.id, fixtures.orgB.id]);
    resetAuthMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("1. an authenticated staff member's page-data-fetch shape (listLeadCaptureForms) returns only their own org's forms", async () => {
    const a = await createLeadCaptureForm(fixtures.orgA.id, { name: "Org A Form", title: "Org A" });
    const b = await createLeadCaptureForm(fixtures.orgB.id, { name: "Org B Form", title: "Org B" });
    if (!a.ok || !b.ok) throw new Error("expected ok");

    const listA = await listLeadCaptureForms(fixtures.orgA.id, { includeArchived: true });
    expect(listA.map((f) => f.id)).toEqual([a.form.id]);
    expect(listA.map((f) => f.name)).not.toContain("Org B Form");
  });

  it("2. a cross-org form is not visible via getLeadCaptureForm (what the [id] edit page itself uses)", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Org A Form", title: "Org A" });
    if (!created.ok) throw new Error("expected ok");

    const fromOtherOrg = await getLeadCaptureForm(fixtures.orgB.id, created.form.id);
    expect(fromOtherOrg).toBeNull();
  });

  it("3. an authenticated staff member can create a form via the Server Action, scoped to their own organization", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const formData = new FormData();
    formData.set("name", "Website Contact Form");
    formData.set("title", "Get in touch");
    formData.set("isActive", "on");
    formData.set("fieldsConfig", fieldsConfigFormData());

    const redirect = await expectRedirect(createLeadCaptureFormAction({ error: null }, formData));
    expect(redirect.url).toContain("/settings/lead-capture-forms");

    const created = await prisma.leadCaptureForm.findFirst({ where: { name: "Website Contact Form" } });
    expect(created).not.toBeNull();
    expect(created!.organizationId).toBe(fixtures.orgA.id);
    expect(created!.isActive).toBe(true);
  });

  it("createLeadCaptureFormAction never trusts a client-supplied organizationId — always the authenticated staff member's own", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const formData = new FormData();
    formData.set("name", "Sneaky Form");
    formData.set("title", "Get in touch");
    // Not a real field on this action's own input at all — simulates a
    // forged request trying to smuggle one in anyway.
    formData.set("organizationId", fixtures.orgB.id);
    formData.set("isActive", "on");
    formData.set("fieldsConfig", fieldsConfigFormData());

    await expectRedirect(createLeadCaptureFormAction({ error: null }, formData));

    const created = await prisma.leadCaptureForm.findFirstOrThrow({ where: { name: "Sneaky Form" } });
    expect(created.organizationId).toBe(fixtures.orgA.id);
  });

  it("createLeadCaptureFormAction creates the form inactive when the Active checkbox is unchecked", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const formData = new FormData();
    formData.set("name", "Inactive Form");
    formData.set("title", "Get in touch");
    // isActive deliberately omitted — an unchecked checkbox never appears in FormData.
    formData.set("fieldsConfig", fieldsConfigFormData());

    await expectRedirect(createLeadCaptureFormAction({ error: null }, formData));

    const created = await prisma.leadCaptureForm.findFirstOrThrow({ where: { name: "Inactive Form" } });
    expect(created.isActive).toBe(false);
  });

  it("4. an authenticated staff member can edit a form's own metadata", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Original Name", title: "Original Title" });
    if (!created.ok) throw new Error("expected ok");

    actAs(fixtures.owner, fixtures.orgA.id);
    const formData = new FormData();
    formData.set("name", "Original Name");
    formData.set("title", "Updated Title");
    formData.set("description", "New description.");
    formData.set("isActive", "on");
    formData.set("fieldsConfig", fieldsConfigFormData());

    await expectRedirect(updateLeadCaptureFormAction(created.form.id, { error: null }, formData));

    const updated = await prisma.leadCaptureForm.findUniqueOrThrow({ where: { id: created.form.id } });
    expect(updated.title).toBe("Updated Title");
    expect(updated.description).toBe("New description.");
    // publicToken never changes on a metadata update.
    expect(updated.publicToken).toBe(created.form.publicToken);
  });

  it("a staff member from a different organization cannot edit another org's form through the Server Action", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Org A Form", title: "Org A" });
    if (!created.ok) throw new Error("expected ok");

    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    const formData = new FormData();
    formData.set("name", "Hijacked");
    formData.set("title", "Hijacked");
    formData.set("isActive", "on");
    formData.set("fieldsConfig", fieldsConfigFormData());

    const result = await updateLeadCaptureFormAction(created.form.id, { error: null }, formData);

    expect(result).toEqual({ error: "Form not found." });
    const stillOriginal = await prisma.leadCaptureForm.findUniqueOrThrow({ where: { id: created.form.id } });
    expect(stillOriginal.title).toBe("Org A");
  });

  it("7. updateLeadCaptureFormAction surfaces the domain layer's hidden+required rejection as a generic error, and persists nothing", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");

    actAs(fixtures.owner, fixtures.orgA.id);
    const formData = new FormData();
    formData.set("name", "Form");
    formData.set("title", "Title");
    formData.set("isActive", "on");
    formData.set(
      "fieldsConfig",
      JSON.stringify({ ...defaultLeadCaptureFormFieldsConfig(), email: { visible: false, required: true, order: 2, label: null } }),
    );

    const result = await updateLeadCaptureFormAction(created.form.id, { error: null }, formData);

    expect(result.error).toBeTruthy();
    const stillOriginal = await prisma.leadCaptureForm.findUniqueOrThrow({ where: { id: created.form.id } });
    expect(stillOriginal.title).toBe("Title");
  });

  it("9. an authenticated staff member can activate/deactivate a form", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");
    expect(created.form.isActive).toBe(true);

    actAs(fixtures.owner, fixtures.orgA.id);
    await setLeadCaptureFormActiveAction(created.form.id, false);
    expect((await prisma.leadCaptureForm.findUniqueOrThrow({ where: { id: created.form.id } })).isActive).toBe(false);

    await setLeadCaptureFormActiveAction(created.form.id, true);
    expect((await prisma.leadCaptureForm.findUniqueOrThrow({ where: { id: created.form.id } })).isActive).toBe(true);
  });

  it("a cross-org staff member cannot activate/deactivate another org's form", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");

    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    await expect(setLeadCaptureFormActiveAction(created.form.id, false)).rejects.toThrow();

    expect((await prisma.leadCaptureForm.findUniqueOrThrow({ where: { id: created.form.id } })).isActive).toBe(true);
  });

  it("10. an authenticated staff member can archive and unarchive a form", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");

    actAs(fixtures.owner, fixtures.orgA.id);
    await archiveLeadCaptureFormAction(created.form.id);
    expect((await prisma.leadCaptureForm.findUniqueOrThrow({ where: { id: created.form.id } })).archivedAt).not.toBeNull();

    await unarchiveLeadCaptureFormAction(created.form.id);
    expect((await prisma.leadCaptureForm.findUniqueOrThrow({ where: { id: created.form.id } })).archivedAt).toBeNull();
  });

  it("a cross-org staff member cannot archive another org's form", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");

    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    await expect(archiveLeadCaptureFormAction(created.form.id)).rejects.toThrow();

    expect((await prisma.leadCaptureForm.findUniqueOrThrow({ where: { id: created.form.id } })).archivedAt).toBeNull();
  });

  it("12. the created form's own real publicToken is a random opaque value, never derived from organizationId or the row's own id", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const uniqueName = `Public Link Form ${randomUUID()}`;
    const formData = new FormData();
    formData.set("name", uniqueName);
    formData.set("title", "Get in touch");
    formData.set("isActive", "on");
    formData.set("fieldsConfig", fieldsConfigFormData());

    await expectRedirect(createLeadCaptureFormAction({ error: null }, formData));

    const created = await prisma.leadCaptureForm.findFirstOrThrow({ where: { name: uniqueName } });
    expect(created.publicToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(created.publicToken).not.toBe(created.id);
    expect(created.publicToken).not.toContain(fixtures.orgA.id);
  });
});
