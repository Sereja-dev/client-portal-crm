/**
 * Tables Improvement Slice E3C — the explicit, code-owned stable column
 * ids for the Project desktop table, plus the minimal metadata the
 * shared `ColumnVisibilityControl` picker and visibility checks need
 * (label, mandatory). Mirrors `clients/columns.ts`/`quotes/columns.ts`'s
 * own identical shape and scope — deliberately NOT a generic render-
 * definition/data-grid schema, and deliberately kept separate from any
 * other surface's own column metadata (no merged cross-surface
 * business render logic).
 *
 * Ids are camelCase, matching the underlying concept rather than the
 * display label. `createdAt` reuses the same name as `ProjectSortField`
 * (see `./query.ts`'s own `PROJECT_SORT_FIELDS`) for the one sortable
 * optional column, matching every other surface's own "reuse sort-
 * field vocabulary" choice — Projects has no clickable sortable
 * headers at all (sorting is Sort-by-select-only, per the E3C
 * readiness audit), but the dropdown's own `createdAt` value is the
 * same underlying concept as this column.
 *
 * `name` is mandatory for two independent reasons (E3C readiness audit
 * §D/§H), not just the usual "primary identity" rule every other
 * surface's own mandatory id follows: it is also the Projects list's
 * ONLY navigation entry point into the Project Hub (`project-hub.spec.ts`'s
 * own "Projects list: the Name link opens the Hub" test) — hiding it
 * would remove the sole way to reach the Hub from this list, not just
 * hide a display field.
 *
 * Kept in its own tiny module (not added to `./query.ts`) for the exact
 * same bundle-boundary reason `invoices/columns.ts`'s own header comment
 * documents: this file is imported by a Client Component
 * (`project-desktop-table.tsx`) as well as the server page, and must
 * stay Prisma-free (`./query.ts` imports `Prisma` and is otherwise
 * exclusively consumed server-side).
 */

export const PROJECT_COLUMNS_SURFACE = "projects" as const;

export type ProjectColumnId = "name" | "client" | "status" | "startDate" | "endDate" | "createdAt" | "actions";

export type ProjectColumnMeta = { id: ProjectColumnId; label: string; mandatory: boolean };

/**
 * Canonical column order — identical to the Project desktop table's
 * own pre-existing left-to-right order (E3C readiness audit §12:
 * "Preserve the exact current rendered order... Default state must
 * match current Production behavior"). `name`, `status`, and `actions`
 * are mandatory (readiness audit §F) — every other column is optional/
 * hideable, and every column here is default-visible.
 */
export const PROJECT_COLUMNS: ProjectColumnMeta[] = [
  { id: "name", label: "Name", mandatory: true },
  { id: "client", label: "Client", mandatory: false },
  { id: "status", label: "Status", mandatory: true },
  { id: "startDate", label: "Start date", mandatory: false },
  { id: "endDate", label: "End date", mandatory: false },
  { id: "createdAt", label: "Created", mandatory: false },
  { id: "actions", label: "Actions", mandatory: true },
];

/**
 * Referentially stable (module-level constants) — `useTableColumns`/
 * `ColumnVisibilityProvider` both require this; see `invoices/columns.ts`'s
 * own identical comment for the full "why."
 */
export const PROJECT_COLUMN_IDS: readonly ProjectColumnId[] = PROJECT_COLUMNS.map((c) => c.id);
export const PROJECT_MANDATORY_COLUMN_IDS: readonly ProjectColumnId[] = PROJECT_COLUMNS.filter(
  (c) => c.mandatory,
).map((c) => c.id);
