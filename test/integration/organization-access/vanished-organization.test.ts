import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-user";
import { ORGANIZATION_UNAVAILABLE_PATH } from "@/lib/organization-access";
import { getSearchRequestContext } from "@/lib/search/request-context";
import { getAiAssistantRequestContext } from "@/lib/ai/request-context";
import { resetAuthMock, setMockActiveOrganization, setMockAuthUser } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * An Organization hard-deleted while a request is mid-resolution.
 *
 * Prisma loads `membership.organization` with a second, separate statement,
 * so a delete can land between the Membership read and the Organization
 * read, surfacing `membership.organization === null` for a required
 * relation. Each case below holds the Organization statement at a
 * deterministic barrier (the delete runs on the same connection, right
 * before that statement), so there is no timing dependence.
 */

type TestUser = { id: string; email: string };

const userIds: string[] = [];
const extraOrgIds: string[] = [];

function newUser(): TestUser {
  const id = randomUUID();
  userIds.push(id);
  return { id, email: `vanish-${id.slice(0, 8)}@example.com` };
}

/** A user whose first request provisions their personal workspace, exactly like production. */
async function provisionedUser(): Promise<TestUser & { organizationId: string }> {
  const user = newUser();
  setMockAuthUser(user);
  const { organizationId } = await getCurrentMembership();
  extraOrgIds.push(organizationId);
  setMockActiveOrganization(organizationId);
  return { ...user, organizationId };
}

async function addOwnMembership(userId: string, suspended = false): Promise<string> {
  const org = await prisma.organization.create({
    data: {
      name: "Vanish alt",
      slug: `vanish-alt-${randomUUID().slice(0, 8)}`,
      ...(suspended ? { suspendedAt: new Date() } : {}),
    },
  });
  extraOrgIds.push(org.id);
  await prisma.membership.create({ data: { userId, organizationId: org.id, role: "MEMBER" } });
  return org.id;
}

/** Holds Prisma's Organization relation statement until `organizationId` has been deleted. */
function vanishOrganizationBeforeRelationQuery(organizationId: string): { fired: () => boolean } {
  const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const original = proto.query;
  let fired = false;
  vi.spyOn(proto, "query").mockImplementation(function (this: unknown, ...args: unknown[]) {
    const text = typeof args[0] === "string" ? args[0] : ((args[0] as { text?: string })?.text ?? "");
    if (!fired && /FROM "public"\."Organization" WHERE/.test(text) && /"suspendedAt"/.test(text)) {
      fired = true;
      return (async () => {
        await original.call(this, { text: 'DELETE FROM "public"."Organization" WHERE id = $1', values: [organizationId] });
        return original.apply(this, args);
      })();
    }
    return original.apply(this, args);
  });
  return { fired: () => fired };
}

