"use client";

import { Fragment, type ReactNode } from "react";
import { Table, TableHead, TableBody, TableRow } from "@/components/ui/table";
import { useColumnVisibility } from "@/components/list/column-visibility-context";
import { PROJECT_COLUMNS, type ProjectColumnId } from "@/app/(dashboard)/projects/columns";

export type ProjectTableRow = {
  id: string;
  cells: Record<ProjectColumnId, ReactNode>;
};

/**
 * Tables Improvement Slice E3C — the smallest possible client rendering
 * boundary around Column Customization: this component owns ONLY
 * "which columns are currently visible, in canonical order" and lays
 * out the `<table>` accordingly. It never fetches data, never computes
 * a display value, and never knows what a Project status/date/client
 * name is — `headerCells`/`rows[].cells` are already-built ReactNode
 * slots, constructed server-side in `projects/page.tsx` using the
 * EXACT SAME JSX (Link/ProjectStatusBadge/formatDateOnlyForDisplay/
 * toLocaleDateString/DeleteButton calls) that rendered this table
 * before this slice — nothing here reimplements or duplicates that
 * formatting/business logic (E3C readiness audit §O — the current safe
 * architecture, where all formatting happens server-side only, must be
 * preserved exactly, to avoid recreating the Contracts hydration
 * defect class).
 *
 * Uses the shared `Table`/`TableHead`/`TableBody`/`TableRow` wrapper
 * components directly rather than a local sticky-header markup
 * override — the Project desktop table has no sticky header today
 * (E3C readiness audit §Q) and this slice must not introduce one.
 */
export function ProjectDesktopTable({
  headerCells,
  rows,
}: {
  headerCells: Record<ProjectColumnId, ReactNode>;
  rows: ProjectTableRow[];
}) {
  const { isVisible } = useColumnVisibility();
  // Mandatory columns are always included regardless of stored state —
  // `isVisible` itself already guarantees this (useTableColumns's own
  // `normalizeHiddenColumnIds` strips any mandatory id out of
  // `hiddenIds` before it's ever consulted), so this is a single source
  // of truth, not a second place the mandatory rule is re-enforced. In
  // particular, `name` can never be hidden this way — the sole Project
  // Hub navigation entry point on this list always renders.
  const visibleColumns = PROJECT_COLUMNS.filter((column) => isVisible(column.id));

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
