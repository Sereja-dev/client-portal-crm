import { describe, expect, it, vi } from "vitest";
import type { DashboardAnalytics } from "@/app/(dashboard)/dashboard/query";

/**
 * Organization Summary Currency Contract — proves
 * executeGetOrganizationSummary's new top-level `currency` field is a
 * pure, unmodified pass-through of getDashboardAnalytics()'s own
 * `currency`, for both a real-looking value and the null case. A real
 * organization can never actually produce `currency: null` (see
 * DashboardAnalytics's own doc comment — practically unreachable via any
 * real fixture), so this is proven here at the mocked-unit level rather
 * than via an integration fixture, which structurally cannot construct
 * it. Kept as its own file, separate from
 * organization-summary.test.ts's existing input-validation-only suite,
 * so this file's getDashboardAnalytics() mock never has to coexist with
 * — or risk destabilizing — that file's own currently un-mocked,
 * DB-unavailable-tolerant assertions.
 */

// server-only marker neutralization: same established pattern as
// test/unit/onboarding-visible-progress.test.ts and
// organization-summary.test.ts's own identical header comment —
// organization-summary.ts's getDashboardAnalytics() import transitively
// reaches src/lib/reports/currency.ts's real "server-only" import.
vi.mock("server-only", () => ({}));

const mockGetDashboardAnalytics = vi.fn();
vi.mock("@/app/(dashboard)/dashboard/query", () => ({
  getDashboardAnalytics: (...args: unknown[]) => mockGetDashboardAnalytics(...args),
}));

const { executeGetOrganizationSummary } = await import("@/lib/ai/tools/organization-summary");

const ORG_ID = "11111111-1111-1111-1111-111111111111";

function baseAnalytics(overrides: Partial<DashboardAnalytics> = {}): DashboardAnalytics {
  return {
    period: "30d",
    periodRange: { start: new Date("2026-01-01"), end: new Date("2026-01-31"), bucketUnit: "day" },
    currency: "USD",
    kpis: {
      totalClients: 0,
      activeProjects: 0,
      openTasks: 0,
      overdueTasksCount: 0,
      outstandingAmount: 0,
      outstandingCount: 0,
      paidRevenue: 0,
      paidThisMonth: 0,
    },
    revenue: { total: 0, buckets: [] },
    breakdowns: { invoiceStatus: [], taskStatus: [], projectStatus: [] },
    recentActivity: [],
    upcomingTasks: [],
    overdueTasks: [],
    recentInvoices: [],
    needsAttention: { overdueInvoicesCount: 0, overdueInvoices: [], unsignedContractsCount: 0, unsignedContracts: [] },
    today: { tasksCount: 0, tasks: [], events: [] },
    ...overrides,
  };
}

describe("executeGetOrganizationSummary — currency pass-through (Organization Summary Currency Contract)", () => {
  it("returns currency equal to getDashboardAnalytics()'s own resolved currency (the normal 'USD' case)", async () => {
    mockGetDashboardAnalytics.mockResolvedValueOnce(baseAnalytics({ currency: "USD" }));
    const result = await executeGetOrganizationSummary(ORG_ID, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.currency).toBe("USD");
  });

  it("returns currency null when getDashboardAnalytics()'s own resolved currency is null — never coerced to a fabricated default", async () => {
    mockGetDashboardAnalytics.mockResolvedValueOnce(baseAnalytics({ currency: null }));
    const result = await executeGetOrganizationSummary(ORG_ID, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.currency).toBeNull();
  });

  it("passes through a non-USD resolved currency too (e.g. 'EUR') — never hardcoded to one value", async () => {
    mockGetDashboardAnalytics.mockResolvedValueOnce(baseAnalytics({ currency: "EUR" }));
    const result = await executeGetOrganizationSummary(ORG_ID, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.currency).toBe("EUR");
  });

  it("currency is independent of outstandingAmount/paidRevenue's own values — neither aggregate's meaning changes", async () => {
    mockGetDashboardAnalytics.mockResolvedValueOnce(
      baseAnalytics({
        currency: "USD",
        kpis: {
          totalClients: 2,
          activeProjects: 1,
          openTasks: 3,
          overdueTasksCount: 0,
          outstandingAmount: 500,
          outstandingCount: 1,
          paidRevenue: 1200,
          paidThisMonth: 1200,
        },
      }),
    );
    const result = await executeGetOrganizationSummary(ORG_ID, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.currency).toBe("USD");
    expect(result.outstandingAmount).toBe(500);
    expect(result.paidRevenue).toBe(1200);
  });
});
