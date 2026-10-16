import { describe, expect, it, vi } from "vitest";

// src/lib/billing/view-model.ts transitively imports src/lib/billing/
// provider-availability.ts, which imports the real "server-only" marker
// package — see test/unit/cron-auth.test.ts's own header comment. vi.mock
// calls are hoisted above these imports automatically, so a normal static
// import below still resolves against the mocked module.
vi.mock("server-only", () => ({}));

import { buildBillingPageViewModel } from "@/lib/billing/view-model";
import type { OrganizationEntitlements } from "@/lib/billing/entitlements";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-15T12:00:00.000Z");

const PROVIDER_UNCONFIGURED = {
  configured: false,
  provider: "PADDLE" as const,
  checkoutAvailable: false,
  portalAvailable: false,
};

/**
 * Billing provider-unavailable UI remediation — the configured counterpart
 * fixture. Every pre-existing "Upgrade/Downgrade stays enabled" test below
 * now supplies this explicitly rather than relying on `build()`'s own
 * unconfigured default, so the assertion actually states the fact it
 * depends on (enabled requires a configured provider) instead of silently
 * assuming it.
 */
const PROVIDER_CONFIGURED = {
  configured: true,
  provider: "PADDLE" as const,
  checkoutAvailable: true,
  portalAvailable: true,
};

function entitlements(overrides: Partial<OrganizationEntitlements> & { planKey: OrganizationEntitlements["planKey"] }): OrganizationEntitlements {
  return {
    subscriptionStatus: "ACTIVE",
    accessMode: "FULL_ACCESS",
    maxMembers: 5,
    maxClients: null,
    maxProjects: null,
    maxStorageBytes: 10 * 1024 * 1024 * 1024,
    currentMembers: 1,
    currentClients: 0,
    currentProjects: 0,
    currentStorageBytes: 0,
    canInviteMember: true,
    canCreateClient: true,
    canCreateProject: true,
    canUploadBytes: () => true,
    trialEndsAt: null,
    gracePeriodEndsAt: null,
    blockedReasons: [],
    ...overrides,
  };
}

function build(
  overrides: Partial<Parameters<typeof buildBillingPageViewModel>[0]> & {
    entitlements: OrganizationEntitlements;
  },
) {
  return buildBillingPageViewModel({
    pendingInvitations: 0,
    role: "OWNER",
    now: NOW,
    providerAvailability: PROVIDER_UNCONFIGURED,
    ...overrides,
  });
}

describe("TRIALING", () => {
  it("more than 3 days left: info tone, not approaching", () => {
    const vm = build({
      entitlements: entitlements({
        planKey: "TRIAL",
        subscriptionStatus: "TRIALING",
        trialEndsAt: new Date(NOW.getTime() + 5 * DAY_MS),
      }),
    });
    expect(vm.trialDaysRemaining).toBe(5);
    expect(vm.trialApproachingEnd).toBe(false);
    expect(vm.trialExpired).toBe(false);
    expect(vm.statusNotice.tone).toBe("info");
    expect(vm.statusNotice.message).toContain("Trial ends in 5 days");
  });

  it("exactly 3 days left: approaching, warning tone", () => {
    const vm = build({
      entitlements: entitlements({
        planKey: "TRIAL",
        subscriptionStatus: "TRIALING",
        trialEndsAt: new Date(NOW.getTime() + 3 * DAY_MS),
      }),
    });
    expect(vm.trialDaysRemaining).toBe(3);
    expect(vm.trialApproachingEnd).toBe(true);
    expect(vm.trialExpired).toBe(false);
    expect(vm.statusNotice.tone).toBe("warning");
  });

  it("boundary: now exactly equal to trialEndsAt is 0 days remaining, approaching, not expired", () => {
    const vm = build({
      entitlements: entitlements({ planKey: "TRIAL", subscriptionStatus: "TRIALING", trialEndsAt: NOW }),
    });
    expect(vm.trialDaysRemaining).toBe(0);
    expect(vm.trialApproachingEnd).toBe(true);
    expect(vm.trialExpired).toBe(false);
  });

  it("boundary: one millisecond past trialEndsAt is expired", () => {
    const vm = build({
      entitlements: entitlements({
        planKey: "TRIAL",
        subscriptionStatus: "TRIALING",
        accessMode: "READ_ONLY",
        trialEndsAt: new Date(NOW.getTime() - 1),
      }),
    });
    expect(vm.trialExpired).toBe(true);
    expect(vm.trialApproachingEnd).toBe(false);
    expect(vm.statusNotice.tone).toBe("danger");
    expect(vm.statusNotice.message).toContain("trial has ended");
  });

  /**
   * P1 fix — "billing-disabled trial-expiry enforcement". entitlements.
   * accessMode already reflects buildOrganizationEntitlements' own
   * provider-unconfigured override (entitlements.ts) by the time it
   * reaches this view-model — these two tests prove buildStatusNotice
   * reads exactly that corrected value, never re-deriving "is billing
   * disabled" independently, and never showing a dead-end "Upgrade" CTA
   * when nothing is actually being restricted.
   */
  it("expired trial, but accessMode is still FULL_ACCESS (provider unconfigured): does NOT say 'Upgrade to continue creating new records' — states the honest reason instead", () => {
    const vm = build({
      entitlements: entitlements({
        planKey: "TRIAL",
        subscriptionStatus: "TRIALING",
        accessMode: "FULL_ACCESS",
        trialEndsAt: new Date(NOW.getTime() - DAY_MS),
      }),
    });
    expect(vm.trialExpired).toBe(true);
    expect(vm.statusNotice.message).not.toContain("Upgrade to continue creating new records");
    expect(vm.statusNotice.message).toContain("trial has ended");
    expect(vm.statusNotice.message.toLowerCase()).toContain("billing isn't configured");
    expect(vm.statusNotice.tone).not.toBe("danger");
  });

  it("expired trial with accessMode READ_ONLY (provider configured): preserves the existing 'Upgrade to continue creating new records' notice exactly", () => {
    const vm = build({
      entitlements: entitlements({
        planKey: "TRIAL",
        subscriptionStatus: "TRIALING",
        accessMode: "READ_ONLY",
        trialEndsAt: new Date(NOW.getTime() - DAY_MS),
      }),
    });
    expect(vm.statusNotice.tone).toBe("danger");
    expect(vm.statusNotice.message).toBe("Your trial has ended. Upgrade to continue creating new records.");
  });
});

