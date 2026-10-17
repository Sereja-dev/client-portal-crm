import { isActive, type SidebarNavGroup } from "@/components/layout/sidebar";
import type { IconProps } from "@/components/ui/icons";

/**
 * Mobile Navigation Foundation (Mobile Improvement Slice A). Pure, DOM-
 * free functions only — mirrors sidebar.tsx's own "the actual
 * group/gating shape lives in a pure function, independent of the
 * component that consumes it" discipline exactly, for the same reason:
 * `usePathname()` throws under `renderToStaticMarkup`, so every decision
 * that needs to be unit-tested lives here, not inside MobileNavigation
 * itself.
 *
 * This module introduces NO second navigation tree. Every function below
 * operates on `buildSidebarGroups(permissions)`'s own already-permission-
 * filtered output (sidebar.tsx) — the one centralized, authorization-
 * aware source every mobile surface must keep reusing, never a parallel
 * hardcoded route list.
 */

/**
 * The four Sidebar groups promoted to direct bottom-nav items — approved
 * Product decision, in the exact order they appear in GROUP_SOURCE
 * (sidebar.tsx). Every other group (Sales, Documents, Support, Insights,
 * Team, Settings) renders inside the "More" drawer instead — see
 * `buildMoreDrawerGroups`.
 */
export const MOBILE_BOTTOM_NAV_GROUP_KEYS = ["home", "clients", "work", "finance"] as const;

export const MOBILE_MORE_KEY = "more";

export type MobileBottomNavItem = {
  key: string;
  label: string;
  /** The group's own first child href — Home→/dashboard, Clients→/clients, Work→/projects, Finance→/finance, all already exactly the approved destinations without a second, separately-maintained href list. */
  href: string;
  icon: (props: IconProps) => React.ReactElement;
  /** Every href this item's own group owns (sidebar.tsx's own child list) — the full active-state match set, not just `href` itself. */
  matchHrefs: string[];
};

/**
 * Derives the four bottom-nav items directly from `buildSidebarGroups`'s
 * own output — never a second hardcoded href table. A group that ends up
 * with zero visible children (not possible for Home/Clients/Work/Finance
 * today, since none of their children are permission-gated — see
 * sidebar.tsx's own GROUP_SOURCE — but defensively handled anyway,
 * exactly like buildSidebarGroups itself already drops an empty group)
 * is simply omitted rather than rendered as a dead link.
 */
export function buildMobileBottomNavItems(groups: readonly SidebarNavGroup[]): MobileBottomNavItem[] {
  const items: MobileBottomNavItem[] = [];
  for (const key of MOBILE_BOTTOM_NAV_GROUP_KEYS) {
    const group = groups.find((g) => g.key === key);
    if (!group || group.links.length === 0) continue;
    items.push({
      key: group.key,
      label: group.label,
      href: group.links[0].href,
      icon: group.icon,
      matchHrefs: group.links.map((link) => link.href),
    });
  }
  return items;
}

/**
 * Every group NOT promoted to a direct bottom-nav item — rendered inside
 * the More drawer, in their own existing GROUP_SOURCE order, already
 * permission-filtered (an empty group never reaches here at all — see
 * buildSidebarGroups' own final `.filter`).
 */
export function buildMoreDrawerGroups(groups: readonly SidebarNavGroup[]): SidebarNavGroup[] {
  return groups.filter((group) => !(MOBILE_BOTTOM_NAV_GROUP_KEYS as readonly string[]).includes(group.key));
}

/**
 * Exactly one of the four bottom-nav items, or "more" — never both an
 * item and "more" at once, and More is never active merely because the
 * current route is *also* discoverable elsewhere (e.g. `/quotes` belongs
 * to the Sales group — not one of the four promoted groups — so it
 * always resolves to "more" here, even though Finance is a visually
 * adjacent destination; this follows GROUP_SOURCE's own existing
 * ownership exactly, the same "no casual reassignment" discipline
 * computeActiveGroupKey already established for desktop).
 */
