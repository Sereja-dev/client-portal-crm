import { describe, expect, it } from "vitest";
import {
  buildSidebarGroups,
  computeActiveGroupKey,
  isActive,
  type SidebarPermissionFlags,
} from "@/components/layout/sidebar";

/**
 * Sidebar Information Architecture — replaces the previous flat-array
 * test suite (Recurring Invoices Phase 2A / Roles Permissions V1) now
 * that buildSidebarLinks() has been replaced by the grouped
 * buildSidebarGroups(). Covers the approved 10-group mapping, permission
 * gating relocated onto each group's own children, and the two-tier
 * active-group resolution (explicit child membership, then a /settings/*
 * fallback) — see sidebar.tsx's own doc comments for the full reasoning.
 */

function flags(overrides: Partial<SidebarPermissionFlags> = {}): SidebarPermissionFlags {
  return {
    recurringInvoicesManage: true,
    analyticsView: true,
    reportsView: true,
    ...overrides,
  };
}

function linksOf(groups: ReturnType<typeof buildSidebarGroups>, key: string): string[] {
  return groups.find((g) => g.key === key)!.links.map((l) => l.href);
}

describe("buildSidebarGroups — top-level structure", () => {
  it("1. renders exactly the 10 approved groups, in the approved order", () => {
    const groups = buildSidebarGroups(flags());
    expect(groups.map((g) => g.key)).toEqual([
      "home",
      "sales",
      "clients",
      "work",
      "finance",
      "documents",
      "support",
      "insights",
      "team",
      "settings",
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "Home",
      "Sales",
      "Clients",
      "Work",
      "Finance",
      "Documents",
      "Support",
      "Insights",
      "Team",
      "Settings",
    ]);
  });

  it("2. every group contains exactly the approved children (full flags)", () => {
    const groups = buildSidebarGroups(flags());
    expect(linksOf(groups, "home")).toEqual(["/dashboard"]);
    expect(linksOf(groups, "sales")).toEqual(["/leads", "/quotes"]);
    expect(linksOf(groups, "clients")).toEqual(["/clients"]);
    expect(linksOf(groups, "work")).toEqual(["/projects", "/tasks", "/time", "/calendar"]);
    expect(linksOf(groups, "finance")).toEqual(["/invoices", "/recurring-invoices", "/settings/billing"]);
    expect(linksOf(groups, "documents")).toEqual(["/contracts"]);
    expect(linksOf(groups, "support")).toEqual(["/requests"]);
    expect(linksOf(groups, "insights")).toEqual(["/analytics", "/reports", "/activity"]);
    expect(linksOf(groups, "team")).toEqual(["/team"]);
    expect(linksOf(groups, "settings")).toEqual(["/settings/notifications"]);
  });

  it("3. Billing is under Finance, not Settings", () => {
    const groups = buildSidebarGroups(flags());
    expect(linksOf(groups, "finance")).toContain("/settings/billing");
    expect(linksOf(groups, "settings")).not.toContain("/settings/billing");
  });

  it("4. Activity is under Insights", () => {
    expect(linksOf(buildSidebarGroups(flags()), "insights")).toContain("/activity");
  });

  it("5. Requests is under Support", () => {
    expect(linksOf(buildSidebarGroups(flags()), "support")).toEqual(["/requests"]);
  });

  it("6. Contracts is under Documents", () => {
    expect(linksOf(buildSidebarGroups(flags()), "documents")).toEqual(["/contracts"]);
  });

  it("7. Templates is never duplicated into Documents (or anywhere else in the primary sidebar)", () => {
    const groups = buildSidebarGroups(flags());
    const allHrefs = groups.flatMap((g) => g.links.map((l) => l.href));
    expect(allHrefs).not.toContain("/settings/templates");
  });

  it("8. Calendar is under Work", () => {
    expect(linksOf(buildSidebarGroups(flags()), "work")).toContain("/calendar");
  });
});

