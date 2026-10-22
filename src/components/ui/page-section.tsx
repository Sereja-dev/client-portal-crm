import type { ReactNode } from "react";

/**
 * Visual Design Improvement V4 — the smallest shared section-hierarchy/
 * spacing primitive, wiring two dormant Design System tokens
 * (globals.css) that were defined since an earlier phase but never
 * consumed by any component until now: `--aqenra-fs-section-title`/
 * `--aqenra-fw-section-title` (0.8125rem/600) here, and the already-
 * dominant `space-y-8`/`space-y-4` page rhythm below, formalized as
 * named constants rather than invented fresh. No token value changed.
 *
 * Deliberately NOT a page-title replacement — h1 (`text-2xl font-
 * semibold tracking-tight text-text-primary`) was already found
 * consistent across the app and is untouched by this slice; the
 * section-title token is smaller (13px) than every existing h2 variant
 * it replaces (14–20px across different pages), matching a compact,
 * confident label rather than a second, competing heading size — never
 * uppercase (no global all-caps convention introduced), never an
 * accent bar or underline (no decorative styling).
 *
 * Arbitrary-property syntax (`[font-size:var(--aqenra-fs-section-
 * title)]`) is required because these --aqenra- tokens are deliberately
 * NOT mirrored into `@theme inline` (would silently override Tailwind's
 * own reserved font-size/weight scale app-wide) — the same reasoning
 * dialog-shell.tsx's own radius/shadow wiring already documents.
 */
export function SectionTitle({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="text-text-primary tracking-wide [font-size:var(--aqenra-fs-section-title)] [font-weight:var(--aqenra-fw-section-title)]"
    >
      {children}
    </h2>
  );
}

/** Major page-section rhythm — the already-dominant `space-y-8` convention observed across /dashboard and other pages, formalized as one named constant rather than a literal repeated ad hoc at each call site. */
export const PAGE_SECTION_STACK_CLASSES = "space-y-8";

/** Sub-group rhythm (a tight cluster of related controls within one major section, e.g. Saved Views + Columns + the search/filter bar) — the already-dominant `space-y-4` convention, formalized the same way. */
export const PAGE_SUBSECTION_STACK_CLASSES = "space-y-4";