describe("ACTIVE", () => {
  it("success tone, no trial fields set", () => {
    const vm = build({ entitlements: entitlements({ planKey: "PRO", subscriptionStatus: "ACTIVE" }) });
    expect(vm.statusNotice.tone).toBe("success");
    expect(vm.statusNotice.message).toBe("Your subscription is active.");
    expect(vm.trialEndsAt).toBeNull();
    expect(vm.trialDaysRemaining).toBeNull();
  });
});

describe("PAST_DUE", () => {
  it("within grace period: warning tone", () => {
    const vm = build({
      entitlements: entitlements({
        planKey: "PRO",
        subscriptionStatus: "PAST_DUE",
        accessMode: "FULL_ACCESS",
        gracePeriodEndsAt: new Date(NOW.getTime() + DAY_MS),
      }),
    });
    expect(vm.statusNotice.tone).toBe("warning");
    expect(vm.statusNotice.message).toContain("grace period");
  });

  it("past grace period: danger tone, read-only copy", () => {
    const vm = build({
      entitlements: entitlements({
        planKey: "PRO",
        subscriptionStatus: "PAST_DUE",
        accessMode: "READ_ONLY",
        gracePeriodEndsAt: new Date(NOW.getTime() - DAY_MS),
      }),
    });
    expect(vm.statusNotice.tone).toBe("danger");
    expect(vm.statusNotice.message).toContain("read-only");
  });
});

describe("CANCELED", () => {
  it("still within the paid period: warning tone, access continues", () => {
    const vm = build({
      entitlements: entitlements({ planKey: "PRO", subscriptionStatus: "CANCELED", accessMode: "FULL_ACCESS" }),
      currentPeriodEnd: new Date(NOW.getTime() + DAY_MS),
      cancelAtPeriodEnd: true,
    });
    expect(vm.statusNotice.tone).toBe("warning");
    expect(vm.cancelAtPeriodEnd).toBe(true);
    expect(vm.currentPeriodEnd).not.toBeNull();
  });

  it("after the paid period ends: danger tone, read-only copy", () => {
    const vm = build({
      entitlements: entitlements({ planKey: "PRO", subscriptionStatus: "CANCELED", accessMode: "READ_ONLY" }),
      currentPeriodEnd: new Date(NOW.getTime() - DAY_MS),
      cancelAtPeriodEnd: true,
    });
    expect(vm.statusNotice.tone).toBe("danger");
    expect(vm.statusNotice.message).toContain("read-only");
  });
});

describe("INCOMPLETE", () => {
  it("warning tone, limited-writes copy", () => {
    const vm = build({
      entitlements: entitlements({ planKey: "PRO", subscriptionStatus: "INCOMPLETE", accessMode: "LIMITED_WRITES" }),
    });
    expect(vm.statusNotice.tone).toBe("warning");
    expect(vm.accessModeBanner?.tone).toBe("warning");
  });
});

