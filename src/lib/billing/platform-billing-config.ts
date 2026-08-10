import "server-only";
import { formatStatusLabel } from "@/lib/format";
import { getBillingProviderAdapter } from "./provider/provider";
import { getBillingProviderAvailability } from "./provider-availability";

export type PlatformBillingMode = "Test" | "Live" | "Not configured";

/**
 * Sale-Ready Phase D, D4 (Platform Configuration — Billing Configuration).
 * A read-only projection of the billing subsystem's own existing
 * abstraction (src/lib/billing/provider/provider.ts,
 * src/lib/billing/provider-availability.ts) — never a second billing
 * configuration system, never a network call (getBillingProviderAdapter()
 * and getBillingProviderAvailability() already make none: the former only
 * branches on TEST_MODE, the latter only inspects the resolved adapter's
 * own `kind`/`name`).
 *
 * Stage 4 has no partial-configuration state: checkoutAvailable and
 * portalAvailable are already identical to `configured` in
 * provider-availability.ts today, and webhook verification / plan
 * synchronization (the webhook → event-mapper → provisioning pipeline)
 * are equally gated on having a working adapter to receive events from —
 * there is no separate on/off switch for any one of these yet. This type
 * still gives each its own field so a future real provider integration
 * (Stage 5+, where these genuinely could diverge — e.g. checkout working
 * but a webhook secret missing) is a value change here, never a page
 * redesign.
 */
export type PlatformBillingConfig = {
  /** Formatted from the adapter's own `name` (BillingProvider enum) — every adapter, mock and unconfigured alike, already reports "PADDLE" (the only value the enum has today; see src/lib/billing/provider/unconfigured-provider.ts and mock-provider.ts). Never invented independently of that value. */
  providerName: string;
  /** The same fact src/lib/billing/provider-availability.ts's own `configured` flag already reports to every checkout/portal Server Action — true only when TEST_MODE resolves to the mock adapter; always false in a real deployment until Stage 5+ connects a real provider. */
  providerConfigured: boolean;
  /** Derived from the adapter's own `kind` discriminant ("mock" | "unconfigured" | "paddle") — never a second, independent test-vs-live check. */
  mode: PlatformBillingMode;
  checkoutConfigured: boolean;
  customerPortalConfigured: boolean;
  webhookConfigured: boolean;
  planSynchronizationConfigured: boolean;
};

export async function getPlatformBillingConfig(): Promise<PlatformBillingConfig> {
  const adapter = getBillingProviderAdapter();
  const availability = await getBillingProviderAvailability();

  const mode: PlatformBillingMode = adapter.kind === "mock" ? "Test" : adapter.kind === "paddle" ? "Live" : "Not configured";

  return {
    providerName: formatStatusLabel(adapter.name),
    providerConfigured: availability.configured,
    mode,
    checkoutConfigured: availability.checkoutAvailable,
    customerPortalConfigured: availability.portalAvailable,
    webhookConfigured: availability.configured,
    planSynchronizationConfigured: availability.configured,
  };
}
