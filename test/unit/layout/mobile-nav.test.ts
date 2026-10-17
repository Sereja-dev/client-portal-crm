import { describe, expect, it } from "vitest";
import { buildSidebarGroups, type SidebarPermissionFlags } from "@/components/layout/sidebar";
import {
  MOBILE_BOTTOM_NAV_GROUP_KEYS,
  MOBILE_MORE_KEY,
  buildMobileBottomNavItems,
  buildMoreDrawerGroups,
  computeActiveMobileNavKey,
  shouldShowMobileBottomNav,
} from "@/components/navigation/mobile-nav";

/**
 * Mobile Navigation Foundation (Mobile Improvement Slice A). Mirrors
 * sidebar.test.ts's own flags() helper and overall structure exactly —
 * this suite proves mobile-nav.ts derives every bottom-nav/More-drawer
 * fact from buildSidebarGroups' own already-proven output, never a
 * second, independently-maintained route list.
 */

function flags(overrides: Partial<SidebarPermissionFlags> = {}): SidebarPermissionFlags {
  return {
    recurringInvoicesManage: true,
    analyticsView: true,
    reportsView: true,
    ...overrides,
  };
}

describe("buildMobileBottomNavItems", () => {
  it("returns exactly Home/Clients/Work/Finance, in that order", () => {
    const groups = buildSidebarGroups(flags());
    const items = buildMobileBottomNavItems(groups);
    expect(items.map((i) => i.key)).toEqual(["home", "clients", "work", "finance"]);
    expect(items.map((i) => i.label)).toEqual(["Home", "Clients", "Work", "Finance"]);
  });

  it("each item's href is its own group's first child href — the approved destinations", () => {
    const groups = buildSidebarGroups(flags());
    const items = buildMobileBottomNavItems(groups);
    const hrefByKey = Object.fromEntries(items.map((i) => [i.key, i.href]));
    expect(hrefByKey.home).toBe("/dashboard");
    expect(hrefByKey.clients).toBe("/clients");
    expect(hrefByKey.work).toBe("/projects");
    expect(hrefByKey.finance).toBe("/finance");
  });

  it("Work's matchHrefs are exactly /projects, /tasks, /time, /calendar", () => {
    const items = buildMobileBottomNavItems(buildSidebarGroups(flags()));
    const work = items.find((i) => i.key === "work")!;
    expect(work.matchHrefs).toEqual(["/projects", "/tasks", "/time", "/calendar"]);
  });

  it("Finance's matchHrefs are exactly /finance, /invoices, /recurring-invoices, /settings/billing", () => {
    const items = buildMobileBottomNavItems(buildSidebarGroups(flags()));
    const finance = items.find((i) => i.key === "finance")!;
    expect(finance.matchHrefs).toEqual(["/finance", "/invoices", "/recurring-invoices", "/settings/billing"]);
  });

  it("Clients' matchHrefs are exactly /clients", () => {
    const items = buildMobileBottomNavItems(buildSidebarGroups(flags()));
    expect(items.find((i) => i.key === "clients")!.matchHrefs).toEqual(["/clients"]);
  });

  it("Finance drops Recurring Invoices from matchHrefs when recurringInvoicesManage is false, without losing the item itself", () => {
    const items = buildMobileBottomNavItems(buildSidebarGroups(flags({ recurringInvoicesManage: false })));
    const finance = items.find((i) => i.key === "finance")!;
    expect(finance.matchHrefs).toEqual(["/finance", "/invoices", "/settings/billing"]);
  });

  it("every item carries its own group's real icon function", () => {
    const items = buildMobileBottomNavItems(buildSidebarGroups(flags()));
    for (const item of items) {
      expect(typeof item.icon).toBe("function");
    }
  });
});

describe("buildMoreDrawerGroups", () => {
  it("contains exactly Sales/Documents/Support/Insights/Team/Settings, in GROUP_SOURCE's own order", () => {
    const groups = buildSidebarGroups(flags());
    const more = buildMoreDrawerGroups(groups);
    expect(more.map((g) => g.key)).toEqual(["sales", "documents", "support", "insights", "team", "settings"]);
  });

  it("never includes any of the four promoted bottom-nav groups", () => {
    const more = buildMoreDrawerGroups(buildSidebarGroups(flags()));
    for (const key of MOBILE_BOTTOM_NAV_GROUP_KEYS) {
      expect(more.some((g) => g.key === key)).toBe(false);
    }
  });

  it("a permission-hidden child remains hidden inside the More drawer too (same source, same filtering)", () => {
    const more = buildMoreDrawerGroups(buildSidebarGroups(flags({ analyticsView: false, reportsView: false })));
    const insights = more.find((g) => g.key === "insights")!;
    expect(insights.links.map((l) => l.href)).toEqual(["/activity"]);
  });
});

