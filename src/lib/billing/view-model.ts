import type { Role, SubscriptionStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getOrganizationEntitlements, type OrganizationEntitlements } from "./entitlements";
import { countReservedPendingInvitations } from "./usage";
import { PLAN_CATALOG, ALL_PLAN_KEYS, type PlanKey } from "./plans";
import { getBillingProviderAvailability, type BillingProviderAvailability } from "./provider-availability";
import { isFreeBetaModeEnabled } from "./free-beta-mode";
import {
  computeUsageStatus,
  formatCountLabel,
  formatLimitLabel,
  formatStorageLabel,
  type UsageStatus,
} from "./usage-presentation";

/**
 * Billing & Subscriptions Stage 3 (this stage's own §4). The single
 * server-side view-model builder every Billing UI component renders from —
 * components never recompute plan/status/usage semantics themselves, they
 * only format what this module already decided. Mirrors this codebase's
 * existing "one function, one call site" convention (getOrganizationEntitlements
 * is itself exactly this kind of function one layer down).
 *
 * Every field below is deliberately UI-safe: no providerCustomerId, no
 * providerSubscriptionId, no raw provider event data, no database error
 * detail. Stage 3 never has any of these to leak in the first place (no
 * provider is connected), but the shape is written as if one already were,
 * so Stage 4 wiring a real provider in doesn't require touching this
 * contract's field list — only what populates providerConfigured/checkout/
 * portal availability.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_APPROACHING_DAYS = 3;

export type NoticeTone = "info" | "warning" | "danger" | "neutral" | "success";

export type BillingNotice = {
  id: string;
  tone: NoticeTone;
  message: string;
};

export type UsageRowViewModel = {
  key: "members" | "clients" | "projects" | "storage";
  label: string;
  current: number;
  limit: number | null;
  unlimited: boolean;
  percentage: number | null;
  status: UsageStatus;
  currentLabel: string;
  limitLabel: string;
  /** A text equivalent of the row's state, safe to render even for unlimited/zero-limit rows where a numeric percentage would be misleading or absent. */
  accessibleSummary: string;
};

export type PlanCardViewModel = {
  planKey: PlanKey;
  displayName: string;
  maxMembers: number;
  maxClients: number | null;
  maxProjects: number | null;
  maxStorageBytes: number;
  description: string;
  isCurrentPlan: boolean;
  ctaLabel: "Current plan" | "Upgrade" | "Downgrade";
  ctaDisabled: boolean;
};

export type BillingManagementPermissions = {
  role: Role;
  /** OWNER only — see this stage's own §3/§8 note in requestPlanChangeAction/manageSubscriptionAction for the chosen, single, consistent UX (disabled + explanation for non-owners, never hidden). */
  canManagePlan: boolean;
  canManageSubscription: boolean;
};

export type BillingPageViewModel = {
  currentPlanKey: PlanKey;
  currentPlanName: string;
  statusLabel: SubscriptionStatus | "LEGACY";
  statusTone: NoticeTone;
  statusNotice: BillingNotice;
  accessMode: OrganizationEntitlements["accessMode"];
  accessModeBanner: BillingNotice | null;
  isLegacy: boolean;
  /**
   * Free Public Beta, Slice 1. The one explicit boolean every Billing UI
   * component reads to decide whether to show beta messaging / hide paid
   * plan selection and checkout — mirrors `providerAvailability.configured`
   * being threaded through the same way. Components never read
   * `process.env.FREE_BETA_MODE` themselves.
   */
  freeBetaMode: boolean;

  trialEndsAt: Date | null;
  trialDaysRemaining: number | null;
  trialApproachingEnd: boolean;
  trialExpired: boolean;

  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  gracePeriodEndsAt: Date | null;

  usageRows: UsageRowViewModel[];
  availablePlans: PlanCardViewModel[];
  permissions: BillingManagementPermissions;

  providerConfigured: false;
  providerAvailability: BillingProviderAvailability;
};

function trialDaysRemaining(trialEndsAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS));
}