async function counts(userId: string) {
  return {
    organizations: await prisma.organization.count(),
    ownMemberships: await prisma.membership.count({ where: { userId } }),
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  resetAuthMock();
  const memberships = await prisma.membership.findMany({ where: { userId: { in: userIds } }, select: { organizationId: true } });
  await prisma.organization.deleteMany({ where: { id: { in: [...extraOrgIds, ...memberships.map((m) => m.organizationId)] } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  userIds.length = 0;
  extraOrgIds.length = 0;
});

describe("resolveActiveOrganizationId — organization vanishes mid-request", () => {
  it("B1: the user's only organization vanishes -> fails closed to the unavailable page, no TypeError, nothing provisioned", async () => {
    const user = await provisionedUser();
    const before = await counts(user.id);
    const barrier = vanishOrganizationBeforeRelationQuery(user.organizationId);

    const error = await getCurrentMembership().then(
      () => null,
      (e: unknown) => e,
    );

    expect(barrier.fired()).toBe(true);
    expect(error).toBeInstanceOf(RedirectSignal);
    expect((error as RedirectSignal).url).toBe(ORGANIZATION_UNAVAILABLE_PATH);
    const after = await counts(user.id);
    expect(after.organizations).toBe(before.organizations - 1); // only the deletion; nothing created
    expect(after.ownMemberships).toBe(0);
  });

  it("B2: the organization vanishes but the user has another usable membership -> falls back to their own, nothing provisioned", async () => {
    const user = await provisionedUser();
    const altOrgId = await addOwnMembership(user.id);
    const foreign = await provisionedUser(); // a second tenant that must stay untouched
    setMockAuthUser(user);
    setMockActiveOrganization(user.organizationId);
    const orgsBefore = await prisma.organization.count();
    const barrier = vanishOrganizationBeforeRelationQuery(user.organizationId);

    const result = await getCurrentMembership();

    expect(barrier.fired()).toBe(true);
    expect(result.organizationId).toBe(altOrgId);
    expect(result.membership.userId).toBe(user.id);
    expect(await prisma.organization.count()).toBe(orgsBefore - 1);
    expect(await prisma.membership.count({ where: { userId: foreign.id, organizationId: foreign.organizationId } })).toBe(1);
  });

  it("C: a genuinely new user (no memberships at the start) is still provisioned a personal workspace", async () => {
    const orgsBefore = await prisma.organization.count();
    const user = await provisionedUser();
    expect(await prisma.organization.count()).toBe(orgsBefore + 1);
    const membership = await prisma.membership.findFirstOrThrow({ where: { userId: user.id } });
    expect(membership.organizationId).toBe(user.organizationId);
    expect(membership.role).toBe("OWNER");
  });

  it("D: an organization already deleted BEFORE the request keeps its existing behavior (re-provisioned, as before)", async () => {
    const user = await provisionedUser();
    await prisma.organization.deleteMany({ where: { id: user.organizationId } });
    const orgsBefore = await prisma.organization.count();

    const result = await getCurrentMembership();

    expect(result.organizationId).not.toBe(user.organizationId);
    extraOrgIds.push(result.organizationId);
    expect(await prisma.organization.count()).toBe(orgsBefore + 1);
  });

  it("D2: an organization deleted before the request, with another usable membership, selects that membership", async () => {
    const user = await provisionedUser();
    const altOrgId = await addOwnMembership(user.id);
    await prisma.organization.deleteMany({ where: { id: user.organizationId } });
    const orgsBefore = await prisma.organization.count();

    const result = await getCurrentMembership();

    expect(result.organizationId).toBe(altOrgId);
    expect(await prisma.organization.count()).toBe(orgsBefore);
  });

  it("E: a suspended only-organization still redirects to the unavailable page and provisions nothing", async () => {
    const user = await provisionedUser();
    await prisma.organization.update({ where: { id: user.organizationId }, data: { suspendedAt: new Date() } });
    const orgsBefore = await prisma.organization.count();

    const error = await getCurrentMembership().then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(RedirectSignal);
    expect((error as RedirectSignal).url).toBe(ORGANIZATION_UNAVAILABLE_PATH);
    expect(await prisma.organization.count()).toBe(orgsBefore);
  });

  it("F: a membership deleted between the two lookups still throws the explicit 'No membership found' error", async () => {
    const user = await provisionedUser();
    const delegate = prisma.membership as unknown as { findUnique: (...args: unknown[]) => Promise<unknown> };
    const original = delegate.findUnique.bind(delegate);
    let calls = 0;
    vi.spyOn(delegate, "findUnique").mockImplementation(async (...args: unknown[]) => {
      const row = await original(...args);
      calls += 1;
      if (calls === 1) await prisma.membership.deleteMany({ where: { userId: user.id } });
      return row;
    });

    await expect(getCurrentMembership()).rejects.toThrow("No membership found for the active organization.");
    expect(calls).toBe(2);
  });
});

describe.each([
  ["Search", () => getSearchRequestContext()],
  ["AI Assistant", () => getAiAssistantRequestContext()],
] as const)("%s request context — organization vanishes mid-request", (_name, resolve) => {
  it("no usable membership left -> the existing 403, no tenant data, nothing created", async () => {
    const user = await provisionedUser();
    const before = await counts(user.id);
    const barrier = vanishOrganizationBeforeRelationQuery(user.organizationId);

    const result = await resolve();

    expect(barrier.fired()).toBe(true);
    expect(result).toEqual({ ok: false, status: 403 });
    const after = await counts(user.id);
    expect(after.organizations).toBe(before.organizations - 1);
    expect(after.ownMemberships).toBe(0);
  });

  it("another usable own membership -> that organization, never a foreign one", async () => {
    const user = await provisionedUser();
    const altOrgId = await addOwnMembership(user.id);
    const foreign = await provisionedUser();
    setMockAuthUser(user);
    setMockActiveOrganization(user.organizationId);
    const barrier = vanishOrganizationBeforeRelationQuery(user.organizationId);

    const result = await resolve();

    expect(barrier.fired()).toBe(true);
    expect(result).toEqual({ ok: true, userId: user.id, organizationId: altOrgId, role: "MEMBER" });
    expect(result).not.toMatchObject({ organizationId: foreign.organizationId });
  });
});
