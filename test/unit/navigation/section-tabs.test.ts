import { describe, expect, it } from "vitest";
import { isTabActive } from "@/components/navigation/section-tabs";
import { buildFinanceTabs } from "@/components/finance/finance-tabs";
import { buildWorkTabs } from "@/components/work/work-tabs";
import { buildInsightsTabs } from "@/components/insights/insights-tabs";
import { buildDocumentsTabs } from "@/components/documents/documents-tabs";

/**
 * Section Consolidation — deterministic coverage for the shared
 * section-tabs architecture, mirroring test/unit/layout/sidebar.test.ts's
 * own shape exactly: pure builder-function tests (no rendering) plus
 * isTabActive's own active-state semantics.
 */

function hrefs(tabs: { href: string }[]): string[] {
  return tabs.map((t) => t.href);
}

function visibleHrefs(tabs: { href: string; hidden?: boolean }[]): string[] {
  return tabs.filter((t) => !t.hidden).map((t) => t.href);
}

describe("isTabActive", () => {
  it("matches the exact path and any nested subpath, never an unrelated sibling prefix", () => {
    expect(isTabActive("/invoices", "/invoices")).toBe(true);
    expect(isTabActive("/invoices/123/edit", "/invoices")).toBe(true);
    expect(isTabActive("/invoices-archive", "/invoices")).toBe(false);
  });
});

describe("Finance tabs (buildFinanceTabs)", () => {
  it("1. Invoices is active on /invoices", () => {
    const tabs = buildFinanceTabs({ recurringInvoicesManage: true });
    const invoices = tabs.find((t) => t.label === "Invoices")!;
    expect(isTabActive("/invoices", invoices.href)).toBe(true);
  });

  it("2. Quotes is active on /quotes", () => {
    const tabs = buildFinanceTabs({ recurringInvoicesManage: true });
    const quotes = tabs.find((t) => t.label === "Quotes")!;
    expect(isTabActive("/quotes", quotes.href)).toBe(true);
  });

  it("3. Recurring is active on /recurring-invoices", () => {
    const tabs = buildFinanceTabs({ recurringInvoicesManage: true });
    const recurring = tabs.find((t) => t.label === "Recurring")!;
    expect(isTabActive("/recurring-invoices", recurring.href)).toBe(true);
  });

  it("4. Billing href is exactly /settings/billing", () => {
    const tabs = buildFinanceTabs({ recurringInvoicesManage: true });
    expect(tabs.find((t) => t.label === "Billing")!.href).toBe("/settings/billing");
  });

  it("5. Recurring is omitted when RECURRING_INVOICES_MANAGE is false; Invoices/Quotes/Billing remain", () => {
    const tabs = buildFinanceTabs({ recurringInvoicesManage: false });
    expect(visibleHrefs(tabs)).toEqual(["/invoices", "/quotes", "/settings/billing"]);
  });

  it("6. all four tabs are present, in order, when the permission is granted", () => {
    const tabs = buildFinanceTabs({ recurringInvoicesManage: true });
    expect(hrefs(tabs)).toEqual(["/invoices", "/quotes", "/recurring-invoices", "/settings/billing"]);
  });

  it("7. Quotes is represented in Finance tabs independently of its Sidebar (Sales) ownership — dual discoverability, never removed here", () => {
    const tabs = buildFinanceTabs({ recurringInvoicesManage: true });
    expect(visibleHrefs(tabs)).toContain("/quotes");
  });

  it("Billing is never marked active by any Finance-page pathname — it only becomes active on its own page, outside Finance tabs entirely", () => {
    const tabs = buildFinanceTabs({ recurringInvoicesManage: true });
    const billing = tabs.find((t) => t.label === "Billing")!;
    for (const path of ["/invoices", "/quotes", "/recurring-invoices"]) {
      expect(isTabActive(path, billing.href)).toBe(false);
    }
  });
});

describe("Work tabs (buildWorkTabs)", () => {
  it("8. exactly 4 tabs, at exactly the 4 approved routes, in order", () => {
    const tabs = buildWorkTabs();
    expect(hrefs(tabs)).toEqual(["/projects", "/tasks", "/calendar", "/time"]);
  });

  it("9. each tab is active on its own list/index page", () => {
    const tabs = buildWorkTabs();
    expect(isTabActive("/projects", tabs[0].href)).toBe(true);
    expect(isTabActive("/tasks", tabs[1].href)).toBe(true);
    expect(isTabActive("/calendar", tabs[2].href)).toBe(true);
    expect(isTabActive("/time", tabs[3].href)).toBe(true);
  });

  it("10. no tab ever includes a create/detail-route href — list/index pages only, per approved scope", () => {
    const tabs = buildWorkTabs();
    for (const tab of tabs) {
      expect(tab.href).not.toMatch(/\/(new|\[id\])/);
    }
  });

  it("Projects' own tab is not active on a nested detail/create route by construction — buildWorkTabs never targets those paths, matching the pages themselves never mounting WorkTabs there", () => {
    const tabs = buildWorkTabs();
    const projects = tabs.find((t) => t.href === "/projects")!;
    // isTabActive itself would still prefix-match /projects/123 — the
    // real exclusion is architectural (WorkTabs is never rendered on
    // /projects/[id] at all, see projects/[id]/page.tsx, untouched by
    // this feature), not a pathname exception inside this function.
    expect(isTabActive("/projects/123", projects.href)).toBe(true);
  });
});

describe("Insights tabs (buildInsightsTabs)", () => {
  it("11. Activity is always visible, regardless of Analytics/Reports permissions", () => {
    const bothDenied = buildInsightsTabs({ analyticsView: false, reportsView: false });
    expect(visibleHrefs(bothDenied)).toContain("/activity");
  });

  it("12. Analytics and Reports are independently permission-filtered", () => {
    expect(visibleHrefs(buildInsightsTabs({ analyticsView: false, reportsView: true }))).toEqual(["/reports", "/activity"]);
    expect(visibleHrefs(buildInsightsTabs({ analyticsView: true, reportsView: false }))).toEqual(["/analytics", "/activity"]);
  });

  it("13. when both Analytics and Reports are unavailable, only Activity remains", () => {
    const tabs = buildInsightsTabs({ analyticsView: false, reportsView: false });
    expect(visibleHrefs(tabs)).toEqual(["/activity"]);
  });

  it("all three tabs are present, in order, when every permission is granted", () => {
    const tabs = buildInsightsTabs({ analyticsView: true, reportsView: true });
    expect(hrefs(tabs)).toEqual(["/analytics", "/reports", "/activity"]);
  });
});

describe("Documents tabs (buildDocumentsTabs)", () => {
  it("14. Contracts tab exists, and is active on /contracts", () => {
    const tabs = buildDocumentsTabs();
    expect(hrefs(tabs)).toEqual(["/contracts"]);
    expect(isTabActive("/contracts", tabs[0].href)).toBe(true);
  });

  it("15. no Templates tab is ever present", () => {
    const tabs = buildDocumentsTabs();
    expect(hrefs(tabs)).not.toContain("/settings/templates");
  });
});
