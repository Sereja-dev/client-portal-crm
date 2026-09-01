import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock, setMockAuthUser, setMockActiveOrganization } from "../../support/auth-mock";
import { getAiAssistantRequestContext } from "@/lib/ai/request-context";

const ORIGINAL_PLATFORM_ADMIN_EMAILS = process.env.PLATFORM_ADMIN_EMAILS;

describe("getAiAssistantRequestContext — integration", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
    if (ORIGINAL_PLATFORM_ADMIN_EMAILS === undefined) {
      delete process.env.PLATFORM_ADMIN_EMAILS;
    } else {
      process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL_PLATFORM_ADMIN_EMAILS;
    }
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  // --- A. unauthenticated ---
  it("no session -> 401", async () => {
    const result = await getAiAssistantRequestContext();
    expect(result).toEqual({ ok: false, status: 401 });
  });

  // --- B. ordinary staff with active Membership -> allowed ---
  it("authenticated staff User with an active Membership -> ok, with userId/organizationId/role", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getAiAssistantRequestContext();
    expect(result).toEqual({
      ok: true,
      userId: fixtures.owner.id,
      organizationId: fixtures.orgA.id,
      role: "OWNER",
    });
  });

  it("a valid cookie for a non-OWNER membership is honored", async () => {
    actAs(fixtures.member, fixtures.orgA.id);
    const result = await getAiAssistantRequestContext();
    expect(result).toEqual({ ok: true, userId: fixtures.member.id, organizationId: fixtures.orgA.id, role: "MEMBER" });
  });

  it("no cookie set: falls back to the user's OWNER membership, never auto-provisions a new one", async () => {
    setMockAuthUser({ id: fixtures.owner.id, email: fixtures.owner.email });
    const result = await getAiAssistantRequestContext();
    expect(result).toEqual({ ok: true, userId: fixtures.owner.id, organizationId: fixtures.orgA.id, role: "OWNER" });
    const membershipCount = await prisma.membership.count({ where: { userId: fixtures.owner.id } });
    expect(membershipCount).toBe(1);
  });

  // --- C. Portal-only identity -> denied ---
  it("authenticated PortalUser without a staff User -> 403", async () => {
    setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
    const result = await getAiAssistantRequestContext();
    expect(result).toEqual({ ok: false, status: 403 });
  });

  it("an unknown authenticated identity (no User, no PortalUser row at all) -> 403", async () => {
    setMockAuthUser({ id: randomUUID(), email: "nobody@example.com" });
    const result = await getAiAssistantRequestContext();
    expect(result).toEqual({ ok: false, status: 403 });
  });

  // --- D. invalid/suspended staff membership -> denied ---
  it("a staff User with no Membership at all -> 403, never auto-provisioned", async () => {
    const orphanId = randomUUID();
    const orphanEmail = `orphan-${randomUUID()}@example.com`;
    await prisma.user.create({ data: { id: orphanId, email: orphanEmail, name: "Orphan Staff" } });

    try {
      setMockAuthUser({ id: orphanId, email: orphanEmail });
      const result = await getAiAssistantRequestContext();
      expect(result).toEqual({ ok: false, status: 403 });

      const memberships = await prisma.membership.findMany({ where: { userId: orphanId } });
      expect(memberships).toHaveLength(0);
    } finally {
      await prisma.user.delete({ where: { id: orphanId } });
    }
  });

  it("a staff User whose only organization is suspended -> 403", async () => {
    const staffId = randomUUID();
    const staffEmail = `suspended-org-staff-${randomUUID()}@example.com`;
    const org = await prisma.organization.create({
      data: { name: "Suspended Org", slug: `suspended-org-${randomUUID()}`, suspendedAt: new Date() },
    });
    await prisma.user.create({ data: { id: staffId, email: staffEmail, name: "Suspended Org Staff" } });
    await prisma.membership.create({ data: { userId: staffId, organizationId: org.id, role: "OWNER" } });

    try {
      setMockAuthUser({ id: staffId, email: staffEmail });
      const result = await getAiAssistantRequestContext();
      expect(result).toEqual({ ok: false, status: 403 });
    } finally {
      await prisma.membership.deleteMany({ where: { userId: staffId } });
      await prisma.user.delete({ where: { id: staffId } });
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  // --- E. Platform Admin identity -> denied ---
  it("an identity on the Platform Admin allowlist, with no staff row at all -> 403 (never a distinct status/message)", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "platform-admin-ai-test@example.com";
    setMockAuthUser({ id: randomUUID(), email: "platform-admin-ai-test@example.com" });
    const result = await getAiAssistantRequestContext();
    expect(result).toEqual({ ok: false, status: 403 });
  });

  // --- F. CRITICAL edge case: dual identity (Platform Admin allowlisted AND has a real staff User/Membership) -> still denied ---
  it("CRITICAL: an identity that is BOTH Platform-Admin-allowlisted AND has a real, active staff Membership is still denied", async () => {
    const dualEmail = `dual-platform-admin-staff-${randomUUID()}@example.com`;
    const dualId = randomUUID();
    process.env.PLATFORM_ADMIN_EMAILS = dualEmail;

    // Give this exact identity a completely ordinary, otherwise-valid
    // staff User + active OWNER Membership — the same shape that, on its
    // own (see the "ordinary staff" test above), is unconditionally
    // allowed.
    await prisma.user.create({ data: { id: dualId, email: dualEmail, name: "Dual Platform Admin + Staff" } });
    await prisma.membership.create({ data: { userId: dualId, organizationId: fixtures.orgA.id, role: "OWNER" } });

    try {
      setMockAuthUser({ id: dualId, email: dualEmail });
      setMockActiveOrganization(fixtures.orgA.id);
      const result = await getAiAssistantRequestContext();

      // Denied — identical to the Platform-Admin-alone case, not a
      // different shape, and never the { ok: true, ... } a staff-only
      // check of this identity's Membership row would otherwise produce.
      expect(result).toEqual({ ok: false, status: 403 });
    } finally {
      await prisma.membership.deleteMany({ where: { userId: dualId } });
      await prisma.user.delete({ where: { id: dualId } });
    }
  });

  it("Platform Admin exclusion is case-insensitive, matching isPlatformAdmin()'s own established behavior", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "Platform-Admin-Case@Example.com";
    setMockAuthUser({ id: randomUUID(), email: "platform-admin-case@example.com" });
    const result = await getAiAssistantRequestContext();
    expect(result).toEqual({ ok: false, status: 403 });
  });

  it("an ordinary staff user is unaffected when PLATFORM_ADMIN_EMAILS is unset", async () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getAiAssistantRequestContext();
    expect(result).toEqual({ ok: true, userId: fixtures.owner.id, organizationId: fixtures.orgA.id, role: "OWNER" });
  });
});