describe("UNPAID", () => {
  it("danger tone, read-only copy", () => {
    const vm = build({
      entitlements: entitlements({ planKey: "PRO", subscriptionStatus: "UNPAID", accessMode: "READ_ONLY" }),
    });
    expect(vm.statusNotice.tone).toBe("danger");
    expect(vm.statusNotice.message).toContain("read-only");
  });
});

describe("LEGACY (no Subscription row)", () => {
  it("is never treated as an error/empty state — neutral tone, full access, no alarming banner", () => {
    const vm = build({
      entitlements: entitlements({
        planKey: "LEGACY",
        subscriptionStatus: "LEGACY",
        accessMode: "FULL_ACCESS",
        maxMembers: 1000,
      }),
    });
    expect(vm.isLegacy).toBe(true);
    expect(vm.statusNotice.tone).toBe("neutral");
    expect(vm.accessModeBanner).toBeNull();
    expect(vm.currentPlanName).toBe("Legacy (pre-billing)");
  });
});

describe("access-mode banner", () => {
  it("FULL_ACCESS never shows an alarming banner", () => {
    const vm = build({ entitlements: entitlements({ planKey: "PRO", accessMode: "FULL_ACCESS" }) });
    expect(vm.accessModeBanner).toBeNull();
  });

  it("READ_ONLY shows a danger banner that never hides the page", () => {
    const vm = build({ entitlements: entitlements({ planKey: "PRO", accessMode: "READ_ONLY" }) });
    expect(vm.accessModeBanner?.tone).toBe("danger");
    expect(vm.accessModeBanner?.message).toContain("read-only");
  });
});

describe("unknown plan key", () => {
  it("falls back to a generic 'Custom plan' label instead of crashing", () => {
    const vm = build({
      entitlements: entitlements({ planKey: "SOMETHING_UNRECOGNIZED" as OrganizationEntitlements["planKey"] }),
    });
    expect(vm.currentPlanName).toBe("Custom plan");
  });
});

describe("provider ids never leak into the view-model", () => {
  it("has no providerCustomerId/providerSubscriptionId/providerEventId key anywhere in the serialized output", () => {
    const vm = build({ entitlements: entitlements({ planKey: "PRO" }) });
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toMatch(/providerCustomerId|providerSubscriptionId|providerEventId/);
  });
});

describe("usage rows: pending invitations counted into Members", () => {
  it("adds pendingInvitations on top of currentMembers, matching the entitlement engine's own limit check", () => {
    const vm = build({
      entitlements: entitlements({ planKey: "STARTER", maxMembers: 5, currentMembers: 2 }),
      pendingInvitations: 2,
    });
    const membersRow = vm.usageRows.find((r) => r.key === "members")!;
    expect(membersRow.current).toBe(4);
    expect(membersRow.limit).toBe(5);
  });
});

