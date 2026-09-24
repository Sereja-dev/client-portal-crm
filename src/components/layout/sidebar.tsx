"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { siteConfig } from "@/config/site";
import {
  HomeIcon,
  SalesIcon,
  ClientsIcon,
  WorkIcon,
  FinanceIcon,
  DocumentsIcon,
  SupportIcon,
  InsightsIcon,
  TeamIcon,
  SettingsGroupIcon,
  ChevronDownIcon,
  type IconProps,
} from "@/components/ui/icons";

/**
 * Sidebar Information Architecture (read-only audit, then this narrow
 * implementation). Replaces the previous flat 18-item list with the
 * Product-approved 10-group structure. Presentation only — no route, no
 * permission semantics, no Server Action changed anywhere in this file or
 * by it.
 *
 * `visible` is the exact same per-link gating BASE_LINKS/TRAILING_LINKS
 * used before (Recurring Invoices/Analytics/Reports), just relocated onto
 * each group's own child entry — never a new role check, never a second,
 * independent authorization decision. Every gated route's own page/Server
 * Action still independently re-verifies the same permission server-side,
 * unchanged; hiding a link here remains discoverability only.
 */
type SidebarChildLink = {
  href: string;
  label: string;
  visible?: (flags: SidebarPermissionFlags) => boolean;
};

type SidebarGroupSource = {
  key: string;
  /** Rendered as this group's own top-level label — including for a
   * single-destination group, where it replaces the one child's own
   * label (e.g. "Documents", not "Contracts") so the user still perceives
   * the approved top-level work area, not the underlying route's name. */
  label: string;
  icon: (props: IconProps) => React.ReactElement;
  children: SidebarChildLink[];
};

