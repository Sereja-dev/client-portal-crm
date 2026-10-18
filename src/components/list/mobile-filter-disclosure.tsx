import type { ReactNode } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";

/**
 * Mobile Improvement Slice B1 — the smallest shared mobile filter-
 * disclosure primitive (Mobile Slice B audit §AE). A native
 * `<details>`/`<summary>`, collapsed by default below `md` unless
 * `activeCount > 0`, and forced fully visible with no disclosure
 * affordance at all at `md` and up (see globals.css's own
 * `.mobile-filter-disclosure` rule for exactly how).
 *
 * Presentation only — it knows nothing about URL params, SearchFilterBar
 * internals, Saved Views, sort semantics, or any specific surface's own
 * fields. `children` is rendered completely unchanged; `activeCount`
 * only drives the visible "Filter"/"Filter (N)" summary label and the
 * disclosure's own initial open/closed state. Zero client JS: `open` is
 * a plain, server-computed boolean HTML attribute, not `useState` or any
 * width detection — the same CSS-only responsive-visibility discipline
 * Mobile Navigation Foundation's own bottom nav already established
 * (no hydration-mismatch risk class applies here at all).
 *
 * Reuses Sidebar's own exact `group`/`group-open:` chevron-rotation
 * convention (src/components/layout/sidebar.tsx) rather than inventing a
 * new one.
 */
export function MobileFilterDisclosure({
  activeCount,
  children,
}: {
  activeCount: number;
  children: ReactNode;
}) {
  const label = activeCount > 0 ? `Filter (${activeCount})` : "Filter";

  return (
    // `display: contents` is specified to never apply to a <details>
    // element (CSS Display §2.4 special-cases it back to `block`) — so
    // this stays a normal block box at every breakpoint, including at
    // `md` and up. It carries no border/background/padding of its own,
    // and its one content child lays its own fields out with the exact
    // same `flex flex-wrap items-end gap-4` SearchFilterBar's own form
    // already uses, so visually this reads as the same control group,
    // just one DOM level deeper — the one accepted, structurally
    // unavoidable difference from today is wrap *granularity* exactly
    // at the `md` boundary (this group can wrap against Search as one
    // unit there, where today each field wraps independently); at any
    // realistic desktop width this is not observable at all.
    <details open={activeCount > 0} className="group mobile-filter-disclosure">
      <summary className="border-border-default bg-surface text-text-primary focus-visible:ring-focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors [&::-webkit-details-marker]:hidden hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 md:hidden">
        <span>{label}</span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mobile-filter-disclosure-content mt-3 flex flex-wrap items-end gap-4 md:mt-0">{children}</div>
    </details>
  );
}