describe("computeActiveMobileNavKey", () => {
  const items = buildMobileBottomNavItems(buildSidebarGroups(flags()));

  it("/dashboard -> home", () => {
    expect(computeActiveMobileNavKey("/dashboard", items)).toBe("home");
  });

  it("/clients -> clients, and a Client Hub detail route stays clients too", () => {
    expect(computeActiveMobileNavKey("/clients", items)).toBe("clients");
    expect(computeActiveMobileNavKey("/clients/11111111-1111-1111-1111-111111111111", items)).toBe("clients");
  });

  it("/projects, /tasks, /time, /calendar -> work", () => {
    for (const path of ["/projects", "/tasks", "/time", "/calendar"]) {
      expect(computeActiveMobileNavKey(path, items)).toBe("work");
    }
  });

  it("/finance, /invoices, /recurring-invoices, /settings/billing -> finance", () => {
    for (const path of ["/finance", "/invoices", "/recurring-invoices", "/settings/billing"]) {
      expect(computeActiveMobileNavKey(path, items)).toBe("finance");
    }
  });

  it("/quotes -> more (Quotes belongs to Sales in GROUP_SOURCE, not Finance — never reassigned here)", () => {
    expect(computeActiveMobileNavKey("/quotes", items)).toBe(MOBILE_MORE_KEY);
  });

  it("/contracts -> more (Documents is not one of the four promoted groups)", () => {
    expect(computeActiveMobileNavKey("/contracts", items)).toBe(MOBILE_MORE_KEY);
  });

  it("/settings/company -> more (Settings fallback is a desktop-only computeActiveGroupKey concept; mobile has no such fallback here, it simply isn't one of the four promoted groups)", () => {
    expect(computeActiveMobileNavKey("/settings/company", items)).toBe(MOBILE_MORE_KEY);
  });

  it("an unrelated path -> more", () => {
    expect(computeActiveMobileNavKey("/some-unrelated-path", items)).toBe(MOBILE_MORE_KEY);
  });

  it("never resolves to both a real item and more for the same path", () => {
    for (const path of ["/dashboard", "/clients", "/projects", "/finance", "/quotes", "/nope"]) {
      const result = computeActiveMobileNavKey(path, items);
      expect([...MOBILE_BOTTOM_NAV_GROUP_KEYS, MOBILE_MORE_KEY]).toContain(result);
    }
  });
});

describe("shouldShowMobileBottomNav", () => {
  it("visible on ordinary list/overview/dashboard routes", () => {
    for (const path of [
      "/dashboard",
      "/clients",
      "/projects",
      "/tasks",
      "/time",
      "/calendar",
      "/finance",
      "/invoices",
      "/recurring-invoices",
      "/settings/billing",
      "/quotes",
      "/contracts",
    ]) {
      expect(shouldShowMobileBottomNav(path)).toBe(true);
    }
  });

  it("visible on ordinary entity detail/Hub pages with a dynamic id — never hidden merely for having one", () => {
    const uuid = "11111111-1111-1111-1111-111111111111";
    expect(shouldShowMobileBottomNav(`/clients/${uuid}`)).toBe(true);
    expect(shouldShowMobileBottomNav(`/projects/${uuid}`)).toBe(true);
    expect(shouldShowMobileBottomNav(`/contracts/${uuid}`)).toBe(true);
    expect(shouldShowMobileBottomNav(`/recurring-invoices/${uuid}`)).toBe(true);
    expect(shouldShowMobileBottomNav(`/clients/${uuid}?tab=invoices`)).toBe(true);
  });

  it("hidden on every entity's /new route", () => {
    for (const path of [
      "/clients/new",
      "/leads/new",
      "/projects/new",
      "/tasks/new",
      "/time/new",
      "/invoices/new",
      "/quotes/new",
      "/recurring-invoices/new",
      "/contracts/new",
    ]) {
      expect(shouldShowMobileBottomNav(path)).toBe(false);
    }
  });

  it("hidden on every entity's /[id]/edit route", () => {
    const uuid = "22222222-2222-2222-2222-222222222222";
    for (const base of ["/clients", "/leads", "/projects", "/tasks", "/invoices", "/quotes", "/recurring-invoices", "/contracts"]) {
      expect(shouldShowMobileBottomNav(`${base}/${uuid}/edit`)).toBe(false);
    }
  });

  it("hidden on Invoice/Quote duplicate routes", () => {
    const uuid = "33333333-3333-3333-3333-333333333333";
    expect(shouldShowMobileBottomNav(`/invoices/${uuid}/duplicate`)).toBe(false);
    expect(shouldShowMobileBottomNav(`/quotes/${uuid}/duplicate`)).toBe(false);
  });

  it("hidden on Time Entries' own combined detail/edit page, even though it has no /edit suffix", () => {
    const uuid = "44444444-4444-4444-4444-444444444444";
    expect(shouldShowMobileBottomNav(`/time/${uuid}`)).toBe(false);
  });

  it("hidden on Company Settings' own long-form editor", () => {
    expect(shouldShowMobileBottomNav("/settings/company")).toBe(false);
  });

  it("template-family list pages stay visible; their own new/edit editors hide", () => {
    const uuid = "55555555-5555-5555-5555-555555555555";
    for (const base of [
      "/settings/contract-templates",
      "/settings/invoice-templates",
      "/settings/templates",
      "/settings/workflow-automations",
      "/settings/lead-capture-forms",
    ]) {
      expect(shouldShowMobileBottomNav(base)).toBe(true);
      expect(shouldShowMobileBottomNav(`${base}/new`)).toBe(false);
      expect(shouldShowMobileBottomNav(`${base}/${uuid}`)).toBe(false);
    }
  });

  it("never hides an unrelated /settings/* page that merely shares a path prefix", () => {
    expect(shouldShowMobileBottomNav("/settings/notifications")).toBe(true);
    expect(shouldShowMobileBottomNav("/settings/domain")).toBe(true);
    expect(shouldShowMobileBottomNav("/settings/billing")).toBe(true);
  });

  it("CSV import flows are a deliberate, out-of-scope exclusion for this slice — remain visible", () => {
    expect(shouldShowMobileBottomNav("/clients/import")).toBe(true);
    expect(shouldShowMobileBottomNav("/leads/import")).toBe(true);
  });
});
