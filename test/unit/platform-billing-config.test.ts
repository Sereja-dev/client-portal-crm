import { afterEach, describe, expect, it, vi } from "vitest";

// src/lib/billing/platform-billing-config.ts imports the real
// "server-only" marker package (transitively, via src/lib/billing/
// provider/provider.ts) — see test/unit/billing-provider-availability
// .test.ts's own header comment for why this needs neutralizing here
// rather than disabling the guard globally.
vi.mock("server-only", () => ({}));

async function importFresh() {
  vi.resetModules();
  return import("@/lib/billing/platform-billing-config");
}

describe("getPlatformBillingConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is honestly 'Not configured'/'Disabled' outside TEST_MODE — no real provider is connected yet, matching getBillingProviderAvailability's own unconfigured state", async () => {
    vi.stubEnv("TEST_MODE", "");
    const { getPlatformBillingConfig } = await importFresh();

    const config = await getPlatformBillingConfig();

    expect(config).toEqual({
      providerName: "Paddle",
      providerConfigured: false,
      mode: "Not configured",
      checkoutConfigured: false,
      customerPortalConfigured: false,
      webhookConfigured: false,
      planSynchronizationConfigured: false,
    });
  });

  it("reports Mode as 'Test' and every capability as configured under TEST_MODE's mock adapter", async () => {
    vi.stubEnv("TEST_MODE", "1");
    const { getPlatformBillingConfig } = await importFresh();

    const config = await getPlatformBillingConfig();

    expect(config).toEqual({
      providerName: "Paddle",
      providerConfigured: true,
      mode: "Test",
      checkoutConfigured: true,
      customerPortalConfigured: true,
      webhookConfigured: true,
      planSynchronizationConfigured: true,
    });
  });

  it("never reports 'Live' mode today — no real provider adapter exists yet to resolve to", async () => {
    vi.stubEnv("TEST_MODE", "1");
    const { getPlatformBillingConfig } = await importFresh();

    const config = await getPlatformBillingConfig();

    expect(config.mode).not.toBe("Live");
  });
});
