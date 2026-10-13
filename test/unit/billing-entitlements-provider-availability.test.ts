import { describe, expect, it, vi } from "vitest";

// src/lib/billing/entitlements.ts transitively imports "server-only" (via
// ./provider-availability) — see test/unit/cron-auth.test.ts's own header
// comment for the identical, already-established precedent.
vi.mock("server-only", () => ({}));

// This file's one job: prove that getOrganizationEntitlements() — the
// single DB-backed entry point every assertCan* enforcement helper calls
// — actually threads the REAL getBillingProviderAvailability() result
// into buildOrganizationEntitlements' own providerConfigured override,
// rather than that override only ever existing on paper. The override
// LOGIC itself (every TRIALING/provider-configured permutation) is
// already exhaustively covered, pure-function style, in
// billing-entitlements.test.ts — this file deliberately does not
// duplicate that matrix, only the wiring between getOrganizationEntitlements
// and the real provider-availability helper.
const getBillingProviderAvailabilityMock = vi.fn();
vi.mock("@/lib/billing/provider-availability", () => ({
  getBillingProviderAvailability: getBillingProviderAvailabilityMock,
}));

const { getOrganizationEntitlements } = await import("@/lib/billing/entitlements");
import type { PrismaClientOrTx } from "@/lib/billing/usage";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A minimal fake client exercising only the exact methods
 * getOrganizationEntitlements()/getOrganizationUsage() actually call —
 * passed via the already-documented explicit `client` option, so this
 * never touches the real @/lib/prisma singleton or a real database.
 */
function fakeClient(subscriptionRow: unknown): PrismaClientOrTx {
  return {
    subscription: { findUnique: vi.fn().mockResolvedValue(subscriptionRow) },
    invitation: { count: vi.fn().mockResolvedValue(0) },
    membership: { count: vi.fn().mockResolvedValue(0) },
    client: { count: vi.fn().mockResolvedValue(0) },
    project: { count: vi.fn().mockResolvedValue(0) },
    attachment: { aggregate: vi.fn().mockResolvedValue({ _sum: { sizeBytes: null } }) },
  } as unknown as PrismaClientOrTx;
}

function trialingRow(trialEndsAt: Date) {
  return {
    planKey: "TRIAL",
    status: "TRIALING" as const,
    trialEndsAt,
    currentPeriodEnd: null,
    gracePeriodEndsAt: null,
  };
}

function availability(configured: boolean) {
  return { configured, provider: "PADDLE" as const, checkoutAvailable: configured, portalAvailable: configured };
}

describe("getOrganizationEntitlements — provider-availability wiring (P1 fix)", () => {
  it("unconfigured provider + expired TRIALING: resolves to FULL_ACCESS — enforcement never sees a dead-end READ_ONLY", async () => {
    getBillingProviderAvailabilityMock.mockResolvedValue(availability(false));
    const result = await getOrganizationEntitlements("org-unconfigured-expired", {
      client: fakeClient(trialingRow(new Date(NOW.getTime() - DAY_MS))),
      now: NOW,
    });
    expect(result.accessMode).toBe("FULL_ACCESS");
    expect(result.canCreateClient).toBe(true);
    expect(result.canCreateProject).toBe(true);
    expect(result.canInviteMember).toBe(true);
  });

  it("configured provider + expired TRIALING: resolves to READ_ONLY — existing enforcement is unchanged", async () => {
    getBillingProviderAvailabilityMock.mockResolvedValue(availability(true));
    const result = await getOrganizationEntitlements("org-configured-expired", {
      client: fakeClient(trialingRow(new Date(NOW.getTime() - DAY_MS))),
      now: NOW,
    });
    expect(result.accessMode).toBe("READ_ONLY");
    expect(result.canCreateClient).toBe(false);
  });

  it("unconfigured provider + active TRIALING: unaffected — already FULL_ACCESS regardless of this fix", async () => {
    getBillingProviderAvailabilityMock.mockResolvedValue(availability(false));
    const result = await getOrganizationEntitlements("org-unconfigured-active", {
      client: fakeClient(trialingRow(new Date(NOW.getTime() + DAY_MS))),
      now: NOW,
    });
    expect(result.accessMode).toBe("FULL_ACCESS");
  });

  it("unconfigured provider + no Subscription row at all (LEGACY): unaffected — already FULL_ACCESS regardless of this fix", async () => {
    getBillingProviderAvailabilityMock.mockResolvedValue(availability(false));
    const result = await getOrganizationEntitlements("org-unconfigured-legacy", {
      client: fakeClient(null),
      now: NOW,
    });
    expect(result.accessMode).toBe("FULL_ACCESS");
    expect(result.subscriptionStatus).toBe("LEGACY");
  });
});
