import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { createLeadAction, convertLeadToClientAction, markLeadLostAction } from "@/app/(dashboard)/leads/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { testEmail, testSlug } from "../../support/run-id";

const NAME_PREFIX = "Lead-Convert";

function uniqueName(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

async function createLead(
  orgId: string,
  actor: { id: string; email: string; name: string },
  overrides: Record<string, unknown> = {},
) {
  const name = uniqueName();
  actAs(actor, orgId);
  const result = await createLeadAction({ name, ...overrides });
  if (!result.ok) throw new Error("fixture create failed");
  resetAuthMock();
  return result.leadId;
}

/** Mirrors test/integration/billing/enforcement.test.ts's own helper exactly, for the entitlement-cap test below. */
async function createStarterOrgAtClientCap(label: string) {
  const runSuffix = randomUUID().slice(0, 8);
  const owner = await prisma.user.create({
    data: { id: randomUUID(), email: testEmail(`lead-convert-${label}`, "test.local", runSuffix), name: `Cap ${label}` },
  });
  const org = await prisma.organization.create({
    data: { name: `Cap Org ${label}`, slug: testSlug(`lead-convert-${label}`, runSuffix) },
  });
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  const now = new Date();
  await prisma.subscription.create({
    data: { organizationId: org.id, planKey: "STARTER", status: "ACTIVE", trialStartedAt: now, trialEndsAt: now },
  });
  // STARTER's maxClients is 10 — fill it exactly.
  await prisma.client.createMany({
    data: Array.from({ length: 10 }, (_, i) => ({ name: `Cap Client ${i}`, userId: owner.id, organizationId: org.id })),
  });
  return { owner, org };
}

async function cleanupCapOrg(orgId: string, ownerId: string) {
  await prisma.lead.deleteMany({ where: { organizationId: orgId } });
  await prisma.client.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.user.delete({ where: { id: ownerId } });
}

describe("convertLeadToClientAction", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    // Every real conversion in this file creates a Client whose own name
    // is copied straight from its Lead (itself always NAME_PREFIX-
    // prefixed) — swept here, BEFORE cleanupTestData(), since
    // Client.organizationId is onDelete: SetNull (not Cascade):
    // cleanupTestData()'s own Organization deletion would otherwise leave
    // these Client rows behind (organizationId set to null, but still
    // referencing fixtures.owner/admin/orgBOwner via the Restrict-FK
    // userId), which then blocks its final User deletion. Matches
    // test/integration/clients/delete.test.ts's own established
    // prefix-sweep convention.
    await prisma.client.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
    await cleanupTestData(fixtures);
  });

  it("17/18/19/20/21/22. happy path creates exactly one Client with correctly mapped fields, preserves the Lead, and sets convertedClientId/convertedAt/stage WON", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner, {
      company: "Acme Co",
      email: "lead-to-convert@example.com",
      phone: "555-0123",
      notes: "some notes",
      value: 5000,
    });
    actAs(fixtures.owner, fixtures.orgA.id);
    const leadBefore = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

    const result = await convertLeadToClientAction(leadId);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    // Exactly one Client, mapped fields correct.
    const client = await prisma.client.findUnique({ where: { id: result.clientId } });
    expect(client).not.toBeNull();
    expect(client?.name).toBe(leadBefore.name);
    expect(client?.company).toBe("Acme Co");
    expect(client?.email).toBe("lead-to-convert@example.com");
    expect(client?.phone).toBe("555-0123");
    expect(client?.notes).toBe("some notes");
    expect(client?.status).toBe("ACTIVE");
    expect(client?.organizationId).toBe(fixtures.orgA.id);
    expect(client?.userId).toBe(fixtures.owner.id);

    // source/value/lostReason/archivedAt are never mapped onto Client.
    const allClientFields = Object.keys(client ?? {});
    expect(allClientFields).not.toContain("source");
    expect(allClientFields).not.toContain("value");
    expect(allClientFields).not.toContain("lostReason");

    // Lead itself is preserved (not deleted), with conversion fields set.
    const leadAfter = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(leadAfter).not.toBeNull();
    expect(leadAfter?.convertedClientId).toBe(result.clientId);
    expect(leadAfter?.convertedAt).not.toBeNull();
    expect(leadAfter?.stage).toBe("WON");
    expect(leadAfter?.value?.toString()).toBe("5000");
    expect(leadAfter?.notes).toBe("some notes");
  });

  it("34. Activity CONVERTED is created exactly once for the Lead, and CLIENT CREATED is also logged for the new Client", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await convertLeadToClientAction(leadId);
    if (!result.ok) throw new Error("expected ok");

    const leadActivities = await prisma.activity.findMany({
      where: { entityType: "LEAD", entityId: leadId, action: "CONVERTED" },
    });
    expect(leadActivities).toHaveLength(1);

    const clientActivities = await prisma.activity.findMany({
      where: { entityType: "CLIENT", entityId: result.clientId, action: "CREATED" },
    });
    expect(clientActivities).toHaveLength(1);
  });

  it("23. duplicate email without confirmation returns requires_duplicate_confirmation and creates nothing", async () => {
    const sharedEmail = `dup-${randomUUID().slice(0, 8)}@example.com`;
    // A real, pre-existing Client in the same org with this email.
    actAs(fixtures.owner, fixtures.orgA.id);
    await prisma.client.create({
      data: { name: "Existing Client", email: sharedEmail, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner, { email: sharedEmail });
    actAs(fixtures.owner, fixtures.orgA.id);
    const clientCountBefore = await prisma.client.count({ where: { organizationId: fixtures.orgA.id } });

    const result = await convertLeadToClientAction(leadId);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toBe("requires_duplicate_confirmation");
    expect((result as { message: string }).message).toBeTruthy();
    // Never reveals the existing Client's id.
    expect(JSON.stringify(result)).not.toContain((await prisma.client.findFirst({ where: { email: sharedEmail, name: "Existing Client" } }))!.id);

    expect(await prisma.client.count({ where: { organizationId: fixtures.orgA.id } })).toBe(clientCountBefore);
    expect((await prisma.lead.findUnique({ where: { id: leadId } }))?.convertedClientId).toBeNull();

    await prisma.client.deleteMany({ where: { email: sharedEmail, organizationId: fixtures.orgA.id } });
  });

  it("24. duplicate email WITH confirmDuplicate:true creates a brand-new Client (never links to the existing one)", async () => {
    const sharedEmail = `dup-confirm-${randomUUID().slice(0, 8)}@example.com`;
    // Owned by a DIFFERENT staff member (admin) than the one converting
    // (owner) below — Client's own pre-existing @@unique([userId, email])
    // constraint is scoped by owning user, not organization, so two
    // Clients sharing an email genuinely can coexist as long as they
    // have different owners (see duplicate_owner_conflict's own test for
    // the narrower same-owner case, which is a real, separate outcome).
    actAs(fixtures.admin, fixtures.orgA.id);
    const existing = await prisma.client.create({
      data: { name: "Existing Client 2", email: sharedEmail, organizationId: fixtures.orgA.id, userId: fixtures.admin.id },
    });
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner, { email: sharedEmail });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await convertLeadToClientAction(leadId, { confirmDuplicate: true });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.clientId).not.toBe(existing.id);

    const matchingClients = await prisma.client.findMany({
      where: { organizationId: fixtures.orgA.id, email: { equals: sharedEmail, mode: "insensitive" } },
    });
    expect(matchingClients).toHaveLength(2);

    await prisma.client.deleteMany({ where: { email: sharedEmail, organizationId: fixtures.orgA.id } });
  });

  it("a P2002 unique-constraint violation from tx.client.create() (Client's own real, unrelated @@unique([userId,email]) — hit in production whenever the converting user already owns another Client with this exact email) is translated into a controlled duplicate_owner_conflict result, never a raw Prisma error", async () => {
    // Simulated via a spy on prisma.$transaction, exactly like this
    // repo's own established technique for exercising a real-shaped
    // database error without depending on the shared local PGlite test
    // database's own rollback behavior after a real constraint
    // violation — see test/integration/clients/delete.test.ts's own
    // header comment for the full reasoning (a confirmed, documented
    // PGlite limitation, not a defect in convertLeadToClientAction
    // itself; a real Postgres server correctly enforces both the
    // constraint and its own rollback).
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`userId`,`email`)", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["userId", "email"] },
    });
    const transactionSpy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(p2002);

    let result: Awaited<ReturnType<typeof convertLeadToClientAction>>;
    try {
      result = await convertLeadToClientAction(leadId, { confirmDuplicate: true });
    } finally {
      transactionSpy.mockRestore();
    }

    expect(result).toMatchObject({ ok: false, reason: "duplicate_owner_conflict" });
    if (result.ok) throw new Error("expected rejection");
    expect((result as { message: string }).message).toBeTruthy();

    // Nothing was actually written — the spy intercepted the transaction
    // before any real query ran.
    expect((await prisma.lead.findUnique({ where: { id: leadId } }))?.convertedClientId).toBeNull();
  });

  it("an unrelated database failure during conversion still propagates instead of being silently swallowed", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);
    const transactionSpy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("simulated unrelated database failure"));

    try {
      await expect(convertLeadToClientAction(leadId)).rejects.toThrow("simulated unrelated database failure");
    } finally {
      transactionSpy.mockRestore();
    }
  });

  it("25/26. the duplicate lookup is same-organization only — a matching email in a different org never triggers confirmation", async () => {
    const crossOrgEmail = `cross-org-${randomUUID().slice(0, 8)}@example.com`;
    // Existing Client with this email lives in orgB.
    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    await prisma.client.create({
      data: { name: "OrgB Client", email: crossOrgEmail, organizationId: fixtures.orgB.id, userId: fixtures.orgBOwner.id },
    });
    // The Lead being converted lives in orgA, with the SAME email.
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner, { email: crossOrgEmail });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await convertLeadToClientAction(leadId);

    expect(result.ok).toBe(true);

    await prisma.client.deleteMany({ where: { email: crossOrgEmail } });
  });

  it("case-insensitive duplicate match within the same org still requires confirmation", async () => {
    const email = `case-${randomUUID().slice(0, 8)}@example.com`;
    actAs(fixtures.owner, fixtures.orgA.id);
    await prisma.client.create({
      data: { name: "Case Client", email: email.toUpperCase(), organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner, { email });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await convertLeadToClientAction(leadId);

    expect(result).toMatchObject({ ok: false, reason: "requires_duplicate_confirmation" });

    await prisma.client.deleteMany({ where: { email: email.toUpperCase(), organizationId: fixtures.orgA.id } });
  });

  it("27. a repeat conversion attempt returns already_converted and creates no second Client", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);
    const first = await convertLeadToClientAction(leadId);
    if (!first.ok) throw new Error("expected first ok");

    const second = await convertLeadToClientAction(leadId);

    expect(second).toEqual({ ok: false, reason: "already_converted" });
    const clientCount = await prisma.client.count({
      where: { organizationId: fixtures.orgA.id, name: (await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).name },
    });
    expect(clientCount).toBe(1);
    const convertedActivities = await prisma.activity.findMany({
      where: { entityType: "LEAD", entityId: leadId, action: "CONVERTED" },
    });
    expect(convertedActivities).toHaveLength(1);
  });

  it("28. two simultaneous conversion attempts on the same Lead persist exactly one Client", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);

    const [resultA, resultB] = await Promise.all([
      convertLeadToClientAction(leadId),
      convertLeadToClientAction(leadId),
    ]);

    const results = [resultA, resultB];
    const successes = results.filter((r) => r.ok);
    const failures = results.filter((r) => !r.ok);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect((failures[0] as { reason: string }).reason).toBe("already_converted");

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(lead?.convertedClientId).toBe((successes[0] as { clientId: string }).clientId);

    const clientCount = await prisma.client.count({ where: { id: (successes[0] as { clientId: string }).clientId } });
    expect(clientCount).toBe(1);

    const convertedActivities = await prisma.activity.findMany({
      where: { entityType: "LEAD", entityId: leadId, action: "CONVERTED" },
    });
    expect(convertedActivities).toHaveLength(1);
  });

  it("29/30. a Starter org already at its Client cap blocks conversion, and creates no partial Client", async () => {
    const { owner, org } = await createStarterOrgAtClientCap("29");
    const leadId = await createLead(org.id, owner);
    actAs(owner, org.id);
    const clientCountBefore = await prisma.client.count({ where: { organizationId: org.id } });

    const result = await convertLeadToClientAction(leadId);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toBe("entitlement_blocked");
    expect((result as { message: string }).message).toBeTruthy();

    expect(await prisma.client.count({ where: { organizationId: org.id } })).toBe(clientCountBefore);
    expect((await prisma.lead.findUnique({ where: { id: leadId } }))?.convertedClientId).toBeNull();
    const convertedActivities = await prisma.activity.findMany({
      where: { entityType: "LEAD", entityId: leadId, action: "CONVERTED" },
    });
    expect(convertedActivities).toHaveLength(0);

    await cleanupCapOrg(org.id, owner.id);
  });

  it("31. a foreign-org Lead cannot be converted (quiet not_found)", async () => {
    const leadId = await createLead(fixtures.orgB.id, fixtures.orgBOwner);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await convertLeadToClientAction(leadId);

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("32. an archived Lead cannot be converted", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);
    await prisma.lead.update({ where: { id: leadId }, data: { archivedAt: new Date() } });

    const result = await convertLeadToClientAction(leadId);

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect((await prisma.lead.findUnique({ where: { id: leadId } }))?.convertedClientId).toBeNull();
  });

  it("33. a LOST Lead cannot be converted", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);
    await markLeadLostAction(leadId, "no budget");

    const result = await convertLeadToClientAction(leadId);

    expect(result).toEqual({ ok: false, reason: "lost" });
    expect((await prisma.lead.findUnique({ where: { id: leadId } }))?.convertedClientId).toBeNull();
  });

  it("36. no action accepts convertedClientId as caller input — conversion always creates its own Client server-side", async () => {
    const leadId = await createLead(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);
    const someOtherClientId = fixtures.clientA.id;

    // ConvertLeadOptions has no clientId/convertedClientId field at all —
    // even smuggled past the type system, the action never reads it.
    const result = await convertLeadToClientAction(leadId, { ...( { clientId: someOtherClientId } as object) });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    // A brand-new Client was created — never fixtures.clientA.
    expect(result.clientId).not.toBe(someOtherClientId);
  });
});
