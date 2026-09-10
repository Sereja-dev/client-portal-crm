import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/platform-admin/authorization";
import type { Role } from "@/generated/prisma/enums";
import { getCompanyProfile, type CompanyProfileData } from "@/lib/organization-setup/company-profile";
import { getOrganizationEntitlements, type OrganizationEntitlements } from "@/lib/billing/entitlements";
import { getPlan } from "@/lib/billing/plans";
import { getOrganizationOnboardingProgress } from "@/lib/onboarding/progress";
import { toOnboardingProgressView, type OnboardingProgressView } from "@/lib/platform-admin/onboarding-progress-view";
import { formatActivity, type ActivityDisplayModel } from "@/lib/activity/format-activity";
import { classifyOrganizationLifecycle, type OrganizationLifecycleStatus } from "./organizations";
import type { SubscriptionStateInput } from "@/lib/billing/access-mode";
import type { CustomStatusColor } from "@/generated/prisma/enums";

const RECENT_ACTIVITY_TAKE = 15;
const PREVIEW_TAKE = 10;
/** Recent Admin Actions — matches PREVIEW_TAKE's own bound; this is a preview of the same shape (bounded, newest-first, no pagination), just against PlatformAdminAuditEvent instead of Client/Project. */
const RECENT_ADMIN_ACTIONS_TAKE = 10;

const CLIENT_INVITATION_STATUSES = ["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"] as const;

export type OrganizationDetailHeader = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  /**
   * Platform Admin Organization Suspension, PR 2. The operator-override
   * field itself (PR 1's schema) — null means active. Deliberately never
   * folded into `lifecycleStatus` below: that field is a distinct,
   * billing-derived classification (see classifyOrganizationLifecycle's
   * own doc comment) with its own unrelated "SUSPENDED" bucket, and this
   * one must never be confused with or feed into it.
   */
  suspendedAt: Date | null;
};

export type OrganizationStaffMember = {
  id: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: Date;
};

export type OrganizationEntityPreview = {
  id: string;
  name: string;
  status: string;
  /**
   * Custom Statuses Phase 2A Completion Pass (Section C) — only
   * label+color are ever selected; resolveStatusPresentation() is the
   * one place this page turns it (plus the legacy `status` above) into
   * an actual badge. Shared by both Client and Project previews below,
   * exactly like `status` already was.
   */
  statusDefinition: { label: string; color: CustomStatusColor | null } | null;
  createdAt: Date;
};

export type PortalStatistics = {
  portalUsersCount: number;
  invitationsByStatus: Record<(typeof CLIENT_INVITATION_STATUSES)[number], number>;
};

export type OrganizationOwner = {
  id: string;
  name: string;
  email: string;
};

/**
 * Recent Admin Actions (Organization Detail). Deliberately no `id` and
 * no `organizationId` field here at all — not merely unrendered, never
 * selected from the database in the first place (see the `select` this
 * type backs), so there is nothing for a future edit to accidentally
 * expose. `action`/`reasonCode` stay as their raw stored values here;
 * formatAuditActionLabel()/formatAuditReasonLabel() (audit-event-
 * labels.ts) do the display-safe formatting at render time, the same
 * "format at the edge, not in the query" split this file already uses
 * for lifecycleStatus/planDisplayName below.
 */
export type RecentAdminAction = {
  action: string;
  reasonCode: string | null;
  actorEmail: string;
  createdAt: Date;
};