describe("plan cards", () => {
  it("marks the current plan and disables its own CTA regardless of provider availability", () => {
    const configured = build({
      entitlements: entitlements({ planKey: "STARTER" }),
      providerAvailability: PROVIDER_CONFIGURED,
    });
    const starterConfigured = configured.availablePlans.find((p) => p.planKey === "STARTER")!;
    expect(starterConfigured.isCurrentPlan).toBe(true);
    expect(starterConfigured.ctaLabel).toBe("Current plan");
    expect(starterConfigured.ctaDisabled).toBe(true);

    const unconfigured = build({ entitlements: entitlements({ planKey: "STARTER" }) });
    const starterUnconfigured = unconfigured.availablePlans.find((p) => p.planKey === "STARTER")!;
    expect(starterUnconfigured.ctaDisabled).toBe(true);
  });

  it("offers Upgrade for a higher plan than the current one when the provider is configured", () => {
    const vm = build({
      entitlements: entitlements({ planKey: "STARTER" }),
      providerAvailability: PROVIDER_CONFIGURED,
    });
    const pro = vm.availablePlans.find((p) => p.planKey === "PRO")!;
    expect(pro.ctaLabel).toBe("Upgrade");
    expect(pro.ctaDisabled).toBe(false);
  });

  it("offers Downgrade for a lower plan than the current one when the provider is configured", () => {
    const vm = build({
      entitlements: entitlements({ planKey: "PRO" }),
      providerAvailability: PROVIDER_CONFIGURED,
    });
    const starter = vm.availablePlans.find((p) => p.planKey === "STARTER")!;
    expect(starter.ctaLabel).toBe("Downgrade");
    expect(starter.ctaDisabled).toBe(false);
  });

  it("never includes TRIAL or LEGACY as a purchasable card", () => {
    const vm = build({ entitlements: entitlements({ planKey: "TRIAL" }) });
    const planKeys = vm.availablePlans.map((p) => p.planKey);
    expect(planKeys).not.toContain("TRIAL");
    expect(planKeys).not.toContain("LEGACY");
    expect(planKeys.sort()).toEqual(["PRO", "STARTER"]);
  });

  it("disables every non-current plan's CTA for a non-owner, with an explanatory reason surfaced via permissions — regardless of provider availability", () => {
    const configured = build({
      entitlements: entitlements({ planKey: "STARTER" }),
      role: "MEMBER",
      providerAvailability: PROVIDER_CONFIGURED,
    });
    expect(configured.permissions.canManagePlan).toBe(false);
    const proConfigured = configured.availablePlans.find((p) => p.planKey === "PRO")!;
    expect(proConfigured.ctaDisabled).toBe(true);

    const unconfigured = build({ entitlements: entitlements({ planKey: "STARTER" }), role: "MEMBER" });
    expect(unconfigured.permissions.canManagePlan).toBe(false);
    const proUnconfigured = unconfigured.availablePlans.find((p) => p.planKey === "PRO")!;
    expect(proUnconfigured.ctaDisabled).toBe(true);
  });

  /**
   * Billing provider-unavailable UI remediation (Defect 1 — Plan CTA).
   * requestPlanChangeAction already fails closed with "Billing provider is
   * not configured." when no real adapter is active — these prove the CTA
   * itself is never actionable in that state for an otherwise-eligible
   * OWNER, so the button never becomes a dead end that can only reach that
   * refusal. ctaLabel (Upgrade/Downgrade) stays unchanged — only
   * ctaDisabled is affected, matching Product's "still show the label,
   * just make it non-actionable" contract.
   */
  it("disables an otherwise-eligible OWNER's Upgrade CTA when the provider is unconfigured, without changing its label", () => {
    const vm = build({ entitlements: entitlements({ planKey: "STARTER" }), role: "OWNER" });
    const pro = vm.availablePlans.find((p) => p.planKey === "PRO")!;
    expect(vm.permissions.canManagePlan).toBe(true);
    expect(pro.ctaLabel).toBe("Upgrade");
    expect(pro.ctaDisabled).toBe(true);
  });

  it("disables an otherwise-eligible OWNER's Downgrade CTA when the provider is unconfigured, without changing its label", () => {
    const vm = build({ entitlements: entitlements({ planKey: "PRO" }), role: "OWNER" });
    const starter = vm.availablePlans.find((p) => p.planKey === "STARTER")!;
    expect(vm.permissions.canManagePlan).toBe(true);
    expect(starter.ctaLabel).toBe("Downgrade");
    expect(starter.ctaDisabled).toBe(true);
  });

  it("re-enables Upgrade for the exact same OWNER/plan state once the provider becomes configured", () => {
    const unconfigured = build({ entitlements: entitlements({ planKey: "STARTER" }), role: "OWNER" });
    const configured = build({
      entitlements: entitlements({ planKey: "STARTER" }),
      role: "OWNER",
      providerAvailability: PROVIDER_CONFIGURED,
    });
    expect(unconfigured.availablePlans.find((p) => p.planKey === "PRO")!.ctaDisabled).toBe(true);
    expect(configured.availablePlans.find((p) => p.planKey === "PRO")!.ctaDisabled).toBe(false);
  });
});

describe("permissions by role", () => {
  it("OWNER can manage plan and subscription", () => {
    const vm = build({ entitlements: entitlements({ planKey: "PRO" }), role: "OWNER" });
    expect(vm.permissions.canManagePlan).toBe(true);
    expect(vm.permissions.canManageSubscription).toBe(true);
  });

  it("ADMIN cannot manage plan or subscription", () => {
    const vm = build({ entitlements: entitlements({ planKey: "PRO" }), role: "ADMIN" });
    expect(vm.permissions.canManagePlan).toBe(false);
    expect(vm.permissions.canManageSubscription).toBe(false);
  });

  it("MEMBER cannot manage plan or subscription", () => {
    const vm = build({ entitlements: entitlements({ planKey: "PRO" }), role: "MEMBER" });
    expect(vm.permissions.canManagePlan).toBe(false);
    expect(vm.permissions.canManageSubscription).toBe(false);
  });
});

describe("providerConfigured", () => {
  it("is always false in Stage 3", () => {
    const vm = build({ entitlements: entitlements({ planKey: "PRO" }) });
    expect(vm.providerConfigured).toBe(false);
  });
});
