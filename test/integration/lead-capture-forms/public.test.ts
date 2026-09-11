import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getPublicLeadCaptureForm, submitPublicLeadCaptureForm } from "@/lib/lead-capture-forms/public";
import { createLeadCaptureForm, archiveLeadCaptureForm, setLeadCaptureFormActive } from "@/lib/lead-capture-forms/forms";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Public Lead Capture Forms, Phase 1 — the public, unauthenticated read +
 * submission domain functions (scenarios 3-14 and 16-18 of this phase's
 * own 18-item test list; scenario 15, rate limiting, lives in
 * submit-rate-limit.test.ts, mirroring leads/create-rate-limit.test.ts's
 * own file split). Bootstraps the full real LEAD system status set for
 * both orgs — a real, resolvable statusDefinitionId is exactly what
 * scenario 8 itself verifies — same established pattern as every other
 * Custom Statuses Phase 2B fixture (see e.g. leads-pipeline.spec.ts's own
 * bootstrapLeadStatuses helper).
 */

async function cleanupOrgData(organizationIds: string[]) {
  // Lead references CustomStatusDefinition (onDelete: Restrict) — must be
  // deleted before the definitions themselves.
  await prisma.lead.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.leadCaptureForm.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

describe("Lead Capture Forms — public read + submission", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgB.id);
  });

  afterEach(async () => {
    await cleanupOrgData([fixtures.orgA.id, fixtures.orgB.id]);
  });

  afterAll(async () => {
    await prisma.customStatusDefinition.deleteMany({ where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    await cleanupTestData(fixtures);
  });

  it("3. public read works for an active form, returning only the safe render schema", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, {
      name: "Internal form name — never public",
      title: "Get in touch",
      description: "We reply within one business day.",
      successMessage: "Thanks, we'll be in touch!",
    });
    if (!created.ok) throw new Error("expected ok");

    const schema = await getPublicLeadCaptureForm(created.form.publicToken);
    expect(schema).toEqual({
      title: "Get in touch",
      description: "We reply within one business day.",
      successMessage: "Thanks, we'll be in touch!",
      fields: [
        { key: "name", label: "Name", required: true },
        { key: "company", label: "Company", required: false },
        { key: "email", label: "Email", required: false },
        { key: "phone", label: "Phone", required: false },
        { key: "message", label: "Message", required: false },
      ],
    });
  });

  it("17a. public read never exposes organizationId, the row's own id, isActive, archivedAt, or the internal name", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Secret Internal Label", title: "Get in touch" });
    if (!created.ok) throw new Error("expected ok");

    const schema = await getPublicLeadCaptureForm(created.form.publicToken);
    const serialized = JSON.stringify(schema);
    expect(serialized).not.toContain(fixtures.orgA.id);
    expect(serialized).not.toContain(created.form.id);
    expect(serialized).not.toContain("Secret Internal Label");
    expect(schema).not.toHaveProperty("organizationId");
    expect(schema).not.toHaveProperty("isActive");
    expect(schema).not.toHaveProperty("archivedAt");
  });

  it("4. public read rejects an inactive form — same generic null as a nonexistent token", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");
    await setLeadCaptureFormActive(fixtures.orgA.id, created.form.id, false);

    expect(await getPublicLeadCaptureForm(created.form.publicToken)).toBeNull();
  });

  it("18. public read rejects an archived form — same generic null", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");
    await archiveLeadCaptureForm(fixtures.orgA.id, created.form.id);

    expect(await getPublicLeadCaptureForm(created.form.publicToken)).toBeNull();
  });

  it("public read returns null for a token that never existed at all — indistinguishable from inactive/archived", async () => {
    expect(await getPublicLeadCaptureForm("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("5/6/7/8/9. a valid public submission creates exactly one Lead, in the right org, source WEBSITE, authoritative system NEW status, legacy stage NEW", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");

    const before = await prisma.lead.count({ where: { organizationId: fixtures.orgA.id } });

    const result = await submitPublicLeadCaptureForm(created.form.publicToken, {
      name: "Jane Prospect",
      company: "Acme Co",
      email: "jane@acme.test",
      phone: "555-0100",
      message: "Interested in your services.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok || "discarded" in result) throw new Error("expected a real success");

    const after = await prisma.lead.count({ where: { organizationId: fixtures.orgA.id } });
    expect(after).toBe(before + 1);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: result.leadId } });
    expect(lead.organizationId).toBe(fixtures.orgA.id);
    expect(lead.source).toBe("WEBSITE");
    expect(lead.stage).toBe("NEW");
    expect(lead.name).toBe("Jane Prospect");
    expect(lead.company).toBe("Acme Co");
    expect(lead.email).toBe("jane@acme.test");
    expect(lead.phone).toBe("555-0100");
    expect(lead.notes).toBe("Interested in your services.");

    const statusDefinition = await prisma.customStatusDefinition.findFirst({
      where: { organizationId: fixtures.orgA.id, entityType: "LEAD", key: "new", isSystem: true },
    });
    expect(lead.statusDefinitionId).toBe(statusDefinition!.id);

    const activity = await prisma.activity.findFirst({ where: { entityType: "LEAD", entityId: lead.id, action: "CREATED" } });
    expect(activity).not.toBeNull();
    expect(activity!.actorId).toBeNull();
  });

  it("10/11. the public payload cannot override organizationId, statusDefinitionId, stage, source, assignedTo, or convertedClientId even if a caller tries", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");

    const maliciousPayload = {
      name: "Attacker",
      // None of these keys exist on PublicLeadCaptureSubmissionInput's own
      // type — `as any` simulates a raw untyped request body (e.g. a
      // forged FormData/JSON payload) that includes them anyway.
      organizationId: fixtures.orgB.id,
      statusDefinitionId: "00000000-0000-0000-0000-000000000000",
      stage: "WON",
      source: "REFERRAL",
      assignedToUserId: fixtures.owner.id,
      convertedClientId: fixtures.clientA.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await submitPublicLeadCaptureForm(created.form.publicToken, maliciousPayload);
    expect(result.ok).toBe(true);
    if (!result.ok || "discarded" in result) throw new Error("expected a real success");

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: result.leadId } });
    expect(lead.organizationId).toBe(fixtures.orgA.id);
    expect(lead.stage).toBe("NEW");
    expect(lead.source).toBe("WEBSITE");
    expect(lead.assignedToUserId).toBeNull();
    expect(lead.convertedClientId).toBeNull();
  });

  it("12. required-field enforcement: a field marked required and visible blocks submission when blank", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, {
      name: "Form",
      title: "Title",
      fieldsConfig: { email: { visible: true, required: true, order: 2, label: null } },
    });
    if (!created.ok) throw new Error("expected ok");

    const result = await submitPublicLeadCaptureForm(created.form.publicToken, { name: "Jane" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    if (result.reason !== "VALIDATION") throw new Error("expected VALIDATION");
    expect(result.fieldErrors.email).toBeTruthy();

    expect(await prisma.lead.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("required-field enforcement never applies to a hidden field, regardless of its stored `required` flag", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, {
      name: "Form",
      title: "Title",
      fieldsConfig: { phone: { visible: false, required: true, order: 3, label: null } },
    });
    if (!created.ok) throw new Error("expected ok");

    const result = await submitPublicLeadCaptureForm(created.form.publicToken, { name: "Jane" });
    expect(result.ok).toBe(true);
  });

  it("name is always required, even if a form's own stored config somehow marked it optional/hidden", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");
    // Bypasses the staff-facing validator entirely (which would already
    // reject this) to prove the public submission path itself still
    // enforces it, not just the staff config layer.
    await prisma.leadCaptureForm.update({
      where: { id: created.form.id },
      data: { fieldsConfig: { name: { visible: false, required: false, order: 0, label: null } } },
    });

    const result = await submitPublicLeadCaptureForm(created.form.publicToken, { name: "" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    if (result.reason !== "VALIDATION") throw new Error("expected VALIDATION");
    expect(result.fieldErrors.name).toBeTruthy();
  });

  it("13. an invalid email is rejected when supplied", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");

    const result = await submitPublicLeadCaptureForm(created.form.publicToken, { name: "Jane", email: "not-an-email" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    if (result.reason !== "VALIDATION") throw new Error("expected VALIDATION");
    expect(result.fieldErrors.email).toBe("Enter a valid email address.");
    expect(await prisma.lead.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("14. a populated honeypot silently discards the submission — no Lead created, response indistinguishable from a real success", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");

    const result = await submitPublicLeadCaptureForm(created.form.publicToken, {
      name: "Bot",
      email: "bot@example.com",
      honeypot: "http://spam.example.com",
    });

    expect(result).toEqual({ ok: true, discarded: true });
    expect(await prisma.lead.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("an empty/whitespace-only honeypot never triggers a discard — a real submission still succeeds", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");

    const result = await submitPublicLeadCaptureForm(created.form.publicToken, { name: "Jane", honeypot: "   " });
    expect(result.ok).toBe(true);
    if (!result.ok || "discarded" in result) throw new Error("expected a real success, not a discard");
  });

  it("16. a form from Org A can only ever create a Lead in Org A, never Org B", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");

    const result = await submitPublicLeadCaptureForm(created.form.publicToken, { name: "Jane" });
    expect(result.ok).toBe(true);
    if (!result.ok || "discarded" in result) throw new Error("expected a real success");

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: result.leadId } });
    expect(lead.organizationId).toBe(fixtures.orgA.id);
    expect(await prisma.lead.count({ where: { organizationId: fixtures.orgB.id } })).toBe(0);
  });

  it("18b. an inactive/archived form's own submission endpoint rejects with NOT_FOUND, and creates no Lead", async () => {
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");
    await archiveLeadCaptureForm(fixtures.orgA.id, created.form.id);

    const result = await submitPublicLeadCaptureForm(created.form.publicToken, { name: "Jane" });
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(await prisma.lead.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("17b. a NOT_FOUND response never leaks organization existence or internal details", async () => {
    const result = await submitPublicLeadCaptureForm("00000000-0000-0000-0000-000000000000", { name: "Jane" });
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
    // Same shape whether the token never existed, or belonged to an
    // inactive/archived form — no branch anywhere reveals which.
  });
});