export type OrganizationDetail = {
  organization: OrganizationDetailHeader;
  /** Business Identity section — reused verbatim from company-profile.ts, already organizationId-parameterized and "any member may view" (a strictly less privileged read than this). */
  businessIdentity: CompanyProfileData;
  /**
   * Subscription AND (entitlement-vs-limit) Usage — both come from this
   * one call. getOrganizationEntitlements() already returns
   * subscriptionStatus/accessMode/trialEndsAt/gracePeriodEndsAt
   * alongside currentMembers/currentClients/currentProjects/
   * currentStorageBytes against the plan's own limits — no reason to
   * call it twice or reimplement either half.
   */
  entitlements: OrganizationEntitlements;
  /** Human-readable plan name for entitlements.planKey — getPlan() is a pure, in-memory catalog lookup, not a second query. */
  planDisplayName: string;
  /**
   * The one lifecycle field getOrganizationEntitlements() doesn't expose
   * (it returns the raw SubscriptionStatus, not the 7-bucket business
   * classification) — computed via the exact same classifyOrganizationLifecycle()
   * the Organization Explorer list (organizations.ts) already uses, from
   * a single small raw Subscription read this file needs anyway for
   * trialStartedAt (below) — never a second definition of "lifecycle."
   */
  lifecycleStatus: OrganizationLifecycleStatus;
  /** Not part of OrganizationEntitlements' own return shape — read from the same raw Subscription row lifecycleStatus is computed from, at no extra query cost. Null for a legacy org (no Subscription row) or one that was never on a trial. */
  trialStartedAt: Date | null;
  /** Derived from `staff` below (role === OWNER) — zero extra queries, same organization every membership already belongs to. Null only if an organization somehow has no OWNER membership (shouldn't happen given this app's own invariants, but never assumed). */
  owner: OrganizationOwner | null;
  /**
   * Read-only Platform Admin view of the same authoritative onboarding
   * engine the tenant Dashboard already uses
   * (getOrganizationOnboardingProgress() — src/lib/onboarding/
   * progress.ts), narrowed to an operator-safe shape by
   * toOnboardingProgressView() (onboarding-progress-view.ts) before it
   * ever reaches this type — no targetHref, no actionable/blockedReason/
   * skippable/completionSource, no raw onboarding-row id. A distinct
   * category from lifecycleStatus/entitlements above: never conflated
   * with subscription/billing readiness, and unaffected by
   * organization.suspendedAt — onboarding progress is a historical fact,
   * orthogonal to the current suspension override, and is computed and
   * shown identically whether or not the organization is suspended.
   */
  onboarding: OnboardingProgressView;
  recentActivity: { id: string; display: ActivityDisplayModel }[];
  recentAdminActions: RecentAdminAction[];
  staff: OrganizationStaffMember[];
  projects: { preview: OrganizationEntityPreview[]; total: number };
  clients: { preview: OrganizationEntityPreview[]; total: number };
  /** Standalone Usage section (Clients/Projects/Tasks totals) — distinct from entitlements' own usage-vs-limits comparison above. clients.total/projects.total are already fetched; tasksTotal is the one genuinely new count this section needs. */
  tasksTotal: number;
  portalStatistics: PortalStatistics;
};

/**
 * Sale-Ready Phase C, PR3.1/PR3.3 (Organization Explorer — approved
 * plan, §5). One organization, every read unscoped by any session.
 *
 * PLATFORM_ADMIN_EXECUTION_AUTHORIZATION_AUDIT correction: the layout's
 * own requirePlatformAdmin() call does NOT stop this function's own
 * Prisma calls from executing — Next.js renders layouts and pages in
 * parallel by default (see authorization.ts's own doc comment on
 * requirePlatformAdmin for the exact installed-docs citations and the
 * deterministic local reproduction). requirePlatformAdmin() must
 * therefore also be called here, as the first awaited operation, before
 * organizationId is ever used in a query — cache()-memoized, so this is
 * not a second real auth check per request. Returns null for an
 * organizationId that doesn't exist, so the page can render a real 404
 * rather than crash.
 */
