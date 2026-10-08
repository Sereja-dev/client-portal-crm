"use client";

import { Fragment, type ReactNode } from "react";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { TableHead, TableBody, TableRow } from "@/components/ui/table";
import { useColumnVisibility } from "@/components/list/column-visibility-context";
import { INVOICE_COLUMNS, type InvoiceColumnId } from "@/app/(dashboard)/invoices/columns";

export type InvoiceTableRow = {
  id: string;
  cells: Record<InvoiceColumnId, ReactNode>;
};

/**
 * Tables Improvement Slice E1 — the smallest possible client rendering
 * boundary around Column Customization: this component owns ONLY "which
 * columns are currently visible, in canonical order" and lays out the
 * `<table>` accordingly. It never fetches data, never computes a
 * display value, and never knows what an Invoice status/currency/date
 * format is — `headerCells`/`rows[].cells` are already-built ReactNode
 * slots, constructed server-side in `invoices/page.tsx` using the EXACT
 * SAME JSX (Link/StatusBadge/DeleteButton/RowActionMenu/SortableHeader
 * calls) that rendered this table before this slice — nothing here
 * reimplements or duplicates that formatting/business logic (locked
 * spec §3/§18: query/data-fetch semantics and every existing value are
 * byte-for-byte unchanged, this is a pure rendering-shape change).
 *
 * Passing already-rendered Server Component JSX (including nested
 * Client Components like `Link`, `StatusBadge`, and `DeleteButton` —
 * itself a Client Component receiving a bound Server Action prop,
 * already proven safe by every existing list page in this app) as a
 * prop into a Client Component is the standard, documented React Server
 * Components composition pattern ("Server Components as Children/Props
 * of Client Components") — this file imports no server-only module and
 * performs no data acquisition itself, so moving it to the client never
 * moves auth/query/authorization logic with it.
 *
 * Sticky-header markup/classes below are copied verbatim from the
 * pre-Slice-E1 Invoice page (locked spec §15 — "Do not change
 * sticky-header architecture unless strictly necessary"): a bounded-
 * height scroll container (max 70vh) is still what gives `position:
 * sticky` something to stick against, and `overflow-x-auto` still
 * contains horizontal overflow. No `nth-child`/fixed-width hack is introduced —
 * removing a `<th>`/`<td>` pair here is just one fewer element in an
 * already content-driven (`min-w-full`, no `table-layout: fixed`) table,
 * which the browser reflows normally.
 */
export function InvoiceDesktopTable({
  headerCells,
  rows,
}: {
  headerCells: Record<InvoiceColumnId, ReactNode>;
  rows: InvoiceTableRow[];
}) {
  const { isVisible } = useColumnVisibility();
  // Mandatory columns are always included regardless of stored state —
  // `isVisible` itself already guarantees this (useTableColumns's own
  // `normalizeHiddenColumnIds` strips any mandatory id out of
  // `hiddenIds` before it's ever consulted), so this is a single source
  // of truth, not a second place the mandatory rule is re-enforced.
  const visibleColumns = INVOICE_COLUMNS.filter((column) => isVisible(column.id));

  return (
    <div className="hidden xl:block">
      <div className={`mt-6 max-h-[70vh] overflow-x-auto overflow-y-auto ${CARD_SURFACE_CLASSES}`}>
        <table className="divide-border-default min-w-full divide-y text-sm">
          <TableHead className="sticky top-0 z-10">
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
        </table>
      </div>
    </div>
  );
}
