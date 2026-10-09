/**
 * Tables Improvement Slice E2 — the explicit, code-owned stable column
 * ids for the Contract desktop table, plus the minimal metadata the
 * shared `ColumnVisibilityControl` picker and visibility checks need
 * (label, mandatory). Mirrors `invoices/columns.ts`'s own identical
 * shape and scope — deliberately NOT a generic render-definition/data-
 * grid schema, and deliberately kept separate from Invoice's own
 * column metadata (no merged cross-surface business render logic).
 *
 * Ids are camelCase, matching the underlying concept rather than the
 * display label. `issueDate` reuses the same name as `ContractSortField`
 * (see `./query.ts`'s own `CONTRACT_SORT_FIELDS`) for the one sortable
 * column, matching Invoice's own "reuse sort-field vocabulary" choice.
 *
 * The bulk-selection checkbox is deliberately NOT a column id here —
 * it's a selection control (rendered as a raw `<th>`/`<td>`, never
 * `TableHeaderCell`/`TableCell` — see `contract-list-with-selection.tsx`'s
 * own identical comment), independently gated by `canBulkSelect`, never
 * entered into column-visibility state at all.
 *
 * Kept in its own tiny module (not added to `./query.ts`) for the exact
 * same bundle-boundary reason `invoices/columns.ts`'s own header comment
 * documents: this file is imported by a Client Component
 * (`contract-list-with-selection.tsx`) as well as the server page, and
 * must stay Prisma-free.
 */

export const CONTRACT_COLUMNS_SURFACE = "contracts" as const;

export type ContractColumnId = "contractNumber" | "title" | "client" | "project" | "status" | "issueDate" | "actions";

export type ContractColumnMeta = { id: ContractColumnId; label: string; mandatory: boolean };

/**
 * Canonical column order — identical to the Contract desktop table's
 * own pre-existing left-to-right order (locked spec §18: "No storage /
 * first visit: Contract desktop table must look exactly as current
 * Production does"). `contractNumber`, `status`, and `actions` are
 * mandatory (locked spec §6) — every other column is optional/
 * hideable, and every column here is default-visible.
 */
export const CONTRACT_COLUMNS: ContractColumnMeta[] = [
  { id: "contractNumber", label: "Contract #", mandatory: true },
  { id: "title", label: "Title", mandatory: false },
  { id: "client", label: "Client", mandatory: false },
  { id: "project", label: "Project", mandatory: false },
  { id: "status", label: "Status", mandatory: true },
  { id: "issueDate", label: "Issue date", mandatory: false },
  { id: "actions", label: "Actions", mandatory: true },
];

/**
 * Referentially stable (module-level constants) — `useTableColumns`/
 * `ColumnVisibilityProvider` both require this; see `invoices/columns.ts`'s
 * own identical comment for the full "why."
 */
export const CONTRACT_COLUMN_IDS: readonly ContractColumnId[] = CONTRACT_COLUMNS.map((c) => c.id);
export const CONTRACT_MANDATORY_COLUMN_IDS: readonly ContractColumnId[] = CONTRACT_COLUMNS.filter(
  (c) => c.mandatory,
).map((c) => c.id);
