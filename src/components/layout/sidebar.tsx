"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { siteConfig } from "@/config/site";

const BASE_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  // Calendar V1 — placed immediately after Dashboard, before Leads
  // (locked architecture §1): a daily-use operational surface like
  // Dashboard itself, not a business-record list. Visible to every
  // Staff role (OWNER/ADMIN/MEMBER, locked architecture §5) — no role
  // gate here, matching Contracts' own un-gated placement in this same
  // array.
  { href: "/calendar", label: "Calendar" },
  { href: "/leads", label: "Leads" },
  { href: "/clients", label: "Clients" },
  { href: "/projects", label: "Projects" },
  { href: "/tasks", label: "Tasks" },
  { href: "/time", label: "Time" },
  { href: "/requests", label: "Requests" },
  { href: "/quotes", label: "Quotes" },
  { href: "/invoices", label: "Invoices" },
  // Contracts Phase 2 (Staff UI) — placed immediately after Invoices, the
  // same operational-record tier (never under Settings — Contracts are a
  // business record like Quote/Invoice, not organization configuration).
  // Visible to every Staff role (OWNER/ADMIN/MEMBER, locked architecture
  // §I) — no role gate here, unlike Recurring Invoices' own OWNER/ADMIN
  // link just below.
  { href: "/contracts", label: "Contracts" },
];

// Recurring Invoices Phase 2A — gated by the effective
// RECURRING_INVOICES_MANAGE permission as of Roles / Permissions V1
// (locked spec §12), matching the Phase 1 domain layer's own "the whole
// feature is privileged-only, not just its write paths" gate
// (getRecurringInvoice/listRecurringInvoices are denied the same as
// create/update). This is a UI convenience only — every Recurring
// Invoices route/Server Action independently re-verifies the effective
// permission server-side regardless of whether this link is rendered; a
// denied Staff member navigating to /recurring-invoices directly still
// gets denied by the page itself, never by relying on this link being
// hidden.
const RECURRING_INVOICES_LINK = { href: "/recurring-invoices", label: "Recurring Invoices" };

const TRAILING_LINKS = [
  { href: "/team", label: "Team" },
  { href: "/activity", label: "Activity" },
  { href: "/analytics", label: "Analytics" },
  // Reports Phase 2, now gated by the effective REPORTS_VIEW permission
  // (locked spec §12) — placed immediately after Analytics, same
  // treatment. This resolves the pre-V1 "show the link to everyone, let
  // the page deny" inconsistency Analytics/Reports used to be the sole
  // exception for (every other OWNER/ADMIN-only nav item already hid
  // its own link) — the page's own server-side check
  // (AnalyticsAccessDenied/ReportsAccessDenied) remains the real,
  // independent security boundary either way; this only changes
  // discoverability.
  { href: "/reports", label: "Reports" },
  { href: "/settings/notifications", label: "Settings" },
  { href: "/settings/billing", label: "Billing" },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Roles / Permissions V1 — already-resolved effective permission flags
 * (locked spec §9's own "request-local resolution, passed through the
 * render tree" recommendation), never a Role or an async call made
 * inside this function itself — the caller (DashboardLayout) resolves
 * these once per request via getEffectivePermissionSet and passes them
 * down, keeping buildSidebarLinks a plain, synchronously-testable
 * function exactly as before.
 */
export type SidebarPermissionFlags = {
  recurringInvoicesManage: boolean;
  analyticsView: boolean;
  reportsView: boolean;
};

/**
 * Exported as a pure function for direct unit testing (items 41/42) — the
 * Sidebar component itself calls next/navigation's usePathname(), which
 * throws under renderToStaticMarkup (same "no DOM/component-interaction
 * harness" limitation StaffRequestControls' own render.test.tsx already
 * documents), so the actual gating decision lives here instead,
 * independent of the component that consumes it.
 */
export function buildSidebarLinks(flags: SidebarPermissionFlags): { href: string; label: string }[] {
  const trailing = TRAILING_LINKS.filter((link) => {
    if (link.href === "/analytics") return flags.analyticsView;
    if (link.href === "/reports") return flags.reportsView;
    return true;
  });
  return [...BASE_LINKS, ...(flags.recurringInvoicesManage ? [RECURRING_INVOICES_LINK] : []), ...trailing];
}

export function Sidebar({
  disablePrefetch = false,
  permissions,
}: {
  disablePrefetch?: boolean;
  permissions: SidebarPermissionFlags;
}) {
  const pathname = usePathname();
  const links = buildSidebarLinks(permissions);

  return (
    <nav
      aria-label="Primary"
      // Design System Phase 2 — bg-surface-recessed: globals.css's own
      // token comment names "sidebar" as one of surface-recessed's
      // intended consumers (the Round 3 "quiet, recessed chrome" tier,
      // one step back from the main bg-background content area).
      className="border-border-default bg-surface-recessed flex shrink-0 gap-1 overflow-x-auto border-b p-3 md:w-56 md:flex-col md:gap-1.5 md:border-r md:border-b-0 md:p-4"
    >
      <span className="text-text-primary hidden px-2 pb-4 text-lg font-semibold tracking-tight md:block">
        {siteConfig.name}
      </span>
      {links.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            // Prefetch is only ever active against a real production build
            // (next start) — which is exactly how the E2E suite runs the
            // app. Against the single-connection PGlite backend those
            // tests share (see src/lib/prisma.ts), a background prefetch
            // for one of these links can queue behind — or get abandoned
            // mid-flight by a test's own navigation, permanently jamming
            // — the one shared query queue. Disabling it only in
            // TEST_MODE (never in a real deployment) removes that whole
            // class of intermittent E2E hangs.
            prefetch={disablePrefetch ? false : undefined}
            // Aqenra brand PR 2 — active-state bg-black replaced with the
            // approved Aqenra Indigo accent token (globals.css).
            // Design System Phase 2 — the focus ring and inactive-link
            // colors below (previously ring-black/text-gray-700/
            // hover:bg-gray-100, the "deliberately deferred normalization"
            // this PR's own audit picked up) now use the same semantic
            // tokens the active state already did.
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ${
              active ? "bg-accent text-white" : "text-text-secondary hover:bg-[var(--hover)]"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