export function computeActiveMobileNavKey(pathname: string, bottomNavItems: readonly MobileBottomNavItem[]): string {
  for (const item of bottomNavItems) {
    if (item.matchHrefs.some((href) => isActive(pathname, href))) {
      return item.key;
    }
  }
  return MOBILE_MORE_KEY;
}

// ---------------------------------------------------------------------
// Focused-form route visibility
// ---------------------------------------------------------------------

/**
 * Entities whose `/new`, `/[id]/edit`, and `/[id]/duplicate` routes are
 * genuine focused create/edit forms — confirmed individually from source
 * (each entity's own route directory), not assumed from a naming
 * convention. Deliberately excludes each entity's own bare `/[id]`
 * (and `/[id]?tab=...`) shape: Clients, Projects, Contracts, and
 * Recurring Invoices each have a real, separate, read-first Hub/detail
 * page at exactly that bare shape (Client Profile Hub, Project Hub,
 * Contract detail, Recurring Invoice detail — all confirmed this
 * session) which must stay visible per the approved Product decision
 * ("do not hide bottom nav from ordinary entity detail pages merely
 * because they have a dynamic id").
 */
const FOCUSED_FORM_ENTITY_BASES = [
  "/clients",
  "/leads",
  "/projects",
  "/tasks",
  "/invoices",
  "/quotes",
  "/recurring-invoices",
  "/contracts",
] as const;

/**
 * Settings template-family editors — the list/index page
 * (`/settings/{family}`) stays visible; only the individual new/edit
 * editor hides, per the approved Settings decision.
 */
const TEMPLATE_FAMILY_BASES = [
  "/settings/contract-templates",
  "/settings/invoice-templates",
  "/settings/templates",
  "/settings/workflow-automations",
  "/settings/lead-capture-forms",
] as const;

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const FOCUSED_FORM_PATTERNS: readonly RegExp[] = [
  ...FOCUSED_FORM_ENTITY_BASES.flatMap((base) => {
    const escaped = escapeForRegex(base);
    return [
      new RegExp(`^${escaped}/new$`),
      new RegExp(`^${escaped}/[^/]+/edit$`),
      new RegExp(`^${escaped}/[^/]+/duplicate$`),
    ];
  }),
  // Time Entries: no separate /edit route exists at all — the combined
  // detail/edit page lives directly at /time/[id] (confirmed from
  // source: time/[id]/page.tsx's own doc comment literally says
  // "detail/edit", and renders a real, editable TimeEntryForm for every
  // authorized viewer) — a deliberately separate, explicit pattern
  // rather than folding it into FOCUSED_FORM_ENTITY_BASES above, since
  // its bare `/[id]` shape would otherwise be indistinguishable from a
  // genuine read-first Hub route (which must NOT be hidden — see the
  // bases list's own header comment).
  /^\/time\/new$/,
  /^\/time\/[^/]+$/,
  // Company Settings: a singleton long-form editor (Forms Improvement
  // Slice D1's own sticky-action-bar page) — no /new or /[id] of its
  // own.
  /^\/settings\/company$/,
  ...TEMPLATE_FAMILY_BASES.flatMap((base) => {
    const escaped = escapeForRegex(base);
    return [new RegExp(`^${escaped}/new$`), new RegExp(`^${escaped}/[^/]+$`)];
  }),
];

/**
 * The one centralized, pure route classifier this slice's whole
 * unsaved-change-safety story depends on (Mobile Improvement audit §28):
 * Aqenra's UnsavedChangesScope only ever intercepts one page's own
 * explicit Cancel/Back link plus the browser's native `beforeunload` —
 * never generic in-app navigation. Hiding the bottom nav entirely on
 * every confirmed focused create/edit/duplicate workflow route is the
 * bounded V1 mitigation: it avoids *introducing* a new, always-visible,
 * thumb-reachable escape path directly beneath a form, without touching
 * UnsavedChangesScope itself or attempting any global router
 * interception (explicitly out of this slice's scope).
 */
export function shouldShowMobileBottomNav(pathname: string): boolean {
  return !FOCUSED_FORM_PATTERNS.some((pattern) => pattern.test(pathname));
}