describe("buildSidebarGroups — permission gating (relocated, not changed)", () => {
  it("9. recurringInvoicesManage: false removes only Recurring Invoices from Finance; Invoices/Billing remain", () => {
    const groups = buildSidebarGroups(flags({ recurringInvoicesManage: false }));
    expect(linksOf(groups, "finance")).toEqual(["/invoices", "/settings/billing"]);
  });

  it("10. analyticsView: false removes only Analytics from Insights; Reports/Activity remain", () => {
    const groups = buildSidebarGroups(flags({ analyticsView: false }));
    expect(linksOf(groups, "insights")).toEqual(["/reports", "/activity"]);
  });

  it("11. reportsView: false removes only Reports from Insights, independently of analyticsView", () => {
    const groups = buildSidebarGroups(flags({ analyticsView: true, reportsView: false }));
    expect(linksOf(groups, "insights")).toEqual(["/analytics", "/activity"]);
  });

  it("both analyticsView and reportsView false: Insights degrades to Activity alone, never disappears (Activity is never gated)", () => {
    const groups = buildSidebarGroups(flags({ analyticsView: false, reportsView: false }));
    expect(linksOf(groups, "insights")).toEqual(["/activity"]);
  });

  it("no group is ever affected by a flag that isn't its own", () => {
    const allFalse = buildSidebarGroups(flags({ recurringInvoicesManage: false, analyticsView: false, reportsView: false }));
    const allTrue = buildSidebarGroups(flags());
    for (const key of ["home", "sales", "clients", "work", "documents", "support", "team", "settings"]) {
      expect(linksOf(allFalse, key)).toEqual(linksOf(allTrue, key));
    }
  });
});

describe("computeActiveGroupKey — parent/child active-state resolution", () => {
  const groups = buildSidebarGroups(flags());

  it("12. an active child makes its parent group active", () => {
    expect(computeActiveGroupKey("/invoices", groups)).toBe("finance");
    expect(computeActiveGroupKey("/leads", groups)).toBe("sales");
    expect(computeActiveGroupKey("/activity", groups)).toBe("insights");
  });

  it("13. nested/detail routes resolve to the correct group via existing prefix semantics, and the correct child stays individually active", () => {
    expect(computeActiveGroupKey("/invoices/123/edit", groups)).toBe("finance");
    expect(isActive("/invoices/123/edit", "/invoices")).toBe(true);
    expect(isActive("/invoices/123/edit", "/recurring-invoices")).toBe(false);
    expect(isActive("/invoices/123/edit", "/settings/billing")).toBe(false);
  });

  it("14. /settings/company activates Settings via the /settings/* fallback (no explicit child owns it)", () => {
    expect(computeActiveGroupKey("/settings/company", groups)).toBe("settings");
    expect(computeActiveGroupKey("/settings/domain", groups)).toBe("settings");
  });

  it("15. /settings/billing activates Finance, never Settings, even though its path prefix is /settings/", () => {
    expect(computeActiveGroupKey("/settings/billing", groups)).toBe("finance");
    expect(computeActiveGroupKey("/settings/billing/history", groups)).toBe("finance");
  });

  it("/settings/notifications activates Settings via its own explicit child, not the fallback", () => {
    expect(computeActiveGroupKey("/settings/notifications", groups)).toBe("settings");
  });

  it("an unrecognized path activates no group", () => {
    expect(computeActiveGroupKey("/some-unrelated-path", groups)).toBeNull();
  });

  it("never resolves two groups at once for the same path — exactly one key or null", () => {
    for (const path of ["/dashboard", "/invoices", "/settings/billing", "/settings/company", "/activity", "/nope"]) {
      const result = computeActiveGroupKey(path, groups);
      expect(result === null || typeof result === "string").toBe(true);
    }
  });
});

describe("isActive", () => {
  it("matches the exact path and any nested subpath, never an unrelated sibling prefix", () => {
    expect(isActive("/invoices", "/invoices")).toBe(true);
    expect(isActive("/invoices/123", "/invoices")).toBe(true);
    expect(isActive("/invoices-archive", "/invoices")).toBe(false);
  });
});
