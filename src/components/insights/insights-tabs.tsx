import { SectionTabs, type SectionTab } from "@/components/navigation/section-tabs";

/**
 * Section Consolidation §2/§5 — Insights' own tab set. Unlike Finance/
 * Work, Analytics/Reports/Activity have zero nested create/detail
 * subroutes, so this is safely mounted via the shared
 * (dashboard)/(insights)/layout.tsx route-group layout rather than
 * page-level mounting — the "clean" case the read-only audit's own §C
 * identified.
 *
 * `buildInsightsTabs` is exported as a pure function (mirroring
 * sidebar.tsx's own buildSidebarGroups()) so its shape is directly
 * unit-testable without rendering. `analyticsView`/`reportsView` are the
 * caller's own already-resolved ANALYTICS_VIEW/REPORTS_VIEW effective
 * permissions — the exact same source sidebar.tsx's own Insights group
 * already reads (locked spec §10: "do not create parallel role rules").
 * Activity is never gated, matching sidebar.tsx's own identical
 * treatment.
 */
export function buildInsightsTabs({
  analyticsView,
  reportsView,
}: {
  analyticsView: boolean;
  reportsView: boolean;
}): SectionTab[] {
  return [
    { label: "Analytics", href: "/analytics", hidden: !analyticsView },
    { label: "Reports", href: "/reports", hidden: !reportsView },
    { label: "Activity", href: "/activity" },
  ];
}

export function InsightsTabs({
  analyticsView,
  reportsView,
}: {
  analyticsView: boolean;
  reportsView: boolean;
}) {
  return <SectionTabs label="Insights" tabs={buildInsightsTabs({ analyticsView, reportsView })} />;
}
