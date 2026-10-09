/**
 * Tables Improvement Slice E3B — the explicit, code-owned stable column
 * ids for the Client desktop table, plus the minimal metadata the
 * shared `ColumnVisibilityControl` picker and visibility checks need
 * (label, mandatory). Mirrors `invoices/columns.ts`/`contracts/columns.ts`/
 * `quotes/columns.ts`'s own identical shape and scope — deliberately
 * NOT a generic render-definition/data-grid schema, and deliberately
 * kept separate from any other surface's own column metadata (no
 * merged cross-surface business render logic).
 *
 * Ids are camelCase, matching the underlying concept rather than the
 * display label. `createdAt` reuses the same name as `ClientSortField`
 * (see `./query.ts`'s own `CLIENT_SORT_FIELDS`) for the one sortable
 * optional column, matching every other surface's own "reuse
 * sort-field vocabulary" choice — Clients has no clickable sortable
 * headers at all (sorting is Sort-by-select-only, per the E3B readiness
 * audit), but the dropdown's own `createdAt` value is the same
 * underlying concept as this column.
 *
 * Kept in its own tiny module (not added to `./query.ts`) for the exact
 * same bundle-boundary reason `invoices/columns.ts`'s own header comment
 * documents: this file is imported by a Client Component
 * (`client-desktop-table.tsx`) as well as the server page, and must stay
 * Prisma-free (`./query.ts` imports `Prisma` and is otherwise
 * exclusively consumed server-side).
 */

export const CLIENT_COLUMNS_SURFACE = "clients" as const;

export type ClientColumnId = "name" | "company" | "email" | "phone" | "status" | "tags" | "createdAt" | "actions";

export type ClientColumnMeta = { id: ClientColumnId; label: string; mandatory: boolean };

/**
 * Canonical column order — identical to the Client desktop table's own
 * pre-existing left-to-right order (E3B readiness audit §12: "Preserve
 * the exact current rendered order... Default state must visually
 * match current Production semantics"). `name` (identity), `status`,
 * and `actions` are mandatory (readiness audit §F) — every other
 * column is optional/hideable, and every column here is default-
 * visible.
 */
export const CLIENT_COLUMNS: ClientColumnMeta[] = [
  { id: "name", label: "Name", mandatory: true },
  { id: "company", label: "Company", mandatory: false },
  { id: "email", label: "Email", mandatory: false },
  { id: "phone", label: "Phone", mandatory: false },
  { id: "status", label: "Status", mandatory: true },
  { id: "tags", label: "Tags", mandatory: false },
  { id: "createdAt", label: "Created", mandatory: false },
  { id: "actions", label: "Actions", mandatory: true },
];

/**
 * Referentially stable (module-level constants) — `useTableColumns`/
 * `ColumnVisibilityProvider` both require this; see `invoices/columns.ts`'s
 * own identical comment for the full "why."
 */
export const CLIENT_COLUMN_IDS: readonly ClientColumnId[] = CLIENT_COLUMNS.map((c) => c.id);
export const CLIENT_MANDATORY_COLUMN_IDS: readonly ClientColumnId[] = CLIENT_COLUMNS.filter(
  (c) => c.mandatory,
).map((c) => c.id);
