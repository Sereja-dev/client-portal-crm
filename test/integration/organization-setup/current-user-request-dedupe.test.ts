import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getCurrentMembership,
  getCurrentUserOrganization,
  getOrCreateUser,
  setActiveOrganization,
} from "@/lib/current-user";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, setMockAuthUser, setMockActiveOrganization, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * Navigation Performance Slice B — getCurrentUserOrganization()/
 * getCurrentMembership() are now wrapped in React's cache() (see
 * src/lib/current-user.ts's own doc comments on both). As
 * session-stability.test.ts's own header comment already established for
 * getVerifiedAuthUser()'s identical pattern: React.cache() does not
 * dedupe calls in this bare Vitest environment, which has no Server
 * Component render boundary to scope the cache to — so this file does
 * not (and cannot meaningfully) assert a DB-call-count reduction here.
 * cache()-actually-applied is proven separately, as a source contract,
 * in current-user-cache-contract.test.ts. What these tests prove is
 * exactly what matters for correctness: the behavior underneath the new
 * cache() boundary is byte-for-byte unchanged — same returned data, same
 * tenant-isolation guarantees, same stale-cookie fallback, same first-
 * login provisioning, same Staff/Portal separation, same freshness
 * across a (simulated) subsequent request.
 */
describe("current-user resolution — behavior preserved under Navigation Performance Slice B's cache() boundary", () => {
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

  it("repeated same-request calls return identical, correct membership/org data", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);

    const first = await getCurrentMembership();
    const second = await getCurrentMembership();

    expect(first.user.id).toBe(fixtures.owner.id);
    expect(first.organizationId).toBe(fixtures.orgA.id);
    expect(first.membership.role).toBe("OWNER");

    expect(second.user.id).toBe(first.user.id);
    expect(second.organizationId).toBe(first.organizationId);
    expect(second.membership.role).toBe(first.membership.role);
  });

  it("a foreign organization's membership can never be substituted for the active one", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);

    // fixtures.owner has no Membership in orgB.
    await expect(setActiveOrganization(fixtures.orgB.id)).rejects.toThrow(
      "You are not a member of this organization.",
    );

    // The rejected switch must never have touched the active-org cookie —
    // the current identity still resolves to orgA, unaffected.
    const { organizationId, membership } = await getCurrentMembership();
    expect(organizationId).toBe(fixtures.orgA.id);
    expect(membership.role).toBe("OWNER");
  });

  it("a stale/invalid active-organization cookie falls back to a real usable membership, never errors", async () => {
    setMockAuthUser({ id: fixtures.owner.id, email: fixtures.owner.email });
    // A cookie value naming an organization this user has no Membership
    // in (and isn't even a real Organization id) — the exact "stale
    // cookie" shape resolveActiveOrganizationId() must recover from.
    setMockActiveOrganization(randomUUID());

    const { user, organizationId } = await getCurrentUserOrganization();
    expect(user.id).toBe(fixtures.owner.id);
    expect(organizationId).toBe(fixtures.orgA.id);
  });

  it("first-login provisioning (no existing User row) is unchanged", async () => {
    const newAuthId = randomUUID();
    setMockAuthUser({ id: newAuthId, email: `new-user-${newAuthId.slice(0, 8)}@test.local` });

    const { user, organizationId } = await getCurrentUserOrganization();
    expect(user.id).toBe(newAuthId);

    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    expect(organization).not.toBeNull();

    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: newAuthId, organizationId } },
    });
    expect(membership?.role).toBe("OWNER");

    await prisma.membership.deleteMany({ where: { userId: newAuthId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: newAuthId } });
  });

  it("a Client Portal-only identity is never auto-provisioned a staff Organization", async () => {
    setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });

    let caught: unknown;
    try {
      await getOrCreateUser();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RedirectSignal);
    expect((caught as RedirectSignal).url).toBe("/portal");

    const staffUser = await prisma.user.findUnique({ where: { id: fixtures.portalUser.id } });
    expect(staffUser).toBeNull();
  });

  it("switching organizations is correctly fresh on the next (simulated) request — never a stale carryover", async () => {
    // Give fixtures.owner a second, genuine Membership so there is a real
    // organization to switch to — none of the seeded fixtures otherwise
    // belong to more than one organization.
    await prisma.membership.create({
      data: { userId: fixtures.owner.id, organizationId: fixtures.orgB.id, role: "MEMBER" },
    });

    try {
      actAs(fixtures.owner, fixtures.orgA.id);
      const before = await getCurrentUserOrganization();
      expect(before.organizationId).toBe(fixtures.orgA.id);

      await setActiveOrganization(fixtures.orgB.id);

      // A fresh resolveAtion (stand-in for the brand-new request a real
      // switch always redirects into — see switchOrganizationAction's own
      // redirect()) must observe the new cookie, not the pre-switch value.
      const after = await getCurrentUserOrganization();
      expect(after.organizationId).toBe(fixtures.orgB.id);
    } finally {
      await prisma.membership.deleteMany({ where: { userId: fixtures.owner.id, organizationId: fixtures.orgB.id } });
    }
  });
});
