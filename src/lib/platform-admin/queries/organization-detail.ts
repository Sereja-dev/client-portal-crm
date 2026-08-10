import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/enums";
import { getCompanyProfile, type CompanyProfileData } from "@/lib/organization-setup/company-profile";
import { getOrganizationEntitlements, type OrganizationEntitlements } from "@/lib/billing/entitlements";
import { formatActivity, type ActivityDisplayModel } from "@/lib/activity/format-activity";

const RECENT_ACTIVITY_TAKE = 15;
const PREVIEW_TAKE = 10;

const CLIENT_INVITATION_STATUSES = ["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"] as const;

export type OrganizationDetailHeader = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
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
  createdAt: Date;
};

export type PortalStatistics = {
  portalUsersCount: number;
  invitationsByStatus: Record<(typeof CLIENT_INVITATION_STATUSES)[number], number>;
};

export type OrganizationDetail = {
  organization: OrganizationDetailHeader;
  /** Business Identity section — reused verbatim from company-profile.ts, already organizationId-parameterized and "any member may view" (a strictly less privileged read than this). */
  businessIdentity: CompanyProfileData;
  /**
   * Subscription AND Usage sections — both come from this one call.
   * getOrganizationEntitlements() already returns subscriptionStatus/
   * accessMode/trialEndsAt/gracePeriodEndsAt (Subscription) alongside
   * currentMembers/currentClients/currentProjects/currentStorageBytes
   * against the plan's own limits (Usage) — no reason to call it twice or
   * reimplement either half.
   */
  entitlements: OrganizationEntitlements;
  recentActivity: { id: string; display: ActivityDisplayModel }[];
  staff: OrganizationStaffMember[];
  projects: { preview: OrganizationEntityPreview[]; total: number };
  clients: { preview: OrganizationEntityPreview[]; total: number };
  portalStatistics: PortalStatistics;
};

/**
 * Sale-Ready Phase C, PR3.1 (Organization Explorer — approved plan, §5).
 * One organization, every read unscoped by any session — the caller
 * (the /platform-admin/organizations/[id] page, PR3.3) is the only place
 * requirePlatformAdmin() needs to run; this function just takes whichever
 * organizationId the URL names. Returns null for an organizationId that
 * doesn't exist, so the page can render a real 404 rather than crash.
 */
export async function getOrganizationDetail(organizationId: string, now: Date): Promise<OrganizationDetail | null> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true, createdAt: true },
  });
  if (!organization) return null;

  const [
    businessIdentity,
    entitlements,
    activityRows,
    staffRows,
    projectRows,
    projectsTotal,
    clientRows,
    clientsTotal,
    portalUsersCount,
    invitationGroups,
  ] = await Promise.all([
    getCompanyProfile(organizationId),
    getOrganizationEntitlements(organizationId, { now }),
    prisma.activity.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT_ACTIVITY_TAKE,
      include: { actor: { select: { name: true, email: true } } },
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
      select: { id: true, name: true, status: true, createdAt: true },
    }),
    prisma.project.count({ where: { organizationId } }),
    prisma.client.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: PREVIEW_TAKE,
      select: { id: true, name: true, status: true, createdAt: true },
    }),
    prisma.client.count({ where: { organizationId } }),
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

  return {
    organization,
    businessIdentity,
    entitlements,
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
