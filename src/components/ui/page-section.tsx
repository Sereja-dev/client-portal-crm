import type { ReactNode } from "react";

/**
 * Visual Design Improvement V4 — the smallest shared section-hierarchy/
 * spacing primitive. The `space-y-8`/`space-y-4` page rhythm below is
 * the already-dominant convention observed across /dashboard and other
 * pages, formalized as named constants rather than invented fresh.
 *
 * Dashboard section-hierarchy correction (post-Production manual
 * smoke) — SectionTitle originally wired the dormant
 * `--aqenra-fs-section-title`/`--aqenra-fw-section-title` tokens
 * (0.8125rem/13px, 600). Production review found that size genuinely
 * too small: it's identical to `--aqenra-fs-label` (0.8125rem) — a
 * form-field-label-scale token, never battle-tested against real
 * nested content before this component's first use of it — and it
 * rendered SMALLER than the real h3 headings nested beneath it
 * (TodaySection's "Tasks due today"/"Today's events",
 * NeedsAttention's own category titles, both text-sm/14px font-
 * semibold), inverting the intended hierarchy. Reverted to
 * `text-lg font-semibold tracking-tight` (18px/600) — the single most
 * common real h2 treatment already proven elsewhere in this app (and
 * the exact pre-V4 classes NeedsAttention/TodaySection's own headings
 * used), not a new, unproven value. The two dormant tokens themselves
 * are untouched in globals.css — they may still correctly serve a
 * genuine future compact-label/metadata role elsewhere; only
 * SectionTitle's own consumption of them has stopped.
 *
 * Deliberately NOT a page-title replacement — h1 (`text-2xl font-
 * semibold tracking-tight text-text-primary`) remains untouched and
 * stays visibly the strongest element on the page.
 */
export function SectionTitle({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-text-primary text-lg font-semibold tracking-tight">
      {children}
    </h2>
  );
}

/** Major page-section rhythm — the already-dominant `space-y-8` convention observed across /dashboard and other pages, formalized as one named constant rather than a literal repeated ad hoc at each call site. */
export const PAGE_SECTION_STACK_CLASSES = "space-y-8";

/** Sub-group rhythm (a tight cluster of related controls within one major section, e.g. Saved Views + Columns + the search/filter bar) — the already-dominant `space-y-4` convention, formalized the same way. */
export const PAGE_SUBSECTION_STACK_CLASSES = "space-y-4";
