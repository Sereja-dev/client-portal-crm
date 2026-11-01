import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { PAGE_SIZE } from "@/lib/list-params";
import { getGrowthSummary, listRegistrations, parseGrowthParams } from "@/lib/platform-admin/queries/growth";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { setMockAuthUser, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

// Platform Admin Growth V1, Slice B — database-backed semantics and the
// execution-level authorization of getGrowthSummary / listRegistrations.
//
// Windows use a fixed `now` in June 2027, a period no other test (or real
// data) writes into, so in-window counts are exact. All-time figures are
// asserted as deltas against a baseline read before seeding, because the
// shared test database holds other suites' rows.

const ADMIN_EMAIL = "platform-admin-growth-test@example.com";
const NON_ADMIN_EMAIL = "not-a-platform-admin-growth-test@example.com";
const ORIGINAL_ADMIN_EMAILS = process.env.PLATFORM_ADMIN_EMAILS;
const NOW = new Date("2027-06-15T10:00:00.000Z");
const MARKER = `growth${randomUUID().slice(0, 8)}`;

let fixtures: TestFixtures;
const attemptAuthIds: string[] = [];
const userIds: string[] = [];
const orgIds: string[] = [];

const asAdmin = () => setMockAuthUser({ id: randomUUID(), email: ADMIN_EMAIL });
const asNonAdmin = () => setMockAuthUser({ id: randomUUID(), email: NON_ADMIN_EMAIL });
const asUnauthenticated = () => setMockAuthUser(null);

async function catchRedirect(fn: () => Promise<unknown>): Promise<RedirectSignal> {
  let caught: unknown;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
  return caught as RedirectSignal;
}

async function attempt(overrides: {
  email?: string;
  first?: Date;
  last?: Date;
  count?: number;
  activatedAt?: Date | null;
  authUserId?: string;
  origin?: "STANDALONE" | "INVITED" | "UNKNOWN";
}) {
  const authUserId = overrides.authUserId ?? randomUUID();
  attemptAuthIds.push(authUserId);
  const first = overrides.first ?? new Date("2027-06-14T08:00:00.000Z");
  return prisma.signupAttempt.create({
    data: {
      authUserId,
      email: overrides.email ?? `${MARKER}-${randomUUID().slice(0, 6)}@example.com`,
      origin: overrides.origin ?? "STANDALONE",
      firstAttemptedAt: first,
      lastAttemptedAt: overrides.last ?? first,
      attemptCount: overrides.count ?? 1,
      activatedAt: overrides.activatedAt ?? null,
    },
  });
}

async function user(id: string, createdAt: Date) {
  userIds.push(id);
  return prisma.user.create({ data: { id, email: `${MARKER}-user-${randomUUID().slice(0, 6)}@example.com`, name: "Growth Test User", createdAt } });
}

async function org(name: string, createdAt: Date = new Date("2027-06-14T09:00:00.000Z")) {
  const o = await prisma.organization.create({ data: { name, slug: `${MARKER}-${randomUUID().slice(0, 8)}`, createdAt } });
  orgIds.push(o.id);
  return o;
}

beforeAll(async () => {
  fixtures = await seedTestData();
  process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
});

afterEach(() => {
  resetAuthMock();
  vi.restoreAllMocks();
});

afterAll(async () => {
  process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS;
  await prisma.signupAttempt.deleteMany({ where: { authUserId: { in: attemptAuthIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await cleanupTestData(fixtures);
});

describe("Growth queries — execution-level authorization", () => {
  const params = parseGrowthParams({});

  it("unauthenticated: both readers redirect to /login and perform zero Prisma reads", async () => {
    asUnauthenticated();
    const spies = [
      vi.spyOn(prisma.signupAttempt, "count"),
      vi.spyOn(prisma.signupAttempt, "findMany"),
      vi.spyOn(prisma.signupAttempt, "aggregate"),
      vi.spyOn(prisma.user, "count"),
      vi.spyOn(prisma, "$transaction"),
    ];
    expect((await catchRedirect(() => getGrowthSummary(params, NOW))).url).toBe("/login?reason=session_expired");
    expect((await catchRedirect(() => listRegistrations(params))).url).toBe("/login?reason=session_expired");
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  it("authenticated Staff who is not on the allowlist: redirected to /dashboard with zero Prisma reads", async () => {
    asNonAdmin();
    const spies = [vi.spyOn(prisma.signupAttempt, "count"), vi.spyOn(prisma.signupAttempt, "findMany"), vi.spyOn(prisma, "$transaction")];
    expect((await catchRedirect(() => getGrowthSummary(params, NOW))).url).toBe("/dashboard");
    expect((await catchRedirect(() => listRegistrations(params))).url).toBe("/dashboard");
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  it("a Client Portal identity gets the same denial as any other non-allowlisted identity", async () => {
    setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
    const spy = vi.spyOn(prisma.signupAttempt, "count");
    expect((await catchRedirect(() => getGrowthSummary(params, NOW))).url).toBe("/dashboard");
    expect(spy).not.toHaveBeenCalled();
  });

  it("the allowlisted admin gets real data", async () => {
    asAdmin();
    const summary = await getGrowthSummary(params, NOW);
    expect(summary.period.days).toBe(30);
    expect((await listRegistrations(params)).total).toBeGreaterThanOrEqual(0);
  });
});

describe("Growth summary — counting semantics", () => {
  it("separates signup identities, recorded attempts, activated accounts and workspaces; retries never inflate identities", async () => {
    asAdmin();
    const before = await getGrowthSummary({ periodDays: 30 }, NOW);

    // pending: one identity retried 3 times (3 attempts, 1 identity)
    await attempt({ count: 3, last: new Date("2027-06-14T09:00:00.000Z") });
    // activated: User exists and activation recorded
    const a = randomUUID();
    await attempt({ authUserId: a, activatedAt: new Date("2027-06-14T10:00:00.000Z") });
    await user(a, new Date("2027-06-14T10:00:00.000Z"));
    // activated by User existence although activatedAt is null (a missed activation write)
    const b = randomUUID();
    await attempt({ authUserId: b, count: 2 });
    await user(b, new Date("2027-06-14T11:00:00.000Z"));
    // a workspace registration is a different entity
    await org(`${MARKER} workspace`);

    const after = await getGrowthSummary({ periodDays: 30 }, NOW);

    expect(after.signups.identities - before.signups.identities).toBe(3);
    expect(after.signups.recordedAttempts - before.signups.recordedAttempts).toBe(3 + 1 + 2);
    expect(after.signups.activated - before.signups.activated).toBe(2);
    expect(after.signups.pending - before.signups.pending).toBe(1);
    expect(after.accounts.staffAccounts - before.accounts.staffAccounts).toBe(2);
    expect(after.inPeriod.workspacesCreated - before.inPeriod.workspacesCreated).toBe(1);
    expect(after.inPeriod.newSignupIdentities - before.inPeriod.newSignupIdentities).toBe(3);
    expect(after.inPeriod.newStaffAccounts - before.inPeriod.newStaffAccounts).toBe(2);
    expect(after.signups.statusComplete).toBe(true);
  });

  it("accounts with no recorded signup are counted separately and never appear as signup identities (no historical backfill)", async () => {
    asAdmin();
    const before = await getGrowthSummary({ periodDays: 30 }, NOW);
    await user(randomUUID(), new Date("2020-01-01T00:00:00.000Z")); // a pre-recording account with no SignupAttempt
    const after = await getGrowthSummary({ periodDays: 30 }, NOW);

    expect(after.accounts.staffAccounts - before.accounts.staffAccounts).toBe(1);
    expect(after.accounts.withoutRecordedSignup! - before.accounts.withoutRecordedSignup!).toBe(1);
    expect(after.signups.identities).toBe(before.signups.identities);
    expect(after.signups.activated).toBe(before.signups.activated);
  });

  it("reports the earliest LIVE recording time without inventing one", async () => {
    asAdmin();
    const summary = await getGrowthSummary({ periodDays: 30 }, NOW);
    expect(summary.recording.startedDay).toBe("2026-11-01");
    expect(summary.recording.earliestRecordedAt === null || summary.recording.earliestRecordedAt instanceof Date).toBe(true);
  });
});

describe("Growth summary — 7 / 30 / 90-day UTC windows (fixed now = 2027-06-15T10:00Z)", () => {
  it("includes events at the exact window start, excludes events just outside and in the future", async () => {
    asAdmin();
    const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
    const at = (d: Date, ms: number) => new Date(d.getTime() + ms);
    // 7-day window starts 2027-06-09T00:00Z, 30-day 2027-05-17, 90-day 2027-03-18.
    const starts = { 7: day("2027-06-09"), 30: day("2027-05-17"), 90: day("2027-03-18") };
    const tomorrow = day("2027-06-16");

    const baseline = {
      7: await getGrowthSummary({ periodDays: 7 }, NOW),
      30: await getGrowthSummary({ periodDays: 30 }, NOW),
      90: await getGrowthSummary({ periodDays: 90 }, NOW),
    };

    for (const start of Object.values(starts)) {
      await attempt({ first: start }); // exactly at the window start: inside
      await attempt({ first: at(start, -1) }); // one millisecond earlier: outside
    }
    await attempt({ first: at(tomorrow, -1) }); // last millisecond of today: inside everything
    await attempt({ first: tomorrow }); // first millisecond of tomorrow: excluded everywhere

    const after = {
      7: await getGrowthSummary({ periodDays: 7 }, NOW),
      30: await getGrowthSummary({ periodDays: 30 }, NOW),
      90: await getGrowthSummary({ periodDays: 90 }, NOW),
    };
    const delta = (d: 7 | 30 | 90) => after[d].inPeriod.newSignupIdentities - baseline[d].inPeriod.newSignupIdentities;

    // 7d sees: its start + 30d start-1 + 90d start-1 + 30d start + 90d start  (all later than Jun 9?) — computed explicitly:
    const expected = (d: 7 | 30 | 90) =>
      [...Object.values(starts).flatMap((s) => [s, at(s, -1)]), at(tomorrow, -1)].filter(
        (t) => t.getTime() >= starts[d].getTime() && t.getTime() < tomorrow.getTime(),
      ).length;
    expect(delta(7)).toBe(expected(7));
    expect(delta(30)).toBe(expected(30));
    expect(delta(90)).toBe(expected(90));
    expect(delta(7)).toBeLessThan(delta(30));
    expect(delta(30)).toBeLessThan(delta(90));

    // The trend agrees with the counts and has exactly one point per UTC day.
    expect(after[7].trend).toHaveLength(7);
    expect(after[30].trend).toHaveLength(30);
    expect(after[90].trend).toHaveLength(90);
    const trendTotal = (d: 7 | 30 | 90) => after[d].trend!.reduce((s, p) => s + (p.signups ?? 0), 0);
    expect(trendTotal(7) - (baseline[7].trend!.reduce((s, p) => s + (p.signups ?? 0), 0))).toBe(delta(7));
    expect(after[7].period.startsAt.toISOString()).toBe("2027-06-09T00:00:00.000Z");
    expect(after[7].period.endsBefore.toISOString()).toBe("2027-06-16T00:00:00.000Z");
    expect(after[90].period.predatesRecording).toBe(false);
  });

  it("flags a period that starts before recording began", async () => {
    asAdmin();
    const summary = await getGrowthSummary({ periodDays: 7 }, new Date("2026-11-03T12:00:00.000Z"));
    expect(summary.period.predatesRecording).toBe(true);
    expect(summary.trend![0]).toMatchObject({ date: "2026-10-28", signups: null });
    expect(summary.trend![6]).toMatchObject({ date: "2026-11-03" });
    expect(summary.trend![6].signups).not.toBeNull();
  });
});

describe("Registration directory", () => {
  it("returns one row per identity with the safe field set only, and derives status from User existence", async () => {
    asAdmin();
    const pendingEmail = `${MARKER}-dir-pending@example.com`;
    const activatedEmail = `${MARKER}-dir-activated@example.com`;
    const lateEmail = `${MARKER}-dir-late@example.com`;
    const goneEmail = `${MARKER}-dir-gone@example.com`;

    await attempt({ email: pendingEmail, count: 4, origin: "INVITED" });
    const a = randomUUID();
    await attempt({ authUserId: a, email: activatedEmail, activatedAt: new Date("2027-06-14T10:00:00.000Z") });
    const accountCreatedAt = new Date("2027-06-14T10:00:01.000Z");
    await user(a, accountCreatedAt);
    const b = randomUUID();
    await attempt({ authUserId: b, email: lateEmail });
    await user(b, new Date("2027-06-14T12:00:00.000Z"));
    await attempt({ email: goneEmail, activatedAt: new Date("2027-06-14T13:00:00.000Z") }); // activation recorded, no User

    const { rows, total } = await listRegistrations(parseGrowthParams({ q: `${MARKER}-dir-` }));
    expect(total).toBe(4);
    const byEmail = Object.fromEntries(rows.map((r) => [r.email, r]));

    expect(byEmail[pendingEmail]).toMatchObject({ status: "NO_APP_ACCOUNT", attemptCount: 4, origin: "INVITED", accountCreatedAt: null, workspaces: [] });
    expect(byEmail[activatedEmail]).toMatchObject({ status: "ACTIVATED" });
    expect(byEmail[activatedEmail].accountCreatedAt?.toISOString()).toBe(accountCreatedAt.toISOString());
    expect(byEmail[lateEmail]).toMatchObject({ status: "ACTIVATED" }); // activatedAt null but User exists
    expect(byEmail[lateEmail].accountCreatedAt).not.toBeNull();
    expect(byEmail[goneEmail]).toMatchObject({ status: "ACCOUNT_NOT_FOUND", accountCreatedAt: null });
    expect(byEmail[goneEmail].recordedActivationAt?.toISOString()).toBe("2027-06-14T13:00:00.000Z");

    const allowedKeys = [
      "accountCreatedAt", "attemptCount", "email", "firstAttemptedAt", "id", "lastAttemptedAt", "origin",
      "recordedActivationAt", "recordedVia", "status", "workspaceCount", "workspaces",
    ].sort();
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(allowedKeys);
      expect(JSON.stringify(row)).not.toMatch(/authUserId|password|token/i);
    }
  });

  it("lists linked workspaces for a multi-workspace user, bounds them, and counts the rest", async () => {
    asAdmin();
    const id = randomUUID();
    const email = `${MARKER}-multi@example.com`;
    await attempt({ authUserId: id, email, activatedAt: new Date("2027-06-14T10:00:00.000Z") });
    await user(id, new Date("2027-06-14T10:00:00.000Z"));
    for (let i = 0; i < 5; i += 1) {
      const o = await org(`${MARKER} multi ${i}`);
      await prisma.membership.create({ data: { userId: id, organizationId: o.id, role: i === 0 ? "OWNER" : "MEMBER" } });
    }

    const { rows } = await listRegistrations(parseGrowthParams({ q: `${MARKER}-multi@` }));

    expect(rows).toHaveLength(1);
    expect(rows[0].workspaceCount).toBe(5);
    expect(rows[0].workspaces).toHaveLength(3);
    expect(rows[0].workspaces.every((w) => w.name.startsWith(MARKER))).toBe(true);
  });

  it("searches by email case-insensitively, and an unmatched search is a clean empty result", async () => {
    asAdmin();
    await attempt({ email: `${MARKER}-search-Target@example.com` });
    expect((await listRegistrations(parseGrowthParams({ q: `${MARKER}-SEARCH-target` }))).total).toBe(1);
    expect(await listRegistrations(parseGrowthParams({ q: `${MARKER}-no-such-email-${randomUUID()}` }))).toEqual({ rows: [], total: 0 });
  });

  it("paginates with a stable order: pages are disjoint, complete, and tie-broken by id for identical sort keys", async () => {
    asAdmin();
    const tag = `${MARKER}-page`;
    const sameTime = new Date("2027-06-14T08:00:00.000Z");
    for (let i = 0; i < PAGE_SIZE + 2; i += 1) await attempt({ email: `${tag}-${String(i).padStart(2, "0")}@example.com`, first: sameTime, count: 1 });

    for (const sort of ["firstAttemptedAt:desc", "attemptCount:desc", "email:asc", "lastAttemptedAt:asc"]) {
      const p1 = await listRegistrations(parseGrowthParams({ q: tag, sort, page: "1" }));
      const p2 = await listRegistrations(parseGrowthParams({ q: tag, sort, page: "2" }));
      const p3 = await listRegistrations(parseGrowthParams({ q: tag, sort, page: "3" }));
      expect(p1.total).toBe(PAGE_SIZE + 2);
      expect(p1.rows).toHaveLength(PAGE_SIZE);
      expect(p2.rows).toHaveLength(2);
      expect(p3.rows).toHaveLength(0);
      const ids = [...p1.rows, ...p2.rows].map((r) => r.id);
      expect(new Set(ids).size).toBe(PAGE_SIZE + 2); // no duplicates, nothing missing
      const again = await listRegistrations(parseGrowthParams({ q: tag, sort, page: "1" }));
      expect(again.rows.map((r) => r.id)).toEqual(p1.rows.map((r) => r.id)); // repeatable
    }
    const emailAsc = await listRegistrations(parseGrowthParams({ q: tag, sort: "email:asc", page: "1" }));
    expect(emailAsc.rows.map((r) => r.email)).toEqual([...emailAsc.rows.map((r) => r.email)].sort());
  });

  it("always orders with a unique tiebreaker (id) after the chosen key, so equal keys cannot shuffle between pages", async () => {
    asAdmin();
    const spy = vi.spyOn(prisma.signupAttempt, "findMany");
    for (const sort of ["firstAttemptedAt:desc", "attemptCount:asc", "email:desc", "lastAttemptedAt:asc"]) {
      spy.mockClear();
      await listRegistrations(parseGrowthParams({ sort }));
      const orderBy = spy.mock.calls[0][0]!.orderBy as Array<Record<string, string>>;
      const [chosen, tiebreaker] = orderBy;
      expect(orderBy).toHaveLength(2);
      expect(Object.keys(chosen)[0]).toBe(sort.split(":")[0]);
      expect(Object.keys(tiebreaker)).toEqual(["id"]);
      expect(tiebreaker.id).toBe(sort.split(":")[1]);
    }
  });

  it("newest-first is the default order", async () => {
    asAdmin();
    const tag = `${MARKER}-order`;
    await attempt({ email: `${tag}-old@example.com`, first: new Date("2027-06-01T00:00:00.000Z") });
    await attempt({ email: `${tag}-new@example.com`, first: new Date("2027-06-10T00:00:00.000Z") });
    const { rows } = await listRegistrations(parseGrowthParams({ q: tag }));
    expect(rows.map((r) => r.email)).toEqual([`${tag}-new@example.com`, `${tag}-old@example.com`]);
  });
});
