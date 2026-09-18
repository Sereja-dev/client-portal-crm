import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canViewAnalytics, assertCanViewAnalytics, AnalyticsAccessError } from "@/lib/analytics/authorization";

/**
 * Roles / Permissions V1 moved this out of test/unit — canViewAnalytics/
 * assertCanViewAnalytics are now resolver-backed (src/lib/permissions/
 * resolver.ts), which reads RolePermissionOverride, so this can no
 * longer be a pure/DB-free unit test. A fresh, never-seeded
 * organizationId is enough for every case here: OWNER never queries the
 * database at all (getEffectivePermission's own OWNER short-circuit),
 * and ADMIN/MEMBER with zero override rows exercise exactly the "no
 * override -> default" resolver path (locked spec §6's own required
 * zero-override-reproduces-Production-behavior guarantee) — no
 * Organization/Membership fixture needs to exist for either.
 */
describe("canViewAnalytics (zero overrides -- catalog defaults)", () => {
  it("OWNER can view analytics", async () => {
    expect(await canViewAnalytics(randomUUID(), "OWNER")).toBe(true);
  });

  it("ADMIN can view analytics", async () => {
    expect(await canViewAnalytics(randomUUID(), "ADMIN")).toBe(true);
  });

  it("MEMBER cannot view analytics (ANALYTICS_VIEW catalog default)", async () => {
    expect(await canViewAnalytics(randomUUID(), "MEMBER")).toBe(false);
  });
});

describe("assertCanViewAnalytics (zero overrides)", () => {
  it("does not throw for OWNER", async () => {
    await expect(assertCanViewAnalytics(randomUUID(), "OWNER")).resolves.not.toThrow();
  });

  it("does not throw for ADMIN", async () => {
    await expect(assertCanViewAnalytics(randomUUID(), "ADMIN")).resolves.not.toThrow();
  });

  it("throws AnalyticsAccessError for MEMBER", async () => {
    await expect(assertCanViewAnalytics(randomUUID(), "MEMBER")).rejects.toThrow(AnalyticsAccessError);
  });
});
