import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getOrganizationDetail } from "@/lib/platform-admin/queries/organization-detail";
import { setMockAuthUser, resetAuthMock } from "../../support/auth-mock";

/**
 * Platform Admin organization detail -- owner and staff when a Membership's
 * required `user` relation comes back null.
 *
 * This app's Prisma client loads `include: { user }` as a second SQL
 * statement after the Membership select (not a join), so a User deleted
 * between the two reads can surface as `user: null` even though the schema
 * constraint (Membership.user, onDelete: Cascade) is intact. That transient
 * state is simulated here by wrapping the real membership.findMany and nulling
 * the relation of chosen rows -- the database itself is never corrupted and no
 * constraint is weakened.
 */

const ADMIN_EMAIL = "platform-admin-members-test@example.com";
const ORIGINAL_ADMIN_EMAILS = process.env.PLATFORM_ADMIN_EMAILS;
const NAMES = { owner: "Members Owner Name", admin: "Members Admin Name", member: "Members Member Name" };

const orgIds: string[] = [];
const userIds: string[] = [];

beforeAll(() => {
  process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAuthMock();
});

afterAll(async () => {
  process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS;
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

function asPlatformAdmin() {
  setMockAuthUser({ id: randomUUID(), email: ADMIN_EMAIL });
}

async function makeUser(name: string) {
  const user = await prisma.user.create({ data: { id: randomUUID(), name, email: `members-${randomUUID()}@example-members.test` } });
  userIds.push(user.id);
  return user;
}

async function makeOrg(label: string) {
  const org = await prisma.organization.create({ data: { name: `Members ${label}`, slug: `members-test-${randomUUID()}` } });
  orgIds.push(org.id);
  const owner = await makeUser(`${NAMES.owner} ${label}`);
  const admin = await makeUser(`${NAMES.admin} ${label}`);
  const member = await makeUser(`${NAMES.member} ${label}`);
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  await prisma.membership.create({ data: { userId: admin.id, organizationId: org.id, role: "ADMIN" } });
  await prisma.membership.create({ data: { userId: member.id, organizationId: org.id, role: "MEMBER" } });
  return { org, owner, admin, member };
}

/** Wraps the real membership.findMany, nulling `user` on rows for the given user ids (the transient relation loss). */
function nullUserFor(...ids: string[]) {
  const real = prisma.membership.findMany.bind(prisma.membership);
  return vi.spyOn(prisma.membership, "findMany").mockImplementation(((args: Parameters<typeof real>[0]) =>
    (real(args) as unknown as Promise<Array<{ userId: string; user: unknown }>>).then((rows) =>
      rows.map((row) => (ids.includes(row.userId) ? { ...row, user: null } : row)),
    )) as unknown as typeof prisma.membership.findMany);
}

describe("getOrganizationDetail -- owner and staff", () => {
  it("valid memberships: the owner and every staff member are returned with their real identities", async () => {
    const { org, owner, admin, member } = await makeOrg("valid");
    asPlatformAdmin();

    const detail = await getOrganizationDetail(org.id, new Date());

    expect(detail!.owner).toEqual({ id: owner.id, name: owner.name, email: owner.email });
    expect(detail!.staff.map((s) => s.id).sort()).toEqual([owner.id, admin.id, member.id].sort());
    expect(detail!.staff.find((s) => s.id === admin.id)).toMatchObject({ role: "ADMIN", name: admin.name, email: admin.email });
  });

  it("a null owner user: owner is null (no throw, nothing invented), the owner row is not listed, the others are intact", async () => {
    const { org, owner, admin, member } = await makeOrg("null-owner");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    nullUserFor(owner.id);
    asPlatformAdmin();

    const detail = await getOrganizationDetail(org.id, new Date());

    expect(detail!.owner).toBeNull();
    expect(detail!.staff.map((s) => s.id).sort()).toEqual([admin.id, member.id].sort());
    expect(detail!.staff.every((s) => s.name && s.email)).toBe(true);
    // Only a count is logged: no ids, names or emails.
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("skipped 1 membership");
    for (const secret of [owner.id, owner.email, owner.name, admin.email, org.id]) expect(logged).not.toContain(secret);
  });

  it("a null non-owner staff user: only that row is excluded and the owner is unchanged", async () => {
    const { org, owner, admin, member } = await makeOrg("null-staff");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    nullUserFor(member.id);
    asPlatformAdmin();

    const detail = await getOrganizationDetail(org.id, new Date());

    expect(detail!.owner).toMatchObject({ id: owner.id, email: owner.email });
    expect(detail!.staff.map((s) => s.id).sort()).toEqual([owner.id, admin.id].sort());
  });

  it("mixed valid and invalid rows (owner and a staff member null): the valid staff remain, owner is null", async () => {
    const { org, owner, admin, member } = await makeOrg("mixed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    nullUserFor(owner.id, member.id);
    asPlatformAdmin();

    const detail = await getOrganizationDetail(org.id, new Date());

    expect(detail!.owner).toBeNull();
    expect(detail!.staff.map((s) => s.id)).toEqual([admin.id]);
    expect(JSON.stringify(warn.mock.calls)).toContain("skipped 2 membership");
  });

  it("no anomaly, no log: a healthy organization never triggers the diagnostic", async () => {
    const { org } = await makeOrg("quiet");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    asPlatformAdmin();

    await getOrganizationDetail(org.id, new Date());

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("getOrganizationDetail -- scoping and authorization are unchanged", () => {
  it("another organization's members never appear, even while this organization has a null-user row", async () => {
    const a = await makeOrg("scope-a");
    const b = await makeOrg("scope-b");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    nullUserFor(a.member.id);
    asPlatformAdmin();

    const detailA = await getOrganizationDetail(a.org.id, new Date());

    const ids = detailA!.staff.map((s) => s.id);
    for (const foreign of [b.owner.id, b.admin.id, b.member.id]) expect(ids).not.toContain(foreign);
    expect(detailA!.owner?.id).toBe(a.owner.id);
  });

  it("a caller who is not a platform admin is still rejected before any membership read", async () => {
    const { org } = await makeOrg("authz");
    const spy = vi.spyOn(prisma.membership, "findMany");
    setMockAuthUser({ id: randomUUID(), email: "not-a-platform-admin@example.com" });

    await expect(getOrganizationDetail(org.id, new Date())).rejects.toBeTruthy();

    expect(spy).not.toHaveBeenCalled();
  });
});
