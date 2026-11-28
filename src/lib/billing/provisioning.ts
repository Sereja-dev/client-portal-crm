import type { Prisma } from "@/generated/prisma/client";
import { DEFAULT_TRIAL_PLAN_KEY, DEFAULT_FREE_PLAN_KEY, TRIAL_DURATION_DAYS } from "./plans";

/**
 * Billing & Subscriptions Stage 2 (docs/billing-architecture.md §9,
 * refined by this stage's own explicit "automatic trial provisioning"
 * requirement — Stage 1 originally proposed an *implicit* trial with no
 * row at all; this stage instead creates a real TRIALING Subscription row
 * for every brand-new Organization, atomically).
 *
 * Superseded for new organizations by createFreePlanSubscription below
 * (Aqenra Free plan) — kept, unmodified, because existing TRIALING
 * organizations and test fixtures/backfill scripts still legitimately
 * construct this exact shape; src/lib/current-user.ts's own
 * organization-creation transaction no longer calls this function.
 *
 * Must be called from inside the exact same `prisma.$transaction(...)`
 * that creates the Organization itself (see getOrCreateOrganizationId in
 * src/lib/current-user.ts) — either both rows exist or neither does, the
 * same all-or-nothing guarantee that transaction already gives the
 * Organization + OWNER Membership pair.
 *
 * Idempotent: `upsert` with an empty `update` means a retried/raced call
 * for an organizationId that already has a Subscription row is a silent
 * no-op, never a duplicate-row error and never an overwrite of real
 * subscription state — mirrors getOrCreateOrganizationId()'s own existing
 * P2002-tolerant idempotency for exactly the same class of concurrent-
 * first-login race (Next.js prefetching multiple sidebar links on a
 * user's very first request).
 */
export async function createTrialSubscription(
  tx: Prisma.TransactionClient,
  organizationId: string,
  now: Date,
): Promise<void> {
  const trialEndsAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

  await tx.subscription.upsert({
    where: { organizationId },
    update: {},
    create: {
      organizationId,
      planKey: DEFAULT_TRIAL_PLAN_KEY,
      status: "TRIALING",
      trialStartedAt: now,
      trialEndsAt,
    },
  });
}

/**
 * Aqenra Free plan — the owner-approved replacement for
 * createTrialSubscription above as what a brand-new Organization gets:
 * "New organizations should be created directly on Free, without a
 * paid-feature trial." Same atomicity/idempotency contract as
 * createTrialSubscription (same caller, same transaction, same
 * upsert-with-empty-update race handling) — only the resulting row's
 * shape differs.
 *
 * `status: "ACTIVE"`, not `"TRIALING"`: computeAccessMode()
 * (src/lib/billing/access-mode.ts) grants FULL_ACCESS unconditionally for
 * ACTIVE and never consults trialEndsAt for it — there is no trial for a
 * Free-plan organization to expire out of, and the owner's rules never
 * describe FREE access degrading over time, only being capacity-limited
 * (member/client/active-project/storage ceilings, enforced separately by
 * src/lib/billing/enforcement.ts). `trialStartedAt`/`trialEndsAt` are
 * still set, to `now`, only because the column is NOT NULL on every
 * Subscription row — computeAccessMode's ACTIVE branch never reads
 * either value, the identical "backdated, never consulted" precedent
 * prisma/backfill-subscriptions.ts already established for LEGACY rows.
 */
export async function createFreePlanSubscription(
  tx: Prisma.TransactionClient,
  organizationId: string,
  now: Date,
): Promise<void> {
  await tx.subscription.upsert({
    where: { organizationId },
    update: {},
    create: {
      organizationId,
      planKey: DEFAULT_FREE_PLAN_KEY,
      status: "ACTIVE",
      trialStartedAt: now,
      trialEndsAt: now,
    },
  });
}
