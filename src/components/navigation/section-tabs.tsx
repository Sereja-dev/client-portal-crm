"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Section Consolidation — the one shared secondary-navigation primitive
 * every business-zone tab bar (Finance/Work/Insights/Documents) is built
 * from, so this app has exactly one implementation of "a horizontal row
 * of section tabs" rather than four near-identical copies. Modeled
 * directly on src/components/settings/settings-nav.tsx's own already-
 * shipped shape: same `"use client"` + usePathname() active-state
 * resolution, same overflow-x-auto horizontal-scroll row (never wraps,
 * never a dropdown), same bg-accent active pill + focus-visible ring,
 * same "hiding a tab is discoverability only" posture — every gated
 * destination this renders still independently re-verifies its own
 * permission server-side (this component makes no authorization
 * decision itself, it only decides what to *show*).
 *
 * Deliberately data-driven (SectionTab[]) rather than one component per
 * section with its own hand-written JSX — Finance/Work/Insights/
 * Documents each contribute a thin config (see the sibling
 * finance-tabs.tsx/work-tabs.tsx/insights-tabs.tsx/documents-tabs.tsx),
 * never a fifth copy of this JSX.
 */
export type SectionTab = {
  label: string;
  href: string;
  /** Discoverability-only — a tab with `hidden: true` is simply not
   * rendered. The real access boundary remains each destination's own
   * existing server-side check (assertCanViewAnalytics, listRecurringInvoices's
   * own FORBIDDEN return, etc.), completely unchanged by this component. */
  hidden?: boolean;
};

/** Exact-or-nested-subpath match — mirrors settings-nav.tsx's own
 * isActive() and sidebar.tsx's own isActive() exactly, so a section
 * tab's active state never drifts from how every other nav surface in
 * this app already decides "is this the current page." Exported (like
 * sidebar.tsx's own isActive()) so tests can verify it directly, without
 * rendering. */
export function isTabActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SectionTabs({ label, tabs }: { label: string; tabs: SectionTab[] }) {
  const pathname = usePathname();
  const visibleTabs = tabs.filter((tab) => !tab.hidden);

  if (visibleTabs.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label={label}
      className="border-border-default mb-6 flex gap-1 overflow-x-auto border-b pb-3"
    >
      {visibleTabs.map((tab) => {
        const active = isTabActive(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`focus-visible:ring-focus-ring whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
              active ? "bg-accent text-white" : "text-text-secondary hover:bg-[var(--hover)]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
