import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/platform-admin/authorization";
import { computeAccessMode, type SubscriptionStateInput } from "@/lib/billing/access-mode";
import { DEFAULT_FREE_PLAN_KEY } from "@/lib/billing/plans";

export type PlatformDashboardKpis = {
  organizations: number;
  activeTrials: number;
  expiredTrials: number;
  activeSubscriptions: number;
  /**
   * Aqenra Free plan — organizations currently provisioned on the FREE
   * plan (src/lib/billing/plans.ts's own `DEFAULT_FREE_PLAN_KEY`), counted
   * by `planKey` alone, regardless of `status`. Every real call site that
   * creates a FREE subscription (createFreePlanSubscription,
   * src/lib/billing/provisioning.ts) always stamps `status: "ACTIVE"` and
   * no live code path ever transitions a FREE subscription away from that
   * — Free is never purchased, never cancelled, never suspended through
   * any existing flow — so filtering by status as well would be
   * redundant today. Counting by `planKey` alone (not status) is the
   * deliberately more conservative choice: it keeps reporting an
   * organization as "Free" even if some future, as-yet-nonexistent flow
   * ever left a FREE subscription in a different status, rather than
   * silently dropping it from this count the moment that happened.
   *
   * Distinct from, and deliberately NOT subtracted from, `activeTrials`
   * or `activeSubscriptions` above: a FREE organization's own Subscription
   * row has `status: "ACTIVE"` (never `"TRIALING"`), so it was already
   * excluded from `activeTrials` before this field existed, and it has
   * always been included in `activeSubscriptions`'s plain
   * `status: "ACTIVE"` count — unchanged here, since that metric's own
   * existing definition (every ACTIVE subscription, LEGACY/backfilled
   * rows included, keeping its original and nothing-new-added behavior)
   * is untouched by this field. These KPIs are independent counts, not a
   * mutually-exclusive partition — the same relationship every other
   * pair on this dashboard (e.g. "Organizations" and "Active trials")
   * already has.
   */
  freeOrganizations: number;
  staffUsers: number;
  portalUsers: number;
  clients: number;
  projects: number;
  tasks: number;
};

export type PlatformDashboardRegistrations = {
  today: number;
  last7Days: number;
};

export type NewestOrganization = {
  id: string;
  name: string;
  createdAt: Date;
};

export type PlatformDashboardData = {
  kpis: PlatformDashboardKpis;
  registrations: PlatformDashboardRegistrations;
  newestOrganizations: NewestOrganization[];
};

const NEWEST_ORGANIZATIONS_TAKE = 10;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * UTC calendar-day boundary — a platform-wide metric has no single
 * "local" timezone to anchor to (tenants span every timezone), so UTC is
 * the one unambiguous choice, matching how every other server-computed
 * timestamp in this app is already UTC.
 */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Classifies each TRIALING subscription via computeAccessMode() — the
 * exact same pure function billing enforcement already uses — rather than
 * reimplementing the trialEndsAt boundary as a second, parallel
 * inequality that could quietly drift from it. This is the one KPI too
 * small to express as a single Prisma count(): computeAccessMode takes a
 * whole subscription's state, so classifying "active vs. expired" means
 * loading the (today: tiny) set of TRIALING rows and running it per row.
 */
export function countActiveAndExpiredTrials(
  trialingSubscriptions: SubscriptionStateInput[],
  now: Date,
): { active: number; expired: number } {
  let active = 0;
  for (const subscription of trialingSubscriptions) {
    if (computeAccessMode(subscription, now) === "FULL_ACCESS") {
      active += 1;
    }
  }
  return { active, expired: trialingSubscriptions.length - active };
}

/**
 * Sale-Ready Phase C, PR2. Every field is a deliberately unscoped,
 * cross-organization read — see src/lib/platform-admin/authorization.ts
 * for why that's the entire point of this module, and
 * check-platform-admin-security.mjs for the check that keeps it that way.
 * One Promise.all, same shape as (dashboard)/dashboard/query.ts's own
 * getDashboardAnalytics.
 *
 * PLATFORM_ADMIN_EXECUTION_AUTHORIZATION_AUDIT correction: requirePlatformAdmin()
 * as the first awaited operation — see organization-detail.ts's own
 * getOrganizationDetail() doc comment for why the layout's own call alone
 * doesn't stop this function's platform-wide aggregate queries from
 * executing.
 */
export async function getPlatformDashboardData(now: Date): Promise<PlatformDashboardData> {
  await requirePlatformAdmin();

  const todayStart = startOfUtcDay(now);
  const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);

  const [
    organizations,
    trialingSubscriptions,
    activeSubscriptions,
    freeOrganizations,
    staffUsers,
    portalUsers,
    clients,
    projects,
    tasks,
    registrationsToday,
    registrationsLast7Days,
    newestOrganizations,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.subscription.findMany({
      where: { status: "TRIALING" },
      select: { status: true, trialEndsAt: true, currentPeriodEnd: true, gracePeriodEndsAt: true },
    }),
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.subscription.count({ where: { planKey: DEFAULT_FREE_PLAN_KEY } }),
    prisma.user.count(),
    prisma.portalUser.count(),
    prisma.client.count(),
    prisma.project.count(),
    prisma.task.count(),
    prisma.organization.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.organization.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      take: NEWEST_ORGANIZATIONS_TAKE,
      select: { id: true, name: true, createdAt: true },
    }),
  ]);

  const { active: activeTrials, expired: expiredTrials } = countActiveAndExpiredTrials(trialingSubscriptions, now);

  return {
    kpis: {
      organizations,
      activeTrials,
      expiredTrials,
      activeSubscriptions,
      freeOrganizations,
      staffUsers,
      portalUsers,
      clients,
      projects,
      tasks,
    },
    registrations: { today: registrationsToday, last7Days: registrationsLast7Days },
    newestOrganizations,
  };
}
