import { getCurrentMembership } from "@/lib/current-user";
import { getCachedEffectivePermissionSet } from "@/lib/permissions/resolver";
import { InsightsTabs } from "@/components/insights/insights-tabs";

/**
 * Section Consolidation §2/§5 — the shared Insights section shell.
 * Analytics/Reports/Activity have no nested create/detail subroutes (all
 * three are single-page list/dashboard destinations), so — unlike
 * Finance/Work — a route-group layout is the clean, safe mechanism here:
 * every route under this group is exactly a page this tab bar should
 * render on, mirroring app/portal/(app)/layout.tsx's own established use
 * of a nested parenthesized route group to scope a layout to a sibling
 * subset without changing any URL (route groups add no path segment —
 * /analytics, /reports, /activity are unchanged).
 *
 * getCurrentMembership()/getCachedEffectivePermissionSet() here is the
 * same per-request-memoized call (dashboard)/layout.tsx already makes
 * for Sidebar's own identical ANALYTICS_VIEW/REPORTS_VIEW flags — React's
 * cache() dedupes the (organizationId, role) pair within this same
 * request, so this is not a second query, just a second read of the
 * same resolved set. This is discoverability only: each page under this
 * layout (analytics/page.tsx, reports/page.tsx) independently
 * re-verifies the same effective permission server-side via
 * assertCanViewAnalytics()/assertCanViewReports(), completely unchanged
 * by this layout.
 */
export default async function InsightsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { organizationId, membership } = await getCurrentMembership();
  const effectivePermissions = await getCachedEffectivePermissionSet(organizationId, membership.role);

  return (
    <div>
      <InsightsTabs
        analyticsView={effectivePermissions.ANALYTICS_VIEW}
        reportsView={effectivePermissions.REPORTS_VIEW}
      />
      {children}
    </div>
  );
}
