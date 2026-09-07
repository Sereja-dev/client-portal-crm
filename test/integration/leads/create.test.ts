import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createLeadAction } from "@/app/(dashboard)/leads/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Leads / Sales Pipeline Phase 2 — createLeadAction. Same fixtures/auth-mock
 * convention as every other integration test in this repo (see
 * test/fixtures/seed.ts, test/support/auth-mock.ts). Lead rows created
 * under fixtures.orgA/orgB cascade-delete automatically when
 * cleanupTestData() removes those Organizations (Lead.organizationId is
 * onDelete: Cascade) — no separate per-test Lead cleanup needed, matching
 * how the shared task/invoice/portalUser fixture rows are already handled.
 */

const NAME_PREFIX = "Lead-Create";

function uniqueName(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

describe("createLeadAction", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("1. valid create succeeds, defaults stage to NEW, and returns the new lead id", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = uniqueName();

    const result = await createLeadAction({ name, company: "Acme", email: "prospect@example.com" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const created = await prisma.lead.findUnique({ where: { id: result.leadId } });
    expect(created).not.toBeNull();
    expect(created?.name).toBe(name);
    expect(created?.company).toBe("Acme");
    expect(created?.stage).toBe("NEW");
    expect(created?.organizationId).toBe(fixtures.orgA.id);
  });

  it("2. create always uses the server-resolved organizationId, never anything the caller could imply", async () => {
    actAs(fixtures.member, fixtures.orgA.id);
    const name = uniqueName();

    const result = await createLeadAction({ name });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const created = await prisma.lead.findUnique({ where: { id: result.leadId } });
    expect(created?.organizationId).toBe(fixtures.orgA.id);
  });

  it("3. create rejects an assignee who is not a Member of the caller's own organization", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = uniqueName();

    // orgBOwner has no Membership in orgA.
    const result = await createLeadAction({ name, assignedToUserId: fixtures.orgBOwner.id });

    expect(result).toEqual({ ok: false, reason: "invalid_assignee" });
    expect(await prisma.lead.findFirst({ where: { name } })).toBeNull();
  });

  it("an assignee who IS a Member of the caller's organization is accepted", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = uniqueName();

    const result = await createLeadAction({ name, assignedToUserId: fixtures.admin.id });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const created = await prisma.lead.findUnique({ where: { id: result.leadId } });
    expect(created?.assignedToUserId).toBe(fixtures.admin.id);
  });

  it("a missing name is rejected with a validation field error, and nothing is created", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await createLeadAction({ name: "   " });

    expect(result).toMatchObject({ ok: false, reason: "validation" });
    if (result.ok || result.reason !== "validation") throw new Error("expected validation");
    expect(result.fieldErrors.name).toBeTruthy();
  });

  it("an invalid email format is rejected", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = uniqueName();

    const result = await createLeadAction({ name, email: "not-an-email" });

    expect(result).toMatchObject({ ok: false, reason: "validation" });
    if (result.ok || result.reason !== "validation") throw new Error("expected validation");
    expect(result.fieldErrors.email).toBeTruthy();
    expect(await prisma.lead.findFirst({ where: { name } })).toBeNull();
  });

  it("a negative value is rejected", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = uniqueName();

    const result = await createLeadAction({ name, value: -50 });

    expect(result).toMatchObject({ ok: false, reason: "validation" });
    if (result.ok || result.reason !== "validation") throw new Error("expected validation");
    expect(result.fieldErrors.value).toBeTruthy();
  });

  it("an invalid source is rejected", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = uniqueName();

    const result = await createLeadAction({ name, source: "NOT_A_REAL_SOURCE" });

    expect(result).toMatchObject({ ok: false, reason: "validation" });
    if (result.ok || result.reason !== "validation") throw new Error("expected validation");
    expect(result.fieldErrors.source).toBeTruthy();
  });

  it("creates exactly one CREATED Activity row, scoped to the org, with no email/phone/notes in metadata", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = uniqueName();

    const result = await createLeadAction({
      name,
      email: "secret@example.com",
      phone: "+1-555-0100",
      notes: "sensitive freeform notes",
    });
    if (!result.ok) throw new Error("expected ok");

    const activities = await prisma.activity.findMany({
      where: { entityType: "LEAD", entityId: result.leadId, action: "CREATED" },
    });
    expect(activities).toHaveLength(1);
    const metadata = activities[0].metadata as Record<string, unknown>;
    expect(metadata.name).toBe(name);
    expect(metadata.stage).toBe("NEW");
    expect(JSON.stringify(metadata)).not.toContain("secret@example.com");
    expect(JSON.stringify(metadata)).not.toContain("555-0100");
    expect(JSON.stringify(metadata)).not.toContain("sensitive freeform notes");
  });

  it("35. does not accept organizationId as trusted input — passing one has no effect on the resolved org", async () => {
    actAs(fixtures.member, fixtures.orgA.id);
    const name = uniqueName();

    // LeadWritableInput has no organizationId field at all; even if a
    // caller smuggles one in via an object literal, TypeScript's own type
    // doesn't expose it and the action never reads it.
    const result = await createLeadAction({ name, ...( { organizationId: fixtures.orgB.id } as object) });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const created = await prisma.lead.findUnique({ where: { id: result.leadId } });
    expect(created?.organizationId).toBe(fixtures.orgA.id);
  });
});