export async function getOrganizationDetail(organizationId: string, now: Date): Promise<OrganizationDetail | null> {
  await requirePlatformAdmin();

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true, createdAt: true, suspendedAt: true },
  });
  if (!organization) return null;

  const [
    businessIdentity,
    entitlements,
    onboardingProgress,
    rawSubscription,
    activityRows,
    recentAdminActions,
    staffRows,
    projectRows,
    projectsTotal,
    clientRows,
    clientsTotal,
    tasksTotal,
    portalUsersCount,
    invitationGroups,
  ] = await Promise.all([
    getCompanyProfile(organizationId),
    getOrganizationEntitlements(organizationId, { now }),
    // getOrganizationOnboardingProgress() already resolves organizationId
    // as a plain parameter (never resolved from a tenant session) — the
    // same "just an organizationId in, a real read out" shape every
    // other reader in this file already has. Nothing about this call is
    // Platform-Admin-specific; the narrowing to an operator-safe shape
    // happens after this Promise.all resolves, via
    // toOnboardingProgressView() below.
    getOrganizationOnboardingProgress(organizationId),
    // getOrganizationEntitlements() already reads a Subscription row
    // internally, but doesn't expose trialStartedAt or a form
    // classifyOrganizationLifecycle() can consume directly — this one
    // small, targeted read (a single row by its own unique index) serves
    // both, rather than either reimplementing lifecycle classification or
    // leaving "Trial start" unshown.
    prisma.subscription.findUnique({
      where: { organizationId },
      select: { status: true, trialStartedAt: true, trialEndsAt: true, currentPeriodEnd: true, gracePeriodEndsAt: true },
    }),
    prisma.activity.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT_ACTIVITY_TAKE,
      include: { actor: { select: { name: true, email: true } } },
    }),
    // Recent Admin Actions. `id` and `organizationId` are deliberately
    // absent from this select — not merely unrendered downstream, never
    // read from the database at all (this page already establishes
    // organization identity once, in its own header; duplicating a raw
    // id/organizationId per row here would add exposure with no reader
    // benefit). `id` is still the query's own tie-break column, which
    // orderBy can reference without selecting it.
    prisma.platformAdminAuditEvent.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT_ADMIN_ACTIONS_TAKE,
      select: { action: true, reasonCode: true, actorEmail: true, createdAt: true },
    }),
    prisma.membership.findMany({
      where: { organizationId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.project.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: PREVIEW_TAKE,
      select: {
        id: true,
        name: true,
        status: true,
        statusDefinition: { select: { label: true, color: true } },
        createdAt: true,
      },
    }),
    prisma.project.count({ where: { organizationId } }),
    prisma.client.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: PREVIEW_TAKE,
      select: {
        id: true,
        name: true,
        status: true,
        statusDefinition: { select: { label: true, color: true } },
        createdAt: true,
      },
    }),
    prisma.client.count({ where: { organizationId } }),
    prisma.task.count({ where: { organizationId } }),
    prisma.portalUser.count({ where: { client: { organizationId } } }),
    prisma.clientInvitation.groupBy({
      by: ["status"],
      where: { client: { organizationId } },
      _count: true,
    }),
  ]);

  const invitationCounts = new Map(invitationGroups.map((group) => [group.status, group._count]));
  const invitationsByStatus = Object.fromEntries(
    CLIENT_INVITATION_STATUSES.map((status) => [status, invitationCounts.get(status) ?? 0]),
  ) as PortalStatistics["invitationsByStatus"];

  const subscriptionInput: SubscriptionStateInput | null = rawSubscription
    ? {
        status: rawSubscription.status,
        trialEndsAt: rawSubscription.trialEndsAt,
        currentPeriodEnd: rawSubscription.currentPeriodEnd,
        gracePeriodEndsAt: rawSubscription.gracePeriodEndsAt,
      }
    : null;

  const ownerMembership = staffRows.find((row) => row.role === "OWNER");

  return {
    organization,
    businessIdentity,
    entitlements,
    planDisplayName: getPlan(entitlements.planKey).displayName,
    lifecycleStatus: classifyOrganizationLifecycle(subscriptionInput, now),
    trialStartedAt: rawSubscription?.trialStartedAt ?? null,
    owner: ownerMembership
      ? { id: ownerMembership.user.id, name: ownerMembership.user.name, email: ownerMembership.user.email }
      : null,
    onboarding: toOnboardingProgressView(onboardingProgress),
    tasksTotal,
    recentActivity: activityRows.map((row) => ({
      id: row.id,
      display: formatActivity({
        entityType: row.entityType,
        action: row.action,
        metadata: row.metadata,
        actor: row.actor,
        createdAt: row.createdAt,
      }),
    })),
    recentAdminActions,
    staff: staffRows.map((row) => ({
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      role: row.role,
      joinedAt: row.createdAt,
    })),
    projects: { preview: projectRows, total: projectsTotal },
    clients: { preview: clientRows, total: clientsTotal },
    portalStatistics: { portalUsersCount, invitationsByStatus },
  };
}
