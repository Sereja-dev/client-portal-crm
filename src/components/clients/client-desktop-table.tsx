"use client";

import { Fragment, type ReactNode } from "react";
import { Table, TableHead, TableBody, TableRow } from "@/components/ui/table";
import { useColumnVisibility } from "@/components/list/column-visibility-context";
import { CLIENT_COLUMNS, type ClientColumnId } from "@/app/(dashboard)/clients/columns";

export type ClientTableRow = {
  id: string;
  cells: Record<ClientColumnId, ReactNode>;
};

/**
 * Tables Improvement Slice E3B — the smallest possible client rendering
 * boundary around Column Customization: this component owns ONLY
 * "which columns are currently visible, in canonical order" and lays
 * out the `<table>` accordingly. It never fetches data, never computes
 * a display value, and never knows what a Client status/tag/date
 * format is — `headerCells`/`rows[].cells` are already-built ReactNode
 * slots, constructed server-side in `clients/page.tsx` using the EXACT
 * SAME JSX (Link/ClientStatusBadge/TagChipList/DeleteButton/
 * toLocaleDateString calls) that rendered this table before this slice
 * — nothing here reimplements or duplicates that formatting/business
 * logic (E3B readiness audit §N — `client.createdAt.toLocaleDateString()`
 * is currently safe only because it runs server-side only; this
 * component must preserve that property exactly, to avoid recreating
 * the Contracts hydration defect class).
 *
 * Uses the shared `Table`/`TableHead`/`TableBody`/`TableRow` wrapper
 * components directly rather than a local sticky-header markup
 * override — the Client desktop table has no sticky header today
 * (E3B readiness audit §P) and this slice must not introduce one.
 */
export function ClientDesktopTable({
  headerCells,
  rows,
}: {
  headerCells: Record<ClientColumnId, ReactNode>;
  rows: ClientTableRow[];
}) {
  const { isVisible } = useColumnVisibility();
  // Mandatory columns are always included regardless of stored state —
  // `isVisible` itself already guarantees this (useTableColumns's own
  // `normalizeHiddenColumnIds` strips any mandatory id out of
  // `hiddenIds` before it's ever consulted), so this is a single source
  // of truth, not a second place the mandatory rule is re-enforced.
  const visibleColumns = CLIENT_COLUMNS.filter((column) => isVisible(column.id));

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
