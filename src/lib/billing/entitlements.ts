import type { SubscriptionStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { computeAccessMode, LEGACY_ACCESS_MODE, type AccessMode } from "./access-mode";
import { getOrganizationUsage, countReservedPendingInvitations, type OrganizationUsage, type PrismaClientOrTx } from "./usage";
import { getPlan, isPlanKey, LEGACY_PLAN_KEY, FREE_BETA_MAX_STORAGE_BYTES, FREE_BETA_MAX_MEMBERS, type PlanKey } from "./plans";
import { getBillingProviderAvailability } from "./provider-availability";
import { isFreeBetaModeEnabled } from "./free-beta-mode";

/**
 * Billing & Subscriptions Stage 2 (docs/billing-architecture.md §7/§8/§13).
 * Every reason a create/invite/upload can be blocked — never a raw
 * provider status, never a database error, matching this stage's own
 * error-contract rule (docs/billing-architecture.md §15's "no client-
 * trusted plan" discipline extended to error surfaces: a user-facing
 * reason is always one of these five fixed codes, never anything provider-
 * or database-shaped).
 */
export type EntitlementReasonCode =
  | "MEMBER_LIMIT_REACHED"
  | "CLIENT_LIMIT_REACHED"
  | "PROJECT_LIMIT_REACHED"
  | "STORAGE_LIMIT_REACHED"
  | "READ_ONLY_ACCESS";

/**
 * The subset of a Subscription row buildOrganizationEntitlements actually
 * needs — deliberately not the full Prisma `Subscription` model, so this
 * pure function's own tests never need to construct an entire fake row
 * (id, provider, providerCustomerId, timestamps this function never
 * reads, etc.) just to exercise its logic.
 */
export type SubscriptionStateForEntitlements = {
  planKey: string;
  status: SubscriptionStatus;
  trialEndsAt: Date;
  currentPeriodEnd: Date | null;
  gracePeriodEndsAt: Date | null;
};

export type OrganizationEntitlements = {
  planKey: PlanKey;
  /**
   * Stage 5 audit fix: `"LEGACY"` whenever the resolved `planKey` above is
   * `LEGACY` — either because no Subscription row exists at all, or
   * because a real row's own `planKey` resolved to Legacy (an explicit
   * `LEGACY`-plan row from `prisma/backfill-subscriptions.ts`, or an
   * unrecognized value normalized by the fallback below). Previously this
   * only checked "no row exists," which meant a real row with an
   * unrecognized/explicitly-Legacy `planKey` but a real `status` (e.g. the
   * backfill script's own `status: "ACTIVE"`) rendered as plan "Legacy
   * (pre-billing)" next to a green "Active" status badge and "Your
   * subscription is active" message — internally contradictory for an
   * organization that has never had a real, paid subscription. Never a
   * real provider-reported status either way.
   */
  subscriptionStatus: SubscriptionStatus | "LEGACY";
  accessMode: AccessMode;

  maxMembers: number;
  maxClients: number | null;
  maxProjects: number | null;
  maxStorageBytes: number;

  currentMembers: number;
  currentClients: number;
  currentProjects: number;
  currentStorageBytes: number;

  canInviteMember: boolean;
  canCreateClient: boolean;
  canCreateProject: boolean;
  canUploadBytes: (size: number) => boolean;

  trialEndsAt: Date | null;
  gracePeriodEndsAt: Date | null;

  /** Every reason at least one `can*` boolean above is currently false — empty when nothing is blocked. Never includes a reason for a check that would pass. */
  blockedReasons: readonly EntitlementReasonCode[];
};

/**
 * Pure — no I/O, no Prisma import reachable from this function's own call
 * graph. Takes already-resolved subscription state (or `null`, meaning "no
 * Subscription row — legacy org") and already-computed usage, returns the
 * full entitlements contract. `usage.pendingInvitations` is folded into
 * the member-limit check (docs/billing-architecture.md §8: "inviting 5
 * people for a 5-seat plan should be blocked at the invite, not silently
 * allowed to over-accept later") but never affects `currentMembers`, which
 * always reports real, already-accepted Membership rows only.
 *
 * Never returns a provider id, a raw database error, or any field the
 * design doc's §5 "what this schema must never store"/§15 "no client-
 * trusted plan" rules would object to.
 */
export function buildOrganizationEntitlements({
  subscription,
  usage,
  now,
  providerConfigured,
  freeBetaMode,
}: {
  subscription: SubscriptionStateForEntitlements | null;
  usage: OrganizationUsage & { pendingInvitations: number };
  now: Date;
  /**
   * Billing & Subscriptions Stage 2 correction (P1 — "billing-disabled
   * trial-expiry enforcement"). Whether a real billing provider is
   * actually reachable right now (`getBillingProviderAvailability().
   * configured`) — the one fact `computeAccessMode()` itself deliberately
   * never knows (see the override immediately below for why it stays
   * that way). Always required, never defaulted, so no caller can
   * silently forget it.
   */
  providerConfigured: boolean;
  /**
   * Free Public Beta, Slice 1. Whether Aqenra is currently running as a
   * free public beta with billing enforcement suspended
   * (`isFreeBetaModeEnabled()`) — resolved once by the DB-backed wrapper
   * below, never read from `process.env` inside this pure function, the
   * same explicit-parameter discipline `providerConfigured` already
   * established one line above. Always required, never defaulted.
   */
  freeBetaMode: boolean;
}): OrganizationEntitlements {
  const planKey: PlanKey =
    subscription && isPlanKey(subscription.planKey) ? subscription.planKey : LEGACY_PLAN_KEY;
  const plan = getPlan(planKey);
  const isLegacyPlan = planKey === LEGACY_PLAN_KEY;

  const rawAccessMode: AccessMode = subscription
    ? computeAccessMode(subscription, now)
    : LEGACY_ACCESS_MODE;

  /**
   * P1 fix: a calendar-expired trial must never become a dead-end
   * paywall when no real billing provider is even configured — the
   * customer would have no way to upgrade at all (requestPlanChangeAction
   * already safely refuses with "Billing provider is not configured" in
   * that case; the entitlement layer must not independently lock them
   * out of ordinary writes first). `computeAccessMode()` itself
   * deliberately stays the pure, provider-agnostic "what does the
   * calendar/status say" state machine — Platform Admin's own
   * observability queries (platform-dashboard.ts, organizations.ts) call
   * it directly and intentionally keep showing that raw calendar truth
   * unaffected by either override below, so an operator can always see
   * "this trial has genuinely lapsed" regardless of whether enforcement
   * is currently acting on it. This is the one, single place that
   * decides whether that raw result is actually enforceable right now —
   * both server-side writes (via getOrganizationEntitlements below) and
   * the Billing page's own status notice (view-model.ts's
   * buildStatusNotice) read the corrected `accessMode` this produces, so
   * the two can never disagree about what "billing disabled" means.
   *
   * Deliberately narrow: only the TRIALING-expired -> READ_ONLY
   * transition is overridden. Every other status (ACTIVE, PAST_DUE,
   * CANCELED, UNPAID, INCOMPLETE) keeps its existing behavior regardless
   * of current provider configuration — none of those states can ever
   * arise without a real, signature-verified provider webhook having
   * created them in the first place (the webhook route rejects every
   * event when the provider is unconfigured), so there is no equivalent
   * "no way to ever have avoided this" trap for them to begin with.
   *
   * Free Public Beta, Slice 1: `freeBetaMode` is checked first and,
   * unlike the override above, is deliberately UNCONDITIONAL on status —
   * it forces FULL_ACCESS regardless of TRIALING/ACTIVE/PAST_DUE/
   * CANCELED/UNPAID/INCOMPLETE, and regardless of `providerConfigured`.
   * This is what satisfies the explicit requirement that adding Paddle
   * credentials later (e.g. for internal sandbox checkout testing) must
   * never disable beta access on its own — the narrower provider-
   * unconfigured override above only ever helped the TRIALING-expired
   * case, which is exactly the gap that would otherwise reopen the
   * moment a real provider becomes configured while the beta is still
   * running. No Subscription row is ever written by either override —
   * both are purely a computed `accessMode`, never a database mutation.
   */
  const accessMode: AccessMode = freeBetaMode
    ? "FULL_ACCESS"
    : !providerConfigured && subscription?.status === "TRIALING" && rawAccessMode === "READ_ONLY"
      ? "FULL_ACCESS"
      : rawAccessMode;

  const canCreateNewResources = accessMode === "FULL_ACCESS";

  /**
   * Free Public Beta, Slice 1 (Storage Limit Adjustment). The one,
   * centralized override point for the EFFECTIVE storage ceiling —
   * mirrors the `accessMode` override above exactly: unconditional on
   * `plan.key`/`subscription.status`, so an organization that happens to
   * carry a non-TRIAL `planKey` (a backfilled LEGACY row, a real
   * STARTER/PRO row from before the beta started, etc.) gets the same
   * 3 GiB ceiling as a brand-new TRIAL signup while the beta is running —
   * never a second, independent storage calculation anywhere else (every
   * consumer — enforcement.ts's assertCanUploadAttachment, the Billing
   * page's Usage section, Platform Admin's org-detail page — reads this
   * one field/closure, never `plan.limits.maxStorageBytes` directly).
   * `plans.ts`'s own PLAN_CATALOG values are completely untouched by
   * this — each plan's real allowance is exactly what's restored the
   * moment `freeBetaMode` is false again.
   */
  const effectiveMaxStorageBytes = freeBetaMode ? FREE_BETA_MAX_STORAGE_BYTES : plan.limits.maxStorageBytes;

  /**
   * Free Public Beta, Slice 1 (Member Limit Consistency). The one,
   * centralized override point for the EFFECTIVE member ceiling — exactly
   * mirrors `effectiveMaxStorageBytes` immediately above: unconditional
   * on `plan.key`/`subscription.status`, so a LEGACY organization (native
   * maxMembers: 1000) gets the same 5-seat limit as a brand-new TRIAL
   * signup while the beta is running, instead of its own real, much
   * larger native ceiling leaking through uncorrected (the confirmed
   * Production gap this fix closes). Used for both the capacity
   * eligibility check immediately below and the returned `maxMembers`
   * field — never a second, independent calculation anywhere else.
   * `plans.ts`'s own PLAN_CATALOG values are completely untouched by
   * this — each plan's real member allowance is exactly what's restored
   * the moment `freeBetaMode` is false again. Existing usage accounting
   * (`usage.members` + `usage.pendingInvitations`, including the
   * separate, pre-existing, out-of-scope calendar-expired-but-PENDING
   * invitation behavior) is completely unchanged by this — only the
   * ceiling being compared against moves.
   */
  const effectiveMaxMembers = freeBetaMode ? FREE_BETA_MAX_MEMBERS : plan.limits.maxMembers;

  const membersForLimitCheck = usage.members + usage.pendingInvitations;
  const underMemberLimit = membersForLimitCheck < effectiveMaxMembers;
  const underClientLimit = plan.limits.maxClients === null || usage.clients < plan.limits.maxClients;
  const underProjectLimit = plan.limits.maxProjects === null || usage.projects < plan.limits.maxProjects;
  const underStorageLimit = usage.storageBytes < effectiveMaxStorageBytes;

  const blockedReasons: EntitlementReasonCode[] = [];
  if (!canCreateNewResources) blockedReasons.push("READ_ONLY_ACCESS");
  if (!underMemberLimit) blockedReasons.push("MEMBER_LIMIT_REACHED");
  if (!underClientLimit) blockedReasons.push("CLIENT_LIMIT_REACHED");
  if (!underProjectLimit) blockedReasons.push("PROJECT_LIMIT_REACHED");
  if (!underStorageLimit) blockedReasons.push("STORAGE_LIMIT_REACHED");

  return {
    planKey,
    subscriptionStatus: subscription && !isLegacyPlan ? subscription.status : "LEGACY",
    accessMode,

    maxMembers: effectiveMaxMembers,
    maxClients: plan.limits.maxClients,
    maxProjects: plan.limits.maxProjects,
    maxStorageBytes: effectiveMaxStorageBytes,

    currentMembers: usage.members,
    currentClients: usage.clients,
    currentProjects: usage.projects,
    currentStorageBytes: usage.storageBytes,

    canInviteMember: canCreateNewResources && underMemberLimit,
    canCreateClient: canCreateNewResources && underClientLimit,
    canCreateProject: canCreateNewResources && underProjectLimit,
    canUploadBytes: (size: number) =>
      canCreateNewResources && usage.storageBytes + Math.max(size, 0) <= effectiveMaxStorageBytes,

    trialEndsAt: subscription ? subscription.trialEndsAt : null,
    gracePeriodEndsAt: subscription?.gracePeriodEndsAt ?? null,

    blockedReasons,
  };
}

/**
 * The single DB-backed entry point every Server Action should call
 * (docs/billing-architecture.md §7's "one function, one call site pattern"
 * — mirrors how getCurrentUserOrganization() is already the one resolved-
 * context function every page/action in this app calls). Reads the local
 * Subscription row plus live usage counts, never calls a payment provider
 * (none is connected in this stage; §4's "never call the provider
 * synchronously on the request path" rule holds regardless).
 *
 * Accepts a Prisma client explicitly (default: the app singleton) so a
 * caller can pass its own transaction client for an atomic re-check
 * immediately before a write — see src/lib/billing/enforcement.ts.
 */
export async function getOrganizationEntitlements(
  organizationId: string,
  options?: { client?: PrismaClientOrTx; now?: Date },
): Promise<OrganizationEntitlements> {
  const client = options?.client ?? prisma;
  const now = options?.now ?? new Date();

  const [subscription, usage, pendingInvitations, providerAvailability] = await Promise.all([
    client.subscription.findUnique({ where: { organizationId } }),
    getOrganizationUsage(client, organizationId),
    // Free Public Beta, Slice 2 — the one shared, expiry-aware count
    // (src/lib/billing/usage.ts's own doc comment explains why this is
    // never a second, independently-maintained `status: "PENDING"`
    // predicate). Reuses the same `now` this function already resolved
    // above, so the capacity check and every other time-dependent field
    // this function computes agree on the identical instant.
    countReservedPendingInvitations(client, organizationId, now),
    // Zero-IO (see provider.ts's own header comment — never a network
    // call), so this adds no meaningful latency to a call every write
    // path already makes. Harmless to resolve a second time independently
    // of view-model.ts's own getBillingPageData, which already calls this
    // same function for its own, separate "Connect a billing provider..."
    // display — both always compute the identical boolean from the
    // identical source, so there is no risk of the two disagreeing.
    getBillingProviderAvailability(),
  ]);

  return buildOrganizationEntitlements({
    subscription: subscription
      ? {
          planKey: subscription.planKey,
          status: subscription.status,
          trialEndsAt: subscription.trialEndsAt,
          currentPeriodEnd: subscription.currentPeriodEnd,
          gracePeriodEndsAt: subscription.gracePeriodEndsAt,
        }
      : null,
    usage: { ...usage, pendingInvitations },
    now,
    providerConfigured: providerAvailability.configured,
    freeBetaMode: isFreeBetaModeEnabled(),
  });
}
