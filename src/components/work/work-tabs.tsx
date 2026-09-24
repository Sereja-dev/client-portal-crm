import { SectionTabs, type SectionTab } from "@/components/navigation/section-tabs";

/**
 * Section Consolidation §2/§5 — Work's own tab set. Mounted directly on
 * each of the four index pages (/projects, /tasks, /calendar, /time),
 * never via a shared route-group layout: unlike Insights, three of
 * Work's four members (Projects/Tasks/Time) have their own nested
 * create/detail routes (/projects/new, /projects/[id], /projects/[id]/edit,
 * the identical shape under /tasks and /time) that must never inherit
 * this tab bar (locked spec §4/§5 — "keep record-scoped/create flows
 * clean"). A route-group layout wrapping those folders wholesale would
 * also wrap those children, so per §5's own explicit escape hatch
 * ("choose the smallest safe architecture... do not introduce complex
 * pathname exceptions merely to force a layout architecture") this is
 * page-level mounting on exactly the four list/index pages instead.
 *
 * All four destinations are open to every staff role today (never
 * gated) — no visibility prop needed, unlike FinanceTabs/InsightsTabs.
 * `buildWorkTabs` is exported as a pure function (mirroring sidebar.tsx's
 * own buildSidebarGroups()) so its shape is directly unit-testable.
 */
export function buildWorkTabs(): SectionTab[] {
  return [
    { label: "Projects", href: "/projects" },
    { label: "Tasks", href: "/tasks" },
    { label: "Calendar", href: "/calendar" },
    { label: "Time", href: "/time" },
  ];
}

export function WorkTabs() {
  return <SectionTabs label="Work" tabs={buildWorkTabs()} />;
}
