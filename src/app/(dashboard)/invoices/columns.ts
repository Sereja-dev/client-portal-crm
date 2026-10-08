/**
 * Tables Improvement Slice E1 — the explicit, code-owned stable column
 * ids for the Invoice desktop table, plus the minimal metadata the
 * `Columns` picker and visibility checks need (label, mandatory). This
 * is deliberately NOT a generic render-definition/data-grid schema —
 * no width, no order-independent position, no renderer function; the
 * actual rendering stays entirely in `invoices/page.tsx` and
 * `invoice-desktop-table.tsx`, which both import `INVOICE_COLUMNS`
 * (for order + mandatory-ness) but build their own JSX independently,
 * matching the "avoid overengineering" instruction (locked spec §8/§7).
 *
 * Ids are camelCase, matching the underlying concept rather than the
 * display label — never a label, DOM index, or generated id. Where an
 * id names the same concept as an existing `InvoiceSortField` value
 * (amount/dueDate/createdAt — see `./query.ts`'s own
 * `INVOICE_SORT_FIELDS`), the same string is reused rather than
 * inventing a second vocabulary for one idea.
 *
 * Kept in its own tiny module (not added to `./query.ts`) for the exact
 * same bundle-boundary reason `./saved-view.ts`'s own header comment
 * documents: `./query.ts` imports `Prisma` and is otherwise exclusively
 * consumed server-side, while this module is imported by BOTH the
 * server page and the client `InvoiceDesktopTable`/
 * `ColumnVisibilityControl` — `import type` erasure isn't even needed
 * here (this file has no type import from query.ts at all), but keeping
 * it Prisma-free is still what makes it safe to import into client code
 * without risking pulling the generated Prisma client into the browser
 * bundle.
 */

export const INVOICE_COLUMNS_SURFACE = "invoices" as const;

export type InvoiceColumnId =
  | "invoiceNumber"
  | "project"
  | "client"
  | "amount"
  | "status"
  | "dueDate"
  | "createdAt"
  | "actions";

export type InvoiceColumnMeta = { id: InvoiceColumnId; label: string; mandatory: boolean };

/**
 * Canonical column order — identical to the Invoice desktop table's own
 * pre-existing left-to-right order (locked spec §20: "First visit / no
 * storage: Invoice desktop table must look exactly as it does today").
 * `invoiceNumber` (identity), `status`, and `actions` are mandatory
 * (locked spec §7) — every other column is optional/hideable, and every
 * column here is default-visible (no default-hidden column in V1).
 */
export const INVOICE_COLUMNS: InvoiceColumnMeta[] = [
  { id: "invoiceNumber", label: "Invoice #", mandatory: true },
  { id: "project", label: "Project", mandatory: false },
  { id: "client", label: "Client", mandatory: false },
  { id: "amount", label: "Amount", mandatory: false },
  { id: "status", label: "Status", mandatory: true },
  { id: "dueDate", label: "Due date", mandatory: false },
  { id: "createdAt", label: "Created", mandatory: false },
  { id: "actions", label: "Actions", mandatory: true },
];

/**
 * Referentially stable (module-level constants, computed once at
 * import time) — `useTableColumns`/`ColumnVisibilityProvider` both
 * require this, since a freshly-allocated array on every render would
 * defeat their own `useCallback` memoization and risk
 * `useSyncExternalStore` treating every render as a store change.
 */
export const INVOICE_COLUMN_IDS: readonly InvoiceColumnId[] = INVOICE_COLUMNS.map((c) => c.id);
export const INVOICE_MANDATORY_COLUMN_IDS: readonly InvoiceColumnId[] = INVOICE_COLUMNS.filter(
  (c) => c.mandatory,
).map((c) => c.id);
