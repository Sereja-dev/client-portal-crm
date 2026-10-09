"use client";

import { Fragment, type ReactNode } from "react";
import { Table, TableHead, TableBody, TableRow } from "@/components/ui/table";
import { useColumnVisibility } from "@/components/list/column-visibility-context";
import { QUOTE_COLUMNS, type QuoteColumnId } from "@/app/(dashboard)/quotes/columns";

export type QuoteTableRow = {
  id: string;
  cells: Record<QuoteColumnId, ReactNode>;
};

/**
 * Tables Improvement Slice E3A — the smallest possible client rendering
 * boundary around Column Customization: this component owns ONLY
 * "which columns are currently visible, in canonical order" and lays
 * out the `<table>` accordingly. It never fetches data, never computes
 * a display value, and never knows what a Quote status/currency/date/
 * target format is — `headerCells`/`rows[].cells` are already-built
 * ReactNode slots, constructed server-side in `quotes/page.tsx` using
 * the EXACT SAME JSX (Link/QuoteStatusBadge/formatInvoiceCurrencyAmount/
 * formatDateOnlyForDisplay/deriveQuoteTargetDisplay calls) that rendered
 * this table before this slice — nothing here reimplements or
 * duplicates that formatting/business logic (E3A readiness audit §J —
 * the current safe architecture, where all formatting happens server-
 * side only, must be preserved exactly, to avoid recreating the
 * Contracts hydration defect class).
 *
 * Unlike `InvoiceDesktopTable`, this component uses the shared `Table`/
 * `TableHead`/`TableBody`/`TableRow` wrapper components directly rather
 * than a local sticky-header markup override — the Quote desktop table
 * has no sticky header today (E3A readiness audit §P) and this slice
 * must not introduce one.
 */
export function QuoteDesktopTable({
  headerCells,
  rows,
}: {
  headerCells: Record<QuoteColumnId, ReactNode>;
  rows: QuoteTableRow[];
}) {
  const { isVisible } = useColumnVisibility();
  // Mandatory columns are always included regardless of stored state —
  // `isVisible` itself already guarantees this (useTableColumns's own
  // `normalizeHiddenColumnIds` strips any mandatory id out of
  // `hiddenIds` before it's ever consulted), so this is a single source
  // of truth, not a second place the mandatory rule is re-enforced.
  const visibleColumns = QUOTE_COLUMNS.filter((column) => isVisible(column.id));

  return (
    <div className="hidden xl:block">
      <Table>
        <TableHead>
          <tr>
            {visibleColumns.map((column) => (
              <Fragment key={column.id}>{headerCells[column.id]}</Fragment>
            ))}
          </tr>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              {visibleColumns.map((column) => (
                <Fragment key={column.id}>{row.cells[column.id]}</Fragment>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
