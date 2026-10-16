import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BillingPageViewModel } from "@/lib/billing/view-model";

// CurrentPlanSection -> ManageSubscriptionButton ("use client") imports
// manageSubscriptionAction from settings/billing/actions.ts ("use server"),
// whose own module graph reaches getBillingProviderAdapter
// (src/lib/billing/provider/provider.ts), which imports the real
// "server-only" marker package. That marker throws unless resolved under
// Next's own "react-server" condition — a guard this plain unit test
// process doesn't provide. Neutralizing the marker here doesn't touch any
// real provider/action logic — same pattern test/unit/billing-view-model.test.ts
// and test/unit/cron-auth.test.ts already establish for the identical issue.
vi.mock("server-only", () => ({}));

// useToast() throws outside a real <ToastProvider>, which this static
// render never mounts (and never needs to — showToast is only ever called
// from ManageSubscriptionButton's own click handler, never during the
// initial render these tests exercise). Same pattern as
// test/unit/contract-archive-restore-action.test.tsx.
vi.mock("@/components/toast/toast-provider", () => ({ useToast: () => ({ showToast: () => {} }) }));

const { CurrentPlanSection } = await import("@/components/billing/current-plan-section");

const PROVIDER_CONFIGURED = {
  configured: true,
  provider: "PADDLE" as const,
  checkoutAvailable: true,
  portalAvailable: true,
};

const PROVIDER_UNCONFIGURED = {
  configured: false,
  provider: "PADDLE" as const,
  checkoutAvailable: false,
  portalAvailable: false,
};

function buildViewModel(overrides: {
  canManageSubscription: boolean;
  providerConfigured: boolean;
}): BillingPageViewModel {
  return {
    currentPlanKey: "PRO",
    currentPlanName: "Pro",
    statusLabel: "ACTIVE",
    statusTone: "success",
    statusNotice: { id: "status", tone: "success", message: "Your subscription is active." },
    accessMode: "FULL_ACCESS",
    accessModeBanner: null,
    isLegacy: false,

    trialEndsAt: null,
    trialDaysRemaining: null,
    trialApproachingEnd: false,
    trialExpired: false,

    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    gracePeriodEndsAt: null,

    usageRows: [],
    availablePlans: [],
    permissions: {
      role: overrides.canManageSubscription ? "OWNER" : "MEMBER",
      canManagePlan: overrides.canManageSubscription,
      canManageSubscription: overrides.canManageSubscription,
    },

    providerConfigured: false,
    providerAvailability: overrides.providerConfigured ? PROVIDER_CONFIGURED : PROVIDER_UNCONFIGURED,
  };
}

/**
 * Billing provider-unavailable UI remediation (Defect 2 — Manage
 * subscription). manageSubscriptionAction already fails closed with
 * "Billing provider is not configured." when no real adapter is active —
 * these prove the real, actionable ManageSubscriptionButton is never
 * mounted in that state, so it never becomes a dead end that can only
 * reach that refusal, while the pre-existing non-owner fallback (a wholly
 * separate, unrelated reason) keeps taking precedence exactly as before.
 */
describe("CurrentPlanSection — Manage subscription availability", () => {
  it("OWNER + provider unconfigured: renders a disabled fallback with the provider-unconfigured explanation, not the real button", () => {
    const html = renderToStaticMarkup(
      <CurrentPlanSection data={buildViewModel({ canManageSubscription: true, providerConfigured: false })} />,
    );
    expect(html).toContain("Billing provider is not configured.");
    expect(html).not.toContain("Only the organization owner can manage billing.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>\s*Manage subscription\s*<\/button>/);
  });

  it("OWNER + provider configured: mounts the real ManageSubscriptionButton, not the provider-unconfigured fallback", () => {
    const html = renderToStaticMarkup(
      <CurrentPlanSection data={buildViewModel({ canManageSubscription: true, providerConfigured: true })} />,
    );
    expect(html).not.toContain("Billing provider is not configured.");
    expect(html).not.toContain("Only the organization owner can manage billing.");
    expect(html).toContain("Manage subscription");
    // The real ManageSubscriptionButton never carries a static disabled
    // attribute (only isPending disables it, which is false pre-click).
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>\s*Manage subscription\s*<\/button>/);
  });

  it("non-owner + provider configured: existing non-owner fallback and reason render exactly as before", () => {
    const html = renderToStaticMarkup(
      <CurrentPlanSection data={buildViewModel({ canManageSubscription: false, providerConfigured: true })} />,
    );
    expect(html).toContain("Only the organization owner can manage billing.");
    expect(html).not.toContain("Billing provider is not configured.");
  });

  it("non-owner + provider unconfigured: the owner-only reason still takes precedence, never replaced by the provider-unconfigured copy", () => {
    const html = renderToStaticMarkup(
      <CurrentPlanSection data={buildViewModel({ canManageSubscription: false, providerConfigured: false })} />,
    );
    expect(html).toContain("Only the organization owner can manage billing.");
    expect(html).not.toContain("Billing provider is not configured.");
  });
});
