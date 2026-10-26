import { describe, expect, it, vi } from "vitest";

// src/lib/billing/entitlements.ts now transitively imports "server-only"
// (via ./provider-availability) — see test/unit/cron-auth.test.ts's own
// header comment for why this needs neutralizing here rather than
// disabling the guard globally.
vi.mock("server-only", () => ({}));

import { buildOrganizationEntitlements, type SubscriptionStateForEntitlements } from "@/lib/billing/entitlements";
import { PLAN_CATALOG } from "@/lib/billing/plans";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function activeSubscription(overrides: Partial<SubscriptionStateForEntitlements> = {}): SubscriptionStateForEntitlements {
  return {
    planKey: "STARTER",
    status: "ACTIVE",
    trialEndsAt: new Date(NOW.getTime() - DAY_MS),
    currentPeriodEnd: null,
    gracePeriodEndsAt: null,
    ...overrides,
  };
}

function usage(overrides: Partial<{ members: number; clients: number; projects: number; storageBytes: number; pendingInvitations: number }> = {}) {
  return { members: 0, clients: 0, projects: 0, storageBytes: 0, pendingInvitations: 0, ...overrides };
}

describe("buildOrganizationEntitlements — member limit", () => {
  it("under the limit: canInviteMember is true", () => {
    const result = buildOrganizationEntitlements({
      subscription: activeSubscription({ planKey: "STARTER" }), // maxMembers: 1
      usage: usage({ members: 0 }),
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    expect(result.canInviteMember).toBe(true);
    expect(result.blockedReasons).not.toContain("MEMBER_LIMIT_REACHED");
  });

  it("at the limit: canInviteMember is false", () => {
    const result = buildOrganizationEntitlements({
      subscription: activeSubscription({ planKey: "STARTER" }), // maxMembers: 1
      usage: usage({ members: 1 }),
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    expect(result.canInviteMember).toBe(false);
    expect(result.blockedReasons).toContain("MEMBER_LIMIT_REACHED");
  });

  it("over the limit: canInviteMember stays false (never negative logic, no crash)", () => {
    const result = buildOrganizationEntitlements({
      subscription: activeSubscription({ planKey: "STARTER" }),
      usage: usage({ members: 5 }),
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    expect(result.canInviteMember).toBe(false);
  });

  it("pending invitations count toward the member limit", () => {
    const result = buildOrganizationEntitlements({
      subscription: activeSubscription({ planKey: "PRO" }), // maxMembers: 5
      usage: usage({ members: 4, pendingInvitations: 1 }),
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    expect(result.canInviteMember).toBe(false);
    expect(result.blockedReasons).toContain("MEMBER_LIMIT_REACHED");
  });

  it("currentMembers reports only real Membership rows, never inflated by pending invitations", () => {
    const result = buildOrganizationEntitlements({
      subscription: activeSubscription({ planKey: "PRO" }),
      usage: usage({ members: 2, pendingInvitations: 3 }),
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    expect(result.currentMembers).toBe(2);
  });
});

describe("buildOrganizationEntitlements — client limit", () => {
  it("under/at/over", () => {
    const maxClients = PLAN_CATALOG.STARTER.limits.maxClients!;
    const under = buildOrganizationEntitlements({ subscription: activeSubscription(), usage: usage({ clients: maxClients - 1 }), now: NOW, providerConfigured: true, freeBetaMode: false, });
    const at = buildOrganizationEntitlements({ subscription: activeSubscription(), usage: usage({ clients: maxClients }), now: NOW, providerConfigured: true, freeBetaMode: false, });
    const over = buildOrganizationEntitlements({ subscription: activeSubscription(), usage: usage({ clients: maxClients + 5 }), now: NOW, providerConfigured: true, freeBetaMode: false, });
    expect(under.canCreateClient).toBe(true);
    expect(at.canCreateClient).toBe(false);
    expect(over.canCreateClient).toBe(false);
  });

  it("null (unlimited) maxClients never blocks, at any count", () => {
    const result = buildOrganizationEntitlements({
      subscription: activeSubscription({ planKey: "PRO" }),
      usage: usage({ clients: 100_000 }),
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    expect(result.canCreateClient).toBe(true);
    expect(result.maxClients).toBeNull();
  });
});

describe("buildOrganizationEntitlements — project limit", () => {
  it("under/at/over", () => {
    const maxProjects = PLAN_CATALOG.STARTER.limits.maxProjects!;
    const under = buildOrganizationEntitlements({ subscription: activeSubscription(), usage: usage({ projects: maxProjects - 1 }), now: NOW, providerConfigured: true, freeBetaMode: false, });
    const at = buildOrganizationEntitlements({ subscription: activeSubscription(), usage: usage({ projects: maxProjects }), now: NOW, providerConfigured: true, freeBetaMode: false, });
    expect(under.canCreateProject).toBe(true);
    expect(at.canCreateProject).toBe(false);
  });
});

describe("buildOrganizationEntitlements — storage limit", () => {
  it("under/at the byte ceiling", () => {
    const max = PLAN_CATALOG.STARTER.limits.maxStorageBytes;
    const under = buildOrganizationEntitlements({ subscription: activeSubscription(), usage: usage({ storageBytes: max - 1 }), now: NOW, providerConfigured: true, freeBetaMode: false, });
    const at = buildOrganizationEntitlements({ subscription: activeSubscription(), usage: usage({ storageBytes: max }), now: NOW, providerConfigured: true, freeBetaMode: false, });
    expect(under.canUploadBytes(0)).toBe(true);
    expect(at.canUploadBytes(1)).toBe(false);
  });

  it("canUploadBytes(size) — an upload that would cross the limit is rejected even if current usage is under it", () => {
    const max = PLAN_CATALOG.STARTER.limits.maxStorageBytes;
    const result = buildOrganizationEntitlements({ subscription: activeSubscription(), usage: usage({ storageBytes: max - 100 }), now: NOW, providerConfigured: true, freeBetaMode: false, });
    expect(result.canUploadBytes(50)).toBe(true); // fits
    expect(result.canUploadBytes(150)).toBe(false); // would cross
  });

  it("canUploadBytes(size) — an upload landing exactly on the ceiling is allowed (inclusive)", () => {
    const max = PLAN_CATALOG.STARTER.limits.maxStorageBytes;
    const result = buildOrganizationEntitlements({ subscription: activeSubscription(), usage: usage({ storageBytes: max - 100 }), now: NOW, providerConfigured: true, freeBetaMode: false, });
    expect(result.canUploadBytes(100)).toBe(true);
  });
});

describe("buildOrganizationEntitlements — read-only mode", () => {
  it("READ_ONLY access mode blocks every can* boolean, regardless of how much headroom the plan's own limits would otherwise allow", () => {
    const result = buildOrganizationEntitlements({
      subscription: activeSubscription({ status: "UNPAID", planKey: "PRO" }), // PRO has generous/unlimited limits
      usage: usage({ members: 0, clients: 0, projects: 0, storageBytes: 0 }),
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    expect(result.accessMode).toBe("READ_ONLY");
    expect(result.canInviteMember).toBe(false);
    expect(result.canCreateClient).toBe(false);
    expect(result.canCreateProject).toBe(false);
    expect(result.canUploadBytes(1)).toBe(false);
    expect(result.blockedReasons).toContain("READ_ONLY_ACCESS");
  });

  it("read-only mode never appears as a false 'over count limit' reason when the real cause is access mode", () => {
    const result = buildOrganizationEntitlements({
      subscription: activeSubscription({ status: "UNPAID", planKey: "PRO" }),
      usage: usage({ members: 0 }), // well under any real limit
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    expect(result.blockedReasons).toContain("READ_ONLY_ACCESS");
    expect(result.blockedReasons).not.toContain("MEMBER_LIMIT_REACHED");
  });
});

describe("buildOrganizationEntitlements — no destructive restriction", () => {
  it("the entitlements contract has no field or method that could hide or delete existing data — only forward-looking booleans/counts", () => {
    const result = buildOrganizationEntitlements({
      subscription: activeSubscription({ status: "CANCELED", currentPeriodEnd: new Date(NOW.getTime() - DAY_MS) }),
      usage: usage({ members: 10, clients: 10, projects: 10, storageBytes: 10 }), // way over every limit
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    // Existing usage counts are reported as-is, never clamped/hidden/zeroed.
    expect(result.currentMembers).toBe(10);
    expect(result.currentClients).toBe(10);
    expect(result.currentProjects).toBe(10);
    expect(result.currentStorageBytes).toBe(10);
    // No field on this contract represents "delete" or "hide" — the shape
    // itself only ever describes forward creation ability.
    expect(Object.keys(result)).not.toContain("shouldDelete");
    expect(Object.keys(result)).not.toContain("hidden");
  });
});

describe("buildOrganizationEntitlements — legacy fallback (no Subscription row)", () => {
  it("null subscription resolves to LEGACY plan and FULL_ACCESS", () => {
    const result = buildOrganizationEntitlements({
      subscription: null,
      usage: usage({ members: 500 }),
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    expect(result.planKey).toBe("LEGACY");
    expect(result.subscriptionStatus).toBe("LEGACY");
    expect(result.accessMode).toBe("FULL_ACCESS");
    expect(result.canInviteMember).toBe(true);
    expect(result.trialEndsAt).toBeNull();
    expect(result.gracePeriodEndsAt).toBeNull();
  });

  it("an unrecognized planKey string on an existing row also falls back to LEGACY (defensive, never a crash)", () => {
    const result = buildOrganizationEntitlements({
      subscription: activeSubscription({ planKey: "SOME_RETIRED_PLAN" }),
      usage: usage(),
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    expect(result.planKey).toBe("LEGACY");
  });

  it("Stage 5 audit fix: a real row resolving to the LEGACY plan also reports subscriptionStatus LEGACY, not its own raw status", () => {
    // Regression guard for the exact shape prisma/backfill-subscriptions.ts
    // writes: a real Subscription row, status ACTIVE, planKey LEGACY.
    // Before this fix, subscriptionStatus only ever became "LEGACY" when
    // no row existed at all — a backfilled/corrupted-planKey row with a
    // real `status: "ACTIVE"` rendered plan "Legacy (pre-billing)" next to
    // a green "Active" badge and "Your subscription is active" message,
    // which is false for an organization that has never had a real
    // subscription.
    const backfilled = buildOrganizationEntitlements({
      subscription: activeSubscription({ planKey: "LEGACY", status: "ACTIVE" }),
      usage: usage(),
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    expect(backfilled.planKey).toBe("LEGACY");
    expect(backfilled.subscriptionStatus).toBe("LEGACY");

    // Same fix, via the "unrecognized planKey" path rather than the
    // literal LEGACY key — both resolve `planKey` to LEGACY, so both must
    // resolve `subscriptionStatus` to LEGACY too, for the same reason.
    const unrecognized = buildOrganizationEntitlements({
      subscription: activeSubscription({ planKey: "SOME_RETIRED_PLAN", status: "ACTIVE" }),
      usage: usage(),
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    expect(unrecognized.subscriptionStatus).toBe("LEGACY");
  });

  it("a real, recognized non-LEGACY plan is unaffected by this fix — its own real status still reports as-is", () => {
    const result = buildOrganizationEntitlements({
      subscription: activeSubscription({ planKey: "PRO", status: "PAST_DUE" }),
      usage: usage(),
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    expect(result.planKey).toBe("PRO");
    expect(result.subscriptionStatus).toBe("PAST_DUE");
  });
});

describe("buildOrganizationEntitlements — reason codes", () => {
  it("blockedReasons is empty when nothing is blocked", () => {
    const result = buildOrganizationEntitlements({ subscription: activeSubscription({ planKey: "PRO" }), usage: usage(), now: NOW, providerConfigured: true, freeBetaMode: false, });
    expect(result.blockedReasons).toEqual([]);
  });

  it("blockedReasons can contain multiple simultaneous reasons", () => {
    const result = buildOrganizationEntitlements({
      subscription: activeSubscription({ planKey: "STARTER" }),
      usage: usage({ members: 1, clients: 10, projects: 20, storageBytes: PLAN_CATALOG.STARTER.limits.maxStorageBytes }),
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    expect(result.blockedReasons).toEqual(
      expect.arrayContaining(["MEMBER_LIMIT_REACHED", "CLIENT_LIMIT_REACHED", "PROJECT_LIMIT_REACHED", "STORAGE_LIMIT_REACHED"]),
    );
  });

  it("never returns a provider id, price id, or any raw internal field", () => {
    const result = buildOrganizationEntitlements({ subscription: activeSubscription(), usage: usage(), now: NOW, providerConfigured: true, freeBetaMode: false, });
    const serialized = JSON.stringify(result, (_key, value) => (typeof value === "function" ? "[fn]" : value));
    expect(serialized).not.toMatch(/provider/i);
    expect(serialized).not.toMatch(/price/i);
    expect(serialized).not.toMatch(/customerId/i);
    expect(serialized).not.toMatch(/subscriptionId/i);
  });
});

/**
 * P1 fix — "billing-disabled trial-expiry enforcement" (see docs/launch-
 * handoff.md-adjacent readiness audit). A calendar-expired trial must
 * never become a dead-end paywall when no real billing provider is even
 * configured. Deliberately narrow: only the TRIALING-expired -> READ_ONLY
 * transition is overridden; every other status keeps computeAccessMode's
 * own existing behavior regardless of providerConfigured — proven below
 * by exercising ACTIVE, UNPAID, and LEGACY (no Subscription row) with
 * providerConfigured: false, freeBetaMode: false, and confirming nothing changes for them.
 */
function trialingSubscription(trialEndsAt: Date, overrides: Partial<SubscriptionStateForEntitlements> = {}): SubscriptionStateForEntitlements {
  return {
    planKey: "TRIAL",
    status: "TRIALING",
    trialEndsAt,
    currentPeriodEnd: null,
    gracePeriodEndsAt: null,
    ...overrides,
  };
}

describe("buildOrganizationEntitlements — P1 fix: billing-disabled trial-expiry enforcement", () => {
  it("unconfigured provider + expired TRIALING: FULL_ACCESS, writes remain permitted", () => {
    const result = buildOrganizationEntitlements({
      subscription: trialingSubscription(new Date(NOW.getTime() - DAY_MS)),
      usage: usage(),
      now: NOW,
      providerConfigured: false, freeBetaMode: false,
    });
    expect(result.accessMode).toBe("FULL_ACCESS");
    expect(result.canInviteMember).toBe(true);
    expect(result.canCreateClient).toBe(true);
    expect(result.canCreateProject).toBe(true);
    expect(result.canUploadBytes(1)).toBe(true);
    expect(result.blockedReasons).not.toContain("READ_ONLY_ACCESS");
  });

  it("unconfigured provider + active TRIALING: unchanged — already FULL_ACCESS regardless of this fix", () => {
    const result = buildOrganizationEntitlements({
      subscription: trialingSubscription(new Date(NOW.getTime() + DAY_MS)),
      usage: usage(),
      now: NOW,
      providerConfigured: false, freeBetaMode: false,
    });
    expect(result.accessMode).toBe("FULL_ACCESS");
  });

  it("configured provider + expired TRIALING: existing restricted behavior is unchanged — still READ_ONLY", () => {
    const result = buildOrganizationEntitlements({
      subscription: trialingSubscription(new Date(NOW.getTime() - DAY_MS)),
      usage: usage(),
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    expect(result.accessMode).toBe("READ_ONLY");
    expect(result.canCreateClient).toBe(false);
    expect(result.blockedReasons).toContain("READ_ONLY_ACCESS");
  });

  it("configured provider + active TRIALING: unchanged", () => {
    const result = buildOrganizationEntitlements({
      subscription: trialingSubscription(new Date(NOW.getTime() + DAY_MS)),
      usage: usage(),
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    expect(result.accessMode).toBe("FULL_ACCESS");
  });

  it("the bypass never broadens beyond TRIALING: an unconfigured provider does not rescue an UNPAID (read-only) subscription", () => {
    const result = buildOrganizationEntitlements({
      subscription: activeSubscription({ status: "UNPAID", planKey: "PRO" }),
      usage: usage(),
      now: NOW,
      providerConfigured: false, freeBetaMode: false,
    });
    expect(result.accessMode).toBe("READ_ONLY");
    expect(result.canInviteMember).toBe(false);
  });

  it("a configured, real ACTIVE paid subscription is unaffected by providerConfigured either way", () => {
    const configured = buildOrganizationEntitlements({
      subscription: activeSubscription({ status: "ACTIVE", planKey: "PRO" }),
      usage: usage(),
      now: NOW,
      providerConfigured: true, freeBetaMode: false,
    });
    const unconfigured = buildOrganizationEntitlements({
      subscription: activeSubscription({ status: "ACTIVE", planKey: "PRO" }),
      usage: usage(),
      now: NOW,
      providerConfigured: false, freeBetaMode: false,
    });
    expect(configured.accessMode).toBe("FULL_ACCESS");
    expect(unconfigured.accessMode).toBe("FULL_ACCESS");
  });

  it("LEGACY (no Subscription row) keeps its existing FULL_ACCESS semantics regardless of providerConfigured", () => {
    const configured = buildOrganizationEntitlements({ subscription: null, usage: usage(), now: NOW, providerConfigured: true, freeBetaMode: false, });
    const unconfigured = buildOrganizationEntitlements({ subscription: null, usage: usage(), now: NOW, providerConfigured: false, freeBetaMode: false, });
    expect(configured.accessMode).toBe("FULL_ACCESS");
    expect(unconfigured.accessMode).toBe("FULL_ACCESS");
  });
});

/**
 * Free Public Beta, Slice 1. `freeBetaMode: true` is deliberately
 * unconditional on subscription status and on `providerConfigured` — see
 * entitlements.ts's own doc comment for why this override is checked
 * first, ahead of the narrower P1 (provider-unconfigured) override above.
 * No test here ever asserts a Subscription row's own fields change —
 * `buildOrganizationEntitlements` never mutates anything, and these
 * fixtures (`activeSubscription`/`trialingSubscription`) are never
 * written back anywhere.
 */
describe("buildOrganizationEntitlements — Free Public Beta, Slice 1 (freeBetaMode)", () => {
  it("A: beta enabled, provider absent, fresh (non-expired) trial: FULL_ACCESS", () => {
    const result = buildOrganizationEntitlements({
      subscription: trialingSubscription(new Date(NOW.getTime() + DAY_MS)),
      usage: usage(),
      now: NOW,
      providerConfigured: false,
      freeBetaMode: true,
    });
    expect(result.accessMode).toBe("FULL_ACCESS");
    expect(result.canCreateClient).toBe(true);
  });

  it("B: beta enabled, provider absent, expired trial: FULL_ACCESS", () => {
    const result = buildOrganizationEntitlements({
      subscription: trialingSubscription(new Date(NOW.getTime() - DAY_MS)),
      usage: usage(),
      now: NOW,
      providerConfigured: false,
      freeBetaMode: true,
    });
    expect(result.accessMode).toBe("FULL_ACCESS");
    expect(result.canCreateClient).toBe(true);
    expect(result.blockedReasons).not.toContain("READ_ONLY_ACCESS");
  });

  it("C: beta enabled, provider configured, expired trial: FULL_ACCESS — the exact regression this slice prevents (adding Paddle credentials must not disable beta access)", () => {
    const result = buildOrganizationEntitlements({
      subscription: trialingSubscription(new Date(NOW.getTime() - DAY_MS)),
      usage: usage(),
      now: NOW,
      providerConfigured: true,
      freeBetaMode: true,
    });
    expect(result.accessMode).toBe("FULL_ACCESS");
    expect(result.canCreateClient).toBe(true);
    expect(result.canCreateProject).toBe(true);
    expect(result.canInviteMember).toBe(true);
    expect(result.canUploadBytes(1)).toBe(true);
  });

  it("D: beta enabled with ACTIVE, PAST_DUE (grace expired), CANCELED (period over), UNPAID, and INCOMPLETE: FULL_ACCESS for every status, unconditionally", () => {
    const pastDueExpiredGrace = activeSubscription({
      status: "PAST_DUE",
      gracePeriodEndsAt: new Date(NOW.getTime() - DAY_MS),
    });
    const canceledPeriodOver = activeSubscription({
      status: "CANCELED",
      currentPeriodEnd: new Date(NOW.getTime() - DAY_MS),
    });
    const unpaid = activeSubscription({ status: "UNPAID" });
    const incomplete = activeSubscription({ status: "INCOMPLETE" });
    const active = activeSubscription({ status: "ACTIVE" });

    for (const subscription of [pastDueExpiredGrace, canceledPeriodOver, unpaid, incomplete, active]) {
      const result = buildOrganizationEntitlements({
        subscription,
        usage: usage(),
        now: NOW,
        providerConfigured: true,
        freeBetaMode: true,
      });
      expect(result.accessMode).toBe("FULL_ACCESS");
      expect(result.canCreateClient).toBe(true);
    }
  });

  it("E: beta disabled, provider absent, expired trial: existing FULL_ACCESS fallback preserved exactly (P1 fix, unchanged)", () => {
    const result = buildOrganizationEntitlements({
      subscription: trialingSubscription(new Date(NOW.getTime() - DAY_MS)),
      usage: usage(),
      now: NOW,
      providerConfigured: false,
      freeBetaMode: false,
    });
    expect(result.accessMode).toBe("FULL_ACCESS");
  });

  it("F: beta disabled, provider configured, expired trial: existing READ_ONLY behavior preserved exactly", () => {
    const result = buildOrganizationEntitlements({
      subscription: trialingSubscription(new Date(NOW.getTime() - DAY_MS)),
      usage: usage(),
      now: NOW,
      providerConfigured: true,
      freeBetaMode: false,
    });
    expect(result.accessMode).toBe("READ_ONLY");
    expect(result.canCreateClient).toBe(false);
  });

  it("G: beta disabled, every other subscription status, provider configured or not: preserves existing status-driven behavior (regression guard)", () => {
    const active = buildOrganizationEntitlements({
      subscription: activeSubscription({ status: "ACTIVE" }),
      usage: usage(),
      now: NOW,
      providerConfigured: true,
      freeBetaMode: false,
    });
    const unpaid = buildOrganizationEntitlements({
      subscription: activeSubscription({ status: "UNPAID" }),
      usage: usage(),
      now: NOW,
      providerConfigured: false,
      freeBetaMode: false,
    });
    const legacy = buildOrganizationEntitlements({
      subscription: null,
      usage: usage(),
      now: NOW,
      providerConfigured: false,
      freeBetaMode: false,
    });
    expect(active.accessMode).toBe("FULL_ACCESS");
    expect(unpaid.accessMode).toBe("READ_ONLY");
    expect(legacy.accessMode).toBe("FULL_ACCESS");
  });

  it("N: existing member/storage/client/project limits remain enforced even with the beta flag on — freeBetaMode only ever widens accessMode, never the plan's own numeric ceilings", () => {
    const overMemberLimit = buildOrganizationEntitlements({
      subscription: activeSubscription({ planKey: "STARTER" }), // maxMembers: 1
      usage: usage({ members: 1 }),
      now: NOW,
      providerConfigured: false,
      freeBetaMode: true,
    });
    expect(overMemberLimit.accessMode).toBe("FULL_ACCESS");
    expect(overMemberLimit.canInviteMember).toBe(false);
    expect(overMemberLimit.blockedReasons).toContain("MEMBER_LIMIT_REACHED");

    const overStorageLimit = buildOrganizationEntitlements({
      subscription: activeSubscription({ planKey: "STARTER" }),
      usage: usage({ storageBytes: PLAN_CATALOG.STARTER.limits.maxStorageBytes }),
      now: NOW,
      providerConfigured: false,
      freeBetaMode: true,
    });
    expect(overStorageLimit.canUploadBytes(1)).toBe(false);
    expect(overStorageLimit.blockedReasons).toContain("STORAGE_LIMIT_REACHED");

    // TRIAL's own maxMembers (5) is likewise still enforced during the beta.
    const trialOverMemberLimit = buildOrganizationEntitlements({
      subscription: trialingSubscription(new Date(NOW.getTime() + DAY_MS)),
      usage: usage({ members: PLAN_CATALOG.TRIAL.limits.maxMembers }),
      now: NOW,
      providerConfigured: false,
      freeBetaMode: true,
    });
    expect(trialOverMemberLimit.canInviteMember).toBe(false);
    expect(trialOverMemberLimit.blockedReasons).toContain("MEMBER_LIMIT_REACHED");
  });
});
