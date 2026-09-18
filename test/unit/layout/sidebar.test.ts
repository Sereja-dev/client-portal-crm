import { describe, expect, it } from "vitest";
import { buildSidebarLinks, type SidebarPermissionFlags } from "@/components/layout/sidebar";

/**
 * Recurring Invoices Phase 2A — Sidebar gating (test items 41/42),
 * updated for Roles / Permissions V1: buildSidebarLinks now takes
 * already-resolved effective-permission flags (locked spec §9/§12)
 * rather than a bare Role — Analytics/Reports are now ALSO gated by
 * their own effective permission (resolving the pre-V1 "show to
 * everyone" inconsistency these two were the sole exception for), not
 * merely Recurring Invoices.
 */

function flags(overrides: Partial<SidebarPermissionFlags> = {}): SidebarPermissionFlags {
  return {
    recurringInvoicesManage: true,
    analyticsView: true,
    reportsView: true,
    ...overrides,
  };
}

describe("buildSidebarLinks", () => {
  it("41. recurringInvoicesManage: false never gets the Recurring Invoices link", () => {
    const links = buildSidebarLinks(flags({ recurringInvoicesManage: false }));
    expect(links.some((link) => link.href === "/recurring-invoices")).toBe(false);
  });

  it("42. recurringInvoicesManage: true gets the Recurring Invoices link", () => {
    expect(buildSidebarLinks(flags({ recurringInvoicesManage: true })).some((link) => link.href === "/recurring-invoices")).toBe(
      true,
    );
  });

  it("every other existing link is unaffected by recurringInvoicesManage", () => {
    const denied = buildSidebarLinks(flags({ recurringInvoicesManage: false })).map((l) => l.href);
    const allowed = buildSidebarLinks(flags({ recurringInvoicesManage: true })).map((l) => l.href);
    expect(denied).toEqual(allowed.filter((href) => href !== "/recurring-invoices"));
  });

  // Calendar V1 — visible regardless of any permission flag, immediately
  // after Dashboard and before Leads, never gated (locked architecture
  // §1/§5).
  it("Calendar is visible regardless of permission flags, immediately after Dashboard and before Leads", () => {
    for (const f of [flags(), flags({ recurringInvoicesManage: false, analyticsView: false, reportsView: false })]) {
      const links = buildSidebarLinks(f);
      const dashboardIndex = links.findIndex((l) => l.href === "/dashboard");
      const calendarIndex = links.findIndex((l) => l.href === "/calendar");
      const leadsIndex = links.findIndex((l) => l.href === "/leads");
      expect(calendarIndex).toBeGreaterThan(-1);
      expect(calendarIndex).toBe(dashboardIndex + 1);
      expect(calendarIndex).toBe(leadsIndex - 1);
      expect(links[calendarIndex].label).toBe("Calendar");
    }
  });

  // Contracts Phase 2 (Staff UI) — visible regardless of any permission
  // flag, immediately after Invoices, never gated (locked architecture
  // §I).
  it("Contracts is visible regardless of permission flags, immediately after Invoices", () => {
    for (const f of [flags(), flags({ recurringInvoicesManage: false, analyticsView: false, reportsView: false })]) {
      const links = buildSidebarLinks(f);
      const invoicesIndex = links.findIndex((l) => l.href === "/invoices");
      const contractsIndex = links.findIndex((l) => l.href === "/contracts");
      expect(contractsIndex).toBeGreaterThan(-1);
      expect(contractsIndex).toBe(invoicesIndex + 1);
      expect(links[contractsIndex].label).toBe("Contracts");
    }
  });

  // Roles / Permissions V1 — Analytics/Reports are now gated by their own
  // effective permission (ANALYTICS_VIEW/REPORTS_VIEW), same treatment
  // Recurring Invoices already had pre-V1 — resolving the prior
  // inconsistency where these two alone were always shown regardless of
  // role.
  it("analyticsView: false hides Analytics; analyticsView: true shows it immediately before Reports when Reports is also visible", () => {
    expect(buildSidebarLinks(flags({ analyticsView: false })).some((l) => l.href === "/analytics")).toBe(false);

    const links = buildSidebarLinks(flags({ analyticsView: true, reportsView: true }));
    const analyticsIndex = links.findIndex((l) => l.href === "/analytics");
    const reportsIndex = links.findIndex((l) => l.href === "/reports");
    expect(analyticsIndex).toBeGreaterThan(-1);
    expect(reportsIndex).toBe(analyticsIndex + 1);
  });

  it("reportsView: false hides Reports independently of analyticsView", () => {
    const links = buildSidebarLinks(flags({ analyticsView: true, reportsView: false }));
    expect(links.some((l) => l.href === "/analytics")).toBe(true);
    expect(links.some((l) => l.href === "/reports")).toBe(false);
  });

  it("both true (the zero-override default for OWNER/ADMIN) shows both, matching pre-V1 behavior exactly", () => {
    const links = buildSidebarLinks(flags({ analyticsView: true, reportsView: true }));
    expect(links.some((l) => l.href === "/analytics")).toBe(true);
    expect(links.some((l) => l.href === "/reports")).toBe(true);
  });
});