function formatDayCount(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * Free Public Beta, Slice 1. Checked before the status switch below and
 * unconditional on `subscriptionStatus` — while the beta is running, this
 * is the ONLY status notice any org ever sees, replacing every one of
 * "Trial ends in N days.", "Your trial has ended...", and every other
 * status-driven message (ACTIVE/PAST_DUE/CANCELED/UNPAID/INCOMPLETE) that
 * could otherwise still surface for a pre-existing or sandbox-tested
 * Subscription row. Deliberately does not promise permanent free access
 * or imply automatic future billing — states only the current fact.
 */
function buildFreeBetaStatusNotice(): BillingNotice {
  return {
    id: "status",
    tone: "info",
    message: "You're using Aqenra for free during our public beta. No payment method is required.",
  };
}

function buildStatusNotice(
  entitlements: OrganizationEntitlements,
  now: Date,
  currentPeriodEnd: Date | null,
  freeBetaMode: boolean,
): BillingNotice {
  if (freeBetaMode) {
    return buildFreeBetaStatusNotice();
  }

  const { subscriptionStatus, trialEndsAt, gracePeriodEndsAt } = entitlements;

  switch (subscriptionStatus) {
    case "TRIALING": {
      if (!trialEndsAt) {
        return { id: "status", tone: "info", message: "Your trial is active." };
      }
      const expired = now.getTime() > trialEndsAt.getTime();
      if (expired) {
        // P1 fix: entitlements.accessMode already reflects
        // buildOrganizationEntitlements' own provider-unconfigured
        // override (entitlements.ts) — the exact same corrected value
        // server-side write enforcement itself reads, never a second,
        // independent "is billing disabled" check here. If it's still
        // FULL_ACCESS despite the trial's calendar expiry, nothing is
        // actually being restricted right now, so this must never claim
        // an "Upgrade" is required — there is no real checkout to send
        // anyone to (requestPlanChangeAction's own "Billing provider is
        // not configured" refusal is the same underlying fact, said
        // honestly instead of as a false paywall).
        if (entitlements.accessMode !== "FULL_ACCESS") {
          return {
            id: "status",
            tone: "danger",
            message: "Your trial has ended. Upgrade to continue creating new records.",
          };
        }
        return {
          id: "status",
          tone: "info",
          message: "Your trial has ended. Billing isn't configured yet, so your workspace keeps full access for now.",
        };
      }
      const days = trialDaysRemaining(trialEndsAt, now);
      const approaching = days <= TRIAL_APPROACHING_DAYS;
      return {
        id: "status",
        tone: approaching ? "warning" : "info",
        message: `Trial ends in ${formatDayCount(days)}.`,
      };
    }

    case "ACTIVE":
      return { id: "status", tone: "success", message: "Your subscription is active." };

    case "PAST_DUE": {
      const inGrace = gracePeriodEndsAt !== null && now.getTime() <= gracePeriodEndsAt.getTime();
      if (inGrace) {
        return {
          id: "status",
          tone: "warning",
          message: "Payment is past due. Access remains available during the grace period.",
        };
      }
      return {
        id: "status",
        tone: "danger",
        message: "Payment is past due and the grace period has ended. Your workspace is currently read-only.",
      };
    }

    case "CANCELED": {
      const stillInPeriod = currentPeriodEnd !== null && now.getTime() <= currentPeriodEnd.getTime();
      if (stillInPeriod) {
        return {
          id: "status",
          tone: "warning",
          message: "Your subscription is canceled and will end at the close of the current period. Access continues until then.",
        };
      }
      return {
        id: "status",
        tone: "danger",
        message: "Your subscription has ended. Your workspace is currently read-only.",
      };
    }

    case "INCOMPLETE":
      return {
        id: "status",
        tone: "warning",
        message: "Your subscription setup is incomplete. Some actions may be limited until this is resolved.",
      };

    case "UNPAID":
      return {
        id: "status",
        tone: "danger",
        message: "Your subscription is unpaid. Your workspace is currently read-only.",
      };

    case "LEGACY":
      return {
        id: "status",
        tone: "neutral",
        message: "This workspace uses legacy unrestricted access.",
      };

    default: {
      const exhaustive: never = subscriptionStatus;
      throw new Error(`Unhandled subscriptionStatus in buildStatusNotice: ${String(exhaustive)}`);
    }
  }
}

function buildAccessModeBanner(accessMode: OrganizationEntitlements["accessMode"]): BillingNotice | null {
  switch (accessMode) {
    case "FULL_ACCESS":
      return null;
    case "LIMITED_WRITES":
      return {
        id: "access-mode",
        tone: "warning",
        message: "Some new actions are temporarily limited. Existing data remains fully accessible.",
      };
    case "READ_ONLY":
      return {
        id: "access-mode",
        tone: "danger",
        message:
          "Your workspace is currently read-only. Existing data remains accessible, but new items can't be created until this is resolved.",
      };
    default: {
      const exhaustive: never = accessMode;
      throw new Error(`Unhandled accessMode in buildAccessModeBanner: ${String(exhaustive)}`);
    }
  }
}

function statusToTone(status: SubscriptionStatus | "LEGACY"): NoticeTone {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "TRIALING":
      return "info";
    case "PAST_DUE":
    case "INCOMPLETE":
      return "warning";
    case "CANCELED":
    case "UNPAID":
      return "danger";
    case "LEGACY":
      return "neutral";
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled subscriptionStatus in statusToTone: ${String(exhaustive)}`);
    }
  }
}

function buildUsageRow(
  key: UsageRowViewModel["key"],
  label: string,
  current: number,
  limit: number | null,
  formatter: (value: number) => string,
): UsageRowViewModel {
  const { percentage, status, unlimited } = computeUsageStatus(current, limit);
  const currentLabel = formatter(current);
  const limitLabel = formatLimitLabel(limit, formatter);

  const accessibleSummary = unlimited
    ? `${currentLabel} used, unlimited.`
    : `${currentLabel} of ${limitLabel} used (${status === "EXCEEDED" ? "over limit" : status.toLowerCase()}).`;

  return {
    key,
    label,
    current,
    limit,
    unlimited,
    percentage,
    status,
    currentLabel,
    limitLabel,
    accessibleSummary,
  };
}

function buildUsageRows(entitlements: OrganizationEntitlements, pendingInvitations: number): UsageRowViewModel[] {
  const membersForDisplay = entitlements.currentMembers + pendingInvitations;

  return [
    buildUsageRow("members", "Members", membersForDisplay, entitlements.maxMembers, formatCountLabel),
    buildUsageRow("clients", "Clients", entitlements.currentClients, entitlements.maxClients, formatCountLabel),
    buildUsageRow("projects", "Projects", entitlements.currentProjects, entitlements.maxProjects, formatCountLabel),
    buildUsageRow(
      "storage",
      "Storage",
      entitlements.currentStorageBytes,
      entitlements.maxStorageBytes,
      formatStorageLabel,
    ),
  ];
}

function planDescription(planKey: PlanKey): string {
  switch (planKey) {
    case "STARTER":
      return "For small teams getting started.";
    case "PRO":
      return "For growing teams that need more room.";
    case "TRIAL":
      return "Full access while you evaluate the product.";
    case "LEGACY":
      return "Grandfathered unrestricted access.";
    default: {
      const exhaustive: never = planKey;
      throw new Error(`Unhandled planKey in planDescription: ${String(exhaustive)}`);
    }
  }
}

/**
 * Starter and Pro only — the two real, purchasable plans (this stage's own
 * §7: TRIAL/LEGACY are never sold, never shown as a card).
 *
 * `providerConfigured` (billing provider-unavailable UI remediation):
 * requestPlanChangeAction already fails closed with "Billing provider is
 * not configured." when no real adapter is active — a non-current plan's
 * CTA must not stay clickable only to dead-end there. This never
 * re-resolves provider state itself; the caller already has
 * providerAvailability.configured resolved once, from
 * getBillingProviderAvailability(), and passes it straight through.
 *
 * `freeBetaMode` (Free Public Beta, Slice 1): defense-in-depth only — the
 * Billing page's PlansSection component already hides this entire section
 * when `freeBetaMode` is true (mirroring how it already hides for
 * `!providerConfigured`), so this array is normally never even rendered
 * during the beta. Still disabling every CTA here too means any other
 * future consumer of this view-model can never accidentally show a live
 * Upgrade button during the beta, and `requestPlanChangeAction` itself
 * independently fails closed regardless (see that action's own
 * freeBetaMode check) — three independent layers, never relying on UI
 * hiding alone.
 */
function buildAvailablePlans(
  currentPlanKey: PlanKey,
  canManagePlan: boolean,
  providerConfigured: boolean,
  freeBetaMode: boolean,
): PlanCardViewModel[] {
  const purchasablePlanKeys = ALL_PLAN_KEYS.filter((key) => PLAN_CATALOG[key].billingAvailable);
  const currentIndex = purchasablePlanKeys.indexOf(currentPlanKey);

  return purchasablePlanKeys.map((planKey) => {
    const plan = PLAN_CATALOG[planKey];
    const isCurrentPlan = planKey === currentPlanKey;
    const index = purchasablePlanKeys.indexOf(planKey);

    let ctaLabel: PlanCardViewModel["ctaLabel"] = "Upgrade";
    if (isCurrentPlan) {
      ctaLabel = "Current plan";
    } else if (currentIndex !== -1 && index < currentIndex) {
      ctaLabel = "Downgrade";
    }

    return {
      planKey,
      displayName: plan.displayName,
      maxMembers: plan.limits.maxMembers,
      maxClients: plan.limits.maxClients,
      maxProjects: plan.limits.maxProjects,
      maxStorageBytes: plan.limits.maxStorageBytes,
      description: planDescription(planKey),
      isCurrentPlan,
      ctaLabel,
      ctaDisabled: isCurrentPlan || !canManagePlan || !providerConfigured || freeBetaMode,
    };
  });
}

/**
 * Pure — no I/O. Takes already-resolved entitlements (from
 * getOrganizationEntitlements, never recomputed here) plus the caller's own
 * `now`/role/pending-invitation count, returns the full page view-model.
 * `entitlements.planKey` is always a real PlanKey by the time it reaches
 * here (buildOrganizationEntitlements already falls an unrecognized
 * Subscription.planKey back to LEGACY) — the PLAN_CATALOG lookup below is
 * still defensive (falls back to a generic "Custom plan" label rather than
 * throwing) so a future data shape this function wasn't updated for still
 * renders instead of crashing the page, per this stage's own §12 rule.
 */
export function buildBillingPageViewModel({
  entitlements,
  pendingInvitations,
  role,
  now,
  providerAvailability,
  freeBetaMode,
  currentPeriodEnd = null,
  cancelAtPeriodEnd = false,
}: {
  entitlements: OrganizationEntitlements;
  pendingInvitations: number;
  role: Role;
  now: Date;
  providerAvailability: BillingProviderAvailability;
  /**
   * Free Public Beta, Slice 1. Same already-resolved-by-the-caller
   * discipline as `providerAvailability` above — this pure function never
   * reads `process.env` itself. Always required, never defaulted.
   */
  freeBetaMode: boolean;
  /** From the raw Subscription row — Stage 2's entitlements contract doesn't expose these (not needed for enforcement), so the page-data loader reads them separately. `null`/`false` for a LEGACY org with no Subscription row at all. */
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
}): BillingPageViewModel {
  const plan = PLAN_CATALOG[entitlements.planKey] as (typeof PLAN_CATALOG)[PlanKey] | undefined;
  // Free Public Beta, Slice 1: the most prominent element on the page
  // (CurrentPlanSection's own <h2>) names the effective access state
  // directly as "Aqenra Free Beta" rather than the underlying "Trial"
  // plan label — the Subscription row's real planKey/status are
  // completely untouched by this (see entitlements.ts's own freeBetaMode
  // override doc comment); this is display-only.
  const currentPlanName = freeBetaMode ? "Aqenra Free Beta" : (plan?.displayName ?? "Custom plan");

  const canManagePlan = role === "OWNER";
  const canManageSubscription = role === "OWNER";

  const trialEndsAt = entitlements.subscriptionStatus === "TRIALING" ? entitlements.trialEndsAt : null;
  const days = trialEndsAt ? trialDaysRemaining(trialEndsAt, now) : null;
  const expired = trialEndsAt ? now.getTime() > trialEndsAt.getTime() : false;

  return {
    currentPlanKey: entitlements.planKey,
    currentPlanName,
    statusLabel: entitlements.subscriptionStatus,
    statusTone: statusToTone(entitlements.subscriptionStatus),
    statusNotice: buildStatusNotice(entitlements, now, currentPeriodEnd, freeBetaMode),
    accessMode: entitlements.accessMode,
    accessModeBanner: buildAccessModeBanner(entitlements.accessMode),
    isLegacy: entitlements.subscriptionStatus === "LEGACY",

    // Free Public Beta, Slice 1: the trial countdown / expired-trial facts
    // are still computed (nothing here is deleted or hidden from the
    // underlying data), but every renderer of trialEndsAt/trialDaysRemaining/
    // trialApproachingEnd/trialExpired is expected to also check
    // `freeBetaMode` before showing anything derived from them — see
    // CurrentPlanSection's own "Trial ends on..." row, the one other place
    // besides statusNotice that would otherwise surface this.
    trialEndsAt,
    trialDaysRemaining: days,
    trialApproachingEnd: trialEndsAt !== null && !expired && days !== null && days <= TRIAL_APPROACHING_DAYS,
    trialExpired: trialEndsAt !== null && expired,

    currentPeriodEnd,
    cancelAtPeriodEnd,
    gracePeriodEndsAt: entitlements.gracePeriodEndsAt,

    usageRows: buildUsageRows(entitlements, pendingInvitations),
    availablePlans: buildAvailablePlans(entitlements.planKey, canManagePlan, providerAvailability.configured, freeBetaMode),
    permissions: { role, canManagePlan, canManageSubscription },

    freeBetaMode,
    providerConfigured: false,
    providerAvailability,
  };
}

/**
 * The single DB-backed entry point the Billing page (and only the Billing
 * page) calls. `organizationId`/`role` are always server-resolved by the
 * caller (getCurrentMembership()) — this function never accepts or trusts
 * a client-supplied id.
 *
 * `pendingInvitations` is queried here, independently of
 * getOrganizationEntitlements()'s own internal pending-invitation read for
 * its limit check (entitlements.ts's own currentMembers deliberately never
 * includes pending invites, see that file's own comment) — Stage 2's
 * contract is left untouched; this is a small, additive, Stage-3-only read
 * so the Members usage row can show the same number that actually
 * constrains canInviteMember. Free Public Beta, Slice 2: both this read
 * and that one now call the exact same shared, expiry-aware
 * countReservedPendingInvitations() (src/lib/billing/usage.ts) with the
 * same `now` — a calendar-expired-but-still-PENDING invitation can no
 * longer make this display disagree with what actually gates
 * canInviteMember.
 */
export async function getBillingPageData({
  organizationId,
  role,
  now = new Date(),
}: {
  organizationId: string;
  role: Role;
  now?: Date;
}): Promise<BillingPageViewModel> {
  const [entitlements, pendingInvitations, providerAvailability, subscription] = await Promise.all([
    getOrganizationEntitlements(organizationId, { now }),
    countReservedPendingInvitations(prisma, organizationId, now),
    getBillingProviderAvailability(),
    prisma.subscription.findUnique({
      where: { organizationId },
      select: { currentPeriodEnd: true, cancelAtPeriodEnd: true },
    }),
  ]);

  return buildBillingPageViewModel({
    entitlements,
    pendingInvitations,
    role,
    now,
    providerAvailability,
    freeBetaMode: isFreeBetaModeEnabled(),
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
  });
}
