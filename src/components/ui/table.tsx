import { ReactNode } from "react";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className={`mt-6 overflow-x-auto ${CARD_SURFACE_CLASSES}`}>
      <table className="divide-border-default min-w-full divide-y text-sm">
        {children}
      </table>
    </div>
  );
}

// Design System Phase 2 — surface-recessed (not bg-gray-50): globals.css's
// own token comment names "table header" as one of surface-recessed's
// intended consumers, matching the Round 3 "quiet/recessed header" target.
export function TableHead({
  children,
  className = "",
}: {
  children: ReactNode;
  /**
   * Tables Improvement Slice A — additive, optional, same escape-hatch
   * convention TableHeaderCell/TableCell already establish below: every
   * existing call site across the app renders byte-identically (empty
   * string appended changes nothing). Exists so ONE caller (the Invoice
   * list's own sticky-header pilot) can opt into `sticky top-0 z-10`
   * without this becoming default behavior for every other table in the
   * app — see that page's own header comment for the full "why sticky
   * needed a bounded-height ancestor, not a global Table rewrite"
   * reasoning.
   */
  className?: string;
}) {
  return <thead className={`bg-surface-recessed ${className}`}>{children}</thead>;
}

export function TableHeaderCell({
  children,
  align = "left",
  className = "",
  ariaSort,
  dense = false,
}: {
  children: ReactNode;
  align?: "left" | "right";
  /**
   * Additive, optional — every existing call site across the app already
   * works unchanged. Exists so a page can hide a lower-priority column at
   * narrower breakpoints (e.g. `className="hidden md:table-cell"`) using
   * this same `<table>` markup at every viewport, rather than introducing
   * a second, parallel mobile-only component (see the Organization
   * Explorer list page for the first real usage).
   */
  className?: string;
  /**
   * Tables Improvement Slice A — additive, optional. `undefined` (every
   * existing call site) omits the attribute entirely, byte-identical to
   * before this change. Passed straight through to the real `aria-sort`
   * attribute so SortableHeader (src/components/ui/sortable-header.tsx)
   * can delegate its own `<th>` rendering to this exact same shared base
   * rather than hand-rolling a second `<th>` implementation — a
   * non-sortable TableHeaderCell never sets this at all, so it never
   * falsely claims a sort direction (WAI-ARIA: omit aria-sort on columns
   * that aren't sortable, rather than asserting "none").
   */
  ariaSort?: "ascending" | "descending" | "none";
  /**
   * Additive, optional, defaults to `false` — every existing call site
   * renders byte-identically. Trims horizontal padding from `px-4` to
   * `px-3` for a table whose own column count has grown past what `px-4`
   * everywhere leaves real breakpoint margin for (see the Tasks list's
   * own usage and responsive-list-tables-breakpoint.spec.ts's header
   * comment) — a column-count problem, not a reason to change the
   * default density of every other table in the app.
   */
  dense?: boolean;
}) {
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`text-text-muted ${dense ? "px-3" : "px-4"} py-3 font-medium ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-border-default divide-y">{children}</tbody>;
}

export function TableRow({ children }: { children: ReactNode }) {
  return <tr className="transition-colors hover:bg-[var(--hover)]">{children}</tr>;
}

export function TableCell({
  children,
  align = "left",
  emphasis = false,
  className = "",
  dense = false,
}: {
  children: ReactNode;
  align?: "left" | "right";
  emphasis?: boolean;
  /** Same additive, optional responsive-visibility escape hatch as TableHeaderCell's own — see its doc comment. Must match whichever cell(s) hide the corresponding TableHeaderCell, or a row's columns will misalign. */
  className?: string;
  /** Same additive, optional `px-4`→`px-3` escape hatch as TableHeaderCell's own `dense` — see its doc comment. Must match the corresponding TableHeaderCell's own `dense` value, or a column's header and body won't share the same width. */
  dense?: boolean;
}) {
  return (
    <td
      className={`${dense ? "px-3" : "px-4"} py-3 align-middle ${
        align === "right" ? "text-right" : "text-left"
      } ${emphasis ? "text-text-primary font-medium" : "text-text-secondary"} ${className}`}
    >
      {children}
    </td>
  );
}
