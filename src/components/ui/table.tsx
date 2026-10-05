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
}) {
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`text-text-muted px-4 py-3 font-medium ${
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
}: {
  children: ReactNode;
  align?: "left" | "right";
  emphasis?: boolean;
  /** Same additive, optional responsive-visibility escape hatch as TableHeaderCell's own — see its doc comment. Must match whichever cell(s) hide the corresponding TableHeaderCell, or a row's columns will misalign. */
  className?: string;
}) {
  return (
    <td
      className={`px-4 py-3 align-middle ${
        align === "right" ? "text-right" : "text-left"
      } ${emphasis ? "text-text-primary font-medium" : "text-text-secondary"} ${className}`}
    >
      {children}
    </td>
  );
}
