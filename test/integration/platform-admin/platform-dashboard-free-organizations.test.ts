import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getPlatformDashboardData } from "@/lib/platform-admin/queries/platform-dashboard";
import { setMockAuthUser, resetAuthMock } from "../../support/auth-mock";

/**
 * Platform Admin dashboard — "Free organizations" KPI (Aqenra Free plan
 * correction). This is a platform-wide, unscoped read (see
 * getPlatformDashboardData's own doc comment), so every assertion here is
 * a before/after DELTA for a controlled set of Subscription rows this
 * file itself creates and tears down — never an absolute count, which
 * would be brittle against whatever else already exists in the shared
 * integration database (the same reasoning test/e2e/
 * platform-admin-dashboard.spec.ts's own header comment already gives for
 * its identical technique).
 *
 * Mirrors execution-authorization.test.ts's own identity-mocking pattern
 * exactly; Platform Admin access control itself is already fully proven
 * there (zero Prisma calls for unauthenticated/non-admin, real data for
 * an allowlisted admin) and is not re-proven here, since this field adds
 * no new authorization branch — it is read inside the exact same,
 * already-guarded getPlatformDashboardData() call.
 */

const PLATFORM_ADMIN_TEST_EMAIL = "platform-admin-free-orgs-kpi-test@example.com";
const ORIGINAL_PLATFORM_ADMIN_EMAILS = process.env.PLATFORM_ADMIN_EMAILS;

beforeAll(() => {
  process.env.PLATFORM_ADMIN_EMAILS = PLATFORM_ADMIN_TEST_EMAIL;
});

afterEach(() => {
  resetAuthMock();
});

afterAll(() => {
  if (ORIGINAL_PLATFORM_ADMIN_EMAILS === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL_PLATFORM_ADMIN_EMAILS;
});

function asPlatformAdmin() {
  setMockAuthUser({ id: randomUUID(), email: PLATFORM_ADMIN_TEST_EMAIL });
}

async function createOrgWithSubscription(data: {
  planKey: string;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE" | "UNPAID";
}) {
  const org = await prisma.organization.create({
    data: { name: `KPI test org ${randomUUID().slice(0, 8)}`, slug: `kpi-test-${randomUUID().slice(0, 8)}` },
  });
  const now = new Date();
  // A real TRIALING row must have a genuinely future trialEndsAt to be
  // classified "active" by computeAccessMode — same `now` as createdAt
  // would already read as expired by the time getPlatformDashboardData's
  // own, separately-called `new Date()` runs a moment later.
  const trialEndsAt = data.status === "TRIALING" ? new Date(now.getTime() + 24 * 60 * 60 * 1000) : now;
  await prisma.subscription.create({
    data: {
      organizationId: org.id,
      planKey: data.planKey,
      status: data.status,
      trialStartedAt: now,
      trialEndsAt,
    },
  });
  return org;
}

async function cleanupOrg(org: { id: string }) {
  await prisma.organization.delete({ where: { id: org.id } });
}

describe("getPlatformDashboardData — Free organizations KPI", () => {
  it("counts a newly created FREE-plan organization, by exactly one", async () => {
    asPlatformAdmin();
    const before = (await getPlatformDashboardData(new Date())).kpis.freeOrganizations;

    const org = await createOrgWithSubscription({ planKey: "FREE", status: "ACTIVE" });
    try {
      const after = (await getPlatformDashboardData(new Date())).kpis.freeOrganizations;
      expect(after).toBe(before + 1);
    } finally {
      await cleanupOrg(org);
    }
  });

  it("counts multiple newly created FREE-plan organizations, by exactly that many", async () => {
    asPlatformAdmin();
    const before = (await getPlatformDashboardData(new Date())).kpis.freeOrganizations;

    const orgs = await Promise.all([
      createOrgWithSubscription({ planKey: "FREE", status: "ACTIVE" }),
      createOrgWithSubscription({ planKey: "FREE", status: "ACTIVE" }),
      createOrgWithSubscription({ planKey: "FREE", status: "ACTIVE" }),
    ]);
    try {
      const after = (await getPlatformDashboardData(new Date())).kpis.freeOrganizations;
      expect(after).toBe(before + 3);
    } finally {
      await Promise.all(orgs.map((org) => cleanupOrg(org)));
    }
  });

  it("a real TRIALING subscription is counted in activeTrials, never in freeOrganizations", async () => {
    asPlatformAdmin();
    const before = await getPlatformDashboardData(new Date());

    const org = await createOrgWithSubscription({ planKey: "TRIAL", status: "TRIALING" });
    try {
      const after = await getPlatformDashboardData(new Date());
      expect(after.kpis.activeTrials).toBe(before.kpis.activeTrials + 1);
      expect(after.kpis.freeOrganizations).toBe(before.kpis.freeOrganizations);
    } finally {
      await cleanupOrg(org);
    }
  });

  it("a LEGACY (pre-billing, backfilled) organization is counted in activeSubscriptions, never in freeOrganizations", async () => {
    asPlatformAdmin();
    const before = await getPlatformDashboardData(new Date());

    const org = await createOrgWithSubscription({ planKey: "LEGACY", status: "ACTIVE" });
    try {
      const after = await getPlatformDashboardData(new Date());
      expect(after.kpis.activeSubscriptions).toBe(before.kpis.activeSubscriptions + 1);
      expect(after.kpis.freeOrganizations).toBe(before.kpis.freeOrganizations);
    } finally {
      await cleanupOrg(org);
    }
  });

  it("a STARTER organization — even one that somehow reached ACTIVE status with no real checkout having run — is counted in activeSubscriptions, never in freeOrganizations", async () => {
    asPlatformAdmin();
    const before = await getPlatformDashboardData(new Date());

    const org = await createOrgWithSubscription({ planKey: "STARTER", status: "ACTIVE" });
    try {
      const after = await getPlatformDashboardData(new Date());
      expect(after.kpis.activeSubscriptions).toBe(before.kpis.activeSubscriptions + 1);
      expect(after.kpis.freeOrganizations).toBe(before.kpis.freeOrganizations);
    } finally {
      await cleanupOrg(org);
    }
  });

  it("a FREE organization is also counted in activeSubscriptions — the two KPIs are independent counts, not a mutually exclusive partition", async () => {
    asPlatformAdmin();
    const before = await getPlatformDashboardData(new Date());

    const org = await createOrgWithSubscription({ planKey: "FREE", status: "ACTIVE" });
    try {
      const after = await getPlatformDashboardData(new Date());
      expect(after.kpis.freeOrganizations).toBe(before.kpis.freeOrganizations + 1);
      expect(after.kpis.activeSubscriptions).toBe(before.kpis.activeSubscriptions + 1);
    } finally {
      await cleanupOrg(org);
    }
  });

  it("a FREE subscription in a non-ACTIVE status is still counted — by planKey alone, deliberately never by status", async () => {
    asPlatformAdmin();
    const before = (await getPlatformDashboardData(new Date())).kpis.freeOrganizations;

    // No live code path today ever leaves a FREE subscription in a status
    // other than ACTIVE — this proves the query's own documented,
    // deliberately status-independent definition, not a realistic
    // production state.
    const org = await createOrgWithSubscription({ planKey: "FREE", status: "CANCELED" });
    try {
      const after = (await getPlatformDashboardData(new Date())).kpis.freeOrganizations;
      expect(after).toBe(before + 1);
    } finally {
      await cleanupOrg(org);
    }
  });
});
