import { SectionTabs, type SectionTab } from "@/components/navigation/section-tabs";

/**
 * Section Consolidation §2/§6 — Finance's own tab set. Mounted directly
 * on /invoices, /quotes, and /recurring-invoices (never as a shared
 * route-group layout, unlike Work/Insights): Quotes is conceptually
 * Sales-owned in the primary Sidebar and Billing physically lives inside
 * settings/layout.tsx's own already-owned route tree, so no single
 * physical folder grouping could cover all four destinations without
 * either reopening the Sidebar IA or duplicating SettingsNav — the
 * read-only audit's own §E/§R conclusion. Billing therefore appears
 * here purely as a navigational destination (never rendered *on*
 * /settings/billing itself — see settings/billing/page.tsx, untouched)
 * exactly mirroring how sidebar.tsx's own Finance group already links to
 * Billing while SettingsNav independently keeps listing it too ("this is
 * deliberately not an either/or").
 *
 * `buildFinanceTabs` is exported as a pure function (mirroring sidebar.tsx's
 * own buildSidebarGroups()) so its shape is directly unit-testable without
 * rendering; FinanceTabs itself is the thin component wrapper.
 * `recurringInvoicesManage` is the caller's own already-resolved
 * RECURRING_INVOICES_MANAGE effective permission (the same source
 * (dashboard)/layout.tsx's own Sidebar already uses) — this module never
 * queries or derives it itself.
 */
export function buildFinanceTabs({ recurringInvoicesManage }: { recurringInvoicesManage: boolean }): SectionTab[] {
  return [
    { label: "Invoices", href: "/invoices" },
    { label: "Quotes", href: "/quotes" },
    { label: "Recurring", href: "/recurring-invoices", hidden: !recurringInvoicesManage },
    { label: "Billing", href: "/settings/billing" },
  ];
}

export function FinanceTabs({ recurringInvoicesManage }: { recurringInvoicesManage: boolean }) {
  return <SectionTabs label="Finance" tabs={buildFinanceTabs({ recurringInvoicesManage })} />;
}
