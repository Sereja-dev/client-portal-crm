import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BillingPageViewModel, PlanCardViewModel } from "@/lib/billing/view-model";

/**
 * Unfinished Features Cleanup (Block 17). Same minimal-view-model +
 * `renderToStaticMarkup` pattern test/unit/current-plan-section.test.tsx
 * already established for exactly this "provider configured vs.
 * unconfigured" axis — reused here rather than invented fresh. This is
 * the one place genuinely-unconfigured-provider behavior for the Plans
 * section can be proven at all: this repo's own E2E harness runs with
 * TEST_MODE on globally (playwright.config.ts's webServer.env), which
 * always resolves the provider registry to the configured Mock adapter
 * — see billing-ui.spec.ts's own identical note on why the real
 * unconfigured path for Manage subscription is unit-tested instead.
 *
 * PlansSection -> PlanCard -> PlanActionButton ("use client") imports
 * requestPlanChangeAction from settings/billing/actions.ts ("use
 * server"), whose own module graph reaches getBillingProviderAdapter
 * (src/lib/billing/provider/provider.ts), which imports the real
 * "server-only" marker package — same mocking requirement
 * current-plan-section.test.tsx's own header comment documents for the
 * identical import chain, reused verbatim here.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/components/toast/toast-provider", () => ({ useToast: () => ({ showToast: () => {} }) }));

const { PlansSection } = await import("@/components/billing/plans-section");

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

const SAMPLE_PLAN: PlanCardViewModel = {
  planKey: "PRO",
  displayName: "Pro",
  maxMembers: 10,
  maxClients: null,
  maxProjects: null,
  maxStorageBytes: 10_000_000_000,
  description: "For growing teams.",
  isCurrentPlan: false,
  ctaLabel: "Upgrade",
  ctaDisabled: false,
};

function buildViewModel(overrides: { providerConfigured: boolean; availablePlans: PlanCardViewModel[] }): BillingPageViewModel {
  return {
    currentPlanKey: "STARTER",
    currentPlanName: "Starter",
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
    availablePlans: overrides.availablePlans,
    permissions: { role: "OWNER", canManagePlan: true, canManageSubscription: true },

    providerConfigured: false,
    providerAvailability: overrides.providerConfigured ? PROVIDER_CONFIGURED : PROVIDER_UNCONFIGURED,
  };
}

describe("PlansSection — provider-configured visibility", () => {
  it("provider unconfigured: renders nothing at all — no Plans heading, no plan cards, no internal/operator copy", () => {
    const html = renderToStaticMarkup(
      <PlansSection data={buildViewModel({ providerConfigured: false, availablePlans: [SAMPLE_PLAN] })} />,
    );
    expect(html).toBe("");
    expect(html).not.toContain("Connect a billing provider to publish pricing.");
    expect(html).not.toContain("Pricing configured by the product owner.");
    expect(html).not.toContain("Plans");
    expect(html).not.toContain("Upgrade");
  });

  it("provider configured: renders the real Plans heading and plan cards, with no internal/operator copy anywhere", () => {
    const html = renderToStaticMarkup(
      <PlansSection data={buildViewModel({ providerConfigured: true, availablePlans: [SAMPLE_PLAN] })} />,
    );
    expect(html).toContain("Plans");
    expect(html).toContain("Pro");
    expect(html).toContain("Upgrade");
    expect(html).not.toContain("Connect a billing provider to publish pricing.");
    expect(html).not.toContain("Pricing configured by the product owner.");
  });

  it("provider configured but genuinely zero available plans: still renders the Plans section shell (an empty grid), not nothing — a real, if currently empty, state is not the same as the unconfigured state this component otherwise hides for", () => {
    const html = renderToStaticMarkup(<PlansSection data={buildViewModel({ providerConfigured: true, availablePlans: [] })} />);
    expect(html).toContain("Plans");
    expect(html).not.toContain("Connect a billing provider to publish pricing.");
  });
});