const GROUP_SOURCE: readonly SidebarGroupSource[] = [
  { key: "home", label: "Home", icon: HomeIcon, children: [{ href: "/dashboard", label: "Dashboard" }] },
  {
    key: "sales",
    label: "Sales",
    icon: SalesIcon,
    children: [
      { href: "/leads", label: "Leads" },
      { href: "/quotes", label: "Quotes" },
    ],
  },
  { key: "clients", label: "Clients", icon: ClientsIcon, children: [{ href: "/clients", label: "Clients" }] },
  {
    key: "work",
    label: "Work",
    icon: WorkIcon,
    children: [
      { href: "/projects", label: "Projects" },
      { href: "/tasks", label: "Tasks" },
      { href: "/time", label: "Time" },
      // Calendar V1 (locked architecture §1) — visible to every Staff role,
      // never gated, same as before this restructure; Work is the more
      // precise semantic fit than Home (see the read-only audit's own §H).
      { href: "/calendar", label: "Calendar" },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    icon: FinanceIcon,
    children: [
      { href: "/invoices", label: "Invoices" },
      // Recurring Invoices Phase 2A — same recurringInvoicesManage gate as
      // before, just relocated from a standalone conditional array entry
      // onto this group's own child list.
      { href: "/recurring-invoices", label: "Recurring Invoices", visible: (f) => f.recurringInvoicesManage },
      // Billing placement (read-only audit §I): SaaS subscription/account
      // administration is still fundamentally "money," grouped with the
      // org's other financial destinations rather than under Settings.
      // SettingsNav (src/components/settings/settings-nav.tsx) is
      // unchanged and still lists Billing among Settings' own pages too —
      // this is deliberately not an either/or.
      { href: "/settings/billing", label: "Billing" },
    ],
  },
  {
    key: "documents",
    label: "Documents",
    icon: DocumentsIcon,
    // Templates intentionally excluded (locked spec §2) — it remains a
    // Settings-only page (/settings/templates), never duplicated here.
    children: [{ href: "/contracts", label: "Contracts" }],
  },
  {
    key: "support",
    label: "Support",
    icon: SupportIcon,
    // Client Requests/Tickets — the existing, real route that best matches
    // "Support" (read-only audit §K). No new route created.
    children: [{ href: "/requests", label: "Requests" }],
  },
  {
    key: "insights",
    label: "Insights",
    icon: InsightsIcon,
    children: [
      { href: "/analytics", label: "Analytics", visible: (f) => f.analyticsView },
      { href: "/reports", label: "Reports", visible: (f) => f.reportsView },
      // Activity placement (read-only audit §J): a cross-object audit
      // feed, not a daily-use work destination — grouped with Analytics/
      // Reports, matching the existing PermissionGroup catalog's own
      // independent "Insights" bucket for ANALYTICS_VIEW/REPORTS_VIEW
      // (src/lib/permissions/catalog.ts). Never gated itself — same
      // unconditional visibility as before this restructure.
      { href: "/activity", label: "Activity" },
    ],
  },
  { key: "team", label: "Team", icon: TeamIcon, children: [{ href: "/team", label: "Team" }] },
  {
    key: "settings",
    label: "Settings",
    icon: SettingsGroupIcon,
    // Unchanged destination (/settings/notifications) — SettingsNav
    // remains the real in-section nav for every other /settings/* page.
    children: [{ href: "/settings/notifications", label: "Settings" }],
  },
];

export type SidebarPermissionFlags = {
  recurringInvoicesManage: boolean;
  analyticsView: boolean;
  reportsView: boolean;
};

export type SidebarNavGroup = {
  key: string;
  label: string;
  icon: (props: IconProps) => React.ReactElement;
  links: { href: string; label: string }[];
};

/**
 * Exported as a pure function for direct unit testing, same reasoning the
 * previous flat buildSidebarLinks() already established: Sidebar itself
 * calls next/navigation's usePathname(), which throws under
 * renderToStaticMarkup, so the actual group/gating shape lives here,
 * independent of the component that consumes it. A group whose every
 * child is hidden by permission (there is no such group in the current
 * approved mapping, but Insights can shrink to Activity alone) is never
 * dropped entirely unless truly empty — filtered out only when `links`
 * would be empty.
 */
export function buildSidebarGroups(flags: SidebarPermissionFlags): SidebarNavGroup[] {
  return GROUP_SOURCE.map((group) => ({
    key: group.key,
    label: group.label,
    icon: group.icon,
    links: group.children.filter((child) => !child.visible || child.visible(flags)),
  })).filter((group) => group.links.length > 0);
}

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Exactly one active group per pathname, in two tiers:
 *
 *   1. A pathname matching one of a group's own explicitly configured
 *      child hrefs (via isActive's existing prefix rule) always wins —
 *      this is what makes /settings/billing resolve to Finance, never
 *      Settings, even though its literal path prefix is /settings/
 *      (locked spec §7's own explicit requirement).
 *   2. Only if no group's explicit children matched at all, a bare
 *      /settings/* fallback resolves to the Settings group — every other
 *      /settings/* subpage (Company, Payment, Domain, Custom Fields, ...)
 *      has no explicit primary-sidebar entry of its own (SettingsNav is
 *      its real in-section nav), so Settings remains the correct default
 *      owner of the whole family except what's been explicitly carved
 *      out (Billing).
 *
 * Never both at once — this function always returns a single key or
 * null, by construction, so a group's own "active" treatment and
 * Settings' own "active" treatment can never both be true for the same
 * render.
 */
export function computeActiveGroupKey(pathname: string, groups: SidebarNavGroup[]): string | null {
  for (const group of groups) {
    if (group.links.some((link) => isActive(pathname, link.href))) {
      return group.key;
    }
  }
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return "settings";
  }
  return null;
}

const TOP_LEVEL_ROW_BASE =
  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2";
const CHILD_ROW_BASE =
  "block rounded-md px-3 py-1.5 text-sm font-normal transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2";

function activeLinkClasses(active: boolean): string {
  return active ? "bg-accent text-white" : "text-text-secondary hover:bg-[var(--hover)]";
}

export function Sidebar({
  disablePrefetch = false,
  permissions,
}: {
  disablePrefetch?: boolean;
  permissions: SidebarPermissionFlags;
}) {
  const pathname = usePathname();
  const groups = buildSidebarGroups(permissions);
  const activeGroupKey = computeActiveGroupKey(pathname, groups);

  return (
    <nav
      aria-label="Primary"
      className="border-border-default bg-surface-recessed flex shrink-0 gap-1 overflow-x-auto border-b p-3 md:w-56 md:flex-col md:gap-0.5 md:overflow-x-visible md:border-r md:border-b-0 md:p-4"
    >
      <span className="text-text-primary hidden px-2 pb-4 text-lg font-semibold tracking-tight md:block">
        {siteConfig.name}
      </span>
      {groups.map((group) => {
        const groupActive = group.key === activeGroupKey;
        const Icon = group.icon;

        // Single-destination group (locked spec §6): a direct top-level
        // link, labeled with the GROUP's own name (not the one child's
        // label), so the user still perceives the approved top-level work
        // area — never an awkward one-item dropdown. The same rule
        // (links.length === 1) also covers Insights degrading to just
        // Activity when Analytics/Reports are both permission-hidden.
        if (group.links.length === 1) {
          const link = group.links[0];
          return (
            <Link
              key={group.key}
              href={link.href}
              aria-current={groupActive ? "page" : undefined}
              prefetch={disablePrefetch ? false : undefined}
              className={`${TOP_LEVEL_ROW_BASE} whitespace-nowrap ${activeLinkClasses(groupActive)}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{group.label}</span>
            </Link>
          );
        }

        return (
          <div key={group.key} className="shrink-0 md:shrink">
            {/*
              Group-active treatment (locked spec §7/§9): a subtler wash
              (--selected/--accent-subtle, already documented in
              globals.css as "future selected-row wash") distinct from a
              real active LINK's solid bg-accent — this summary is never
              itself a navigable destination, only the section a real
              active child currently lives in. `open` is a plain derived
              boolean, never custom toggle state: React only re-syncs the
              DOM `open` attribute when this value itself changes between
              renders (i.e. when navigation actually changes which group
              is active), so a user's own manual expand/collapse within
              the same route is never fought (locked spec §5's own
              "avoid a state model that fights native <details> behavior").
              flex/flex-row on mobile puts the summary and (when open) its
              children side by side in the nav's own horizontal scroll
              row; md:block reverts to <details>'s own normal stacked
              layout on desktop.
            */}
            <details open={groupActive} className="group flex flex-row items-center gap-0.5 md:block">
              <summary
                className={`${TOP_LEVEL_ROW_BASE} cursor-pointer list-none whitespace-nowrap [&::-webkit-details-marker]:hidden ${
                  groupActive ? "bg-[var(--selected)] text-accent" : "text-text-secondary hover:bg-[var(--hover)]"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{group.label}</span>
                <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              {/*
                Desktop (md:): a normal in-flow vertical accordion — the
                child list simply pushes subsequent groups down, indented
                under its own group label, exactly like every other native
                <details> expansion (md:flex-col).
                Mobile (below md:): the primary nav is one horizontally-
                scrolling row (unchanged). Deliberately NOT an absolutely-
                positioned dropdown here — this <nav> already sets
                overflow-x-auto, and per the CSS overflow spec a non-
                visible overflow-x forces overflow-y to compute as
                non-visible too, so an absolute/floating panel nested
                inside it risks being silently clipped rather than shown.
                Instead, an open group's children simply become a few more
                pill items in the SAME horizontal scroll row, immediately
                after their own group's summary (flex-row, no wrapping) —
                genuinely "compact native disclosure... usable on touch"
                (locked spec §11), never a floating panel, never several
                screens tall, and immune to the clipping risk above.
              */}
              <div className="flex flex-row flex-nowrap gap-0.5 md:flex-col md:gap-0.5 md:pl-6">
                {group.links.map((link) => {
                  const childActive = isActive(pathname, link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-current={childActive ? "page" : undefined}
                      prefetch={disablePrefetch ? false : undefined}
                      className={`${CHILD_ROW_BASE} whitespace-nowrap ${activeLinkClasses(childActive)}`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            </details>
          </div>
        );
      })}
    </nav>
  );
}
