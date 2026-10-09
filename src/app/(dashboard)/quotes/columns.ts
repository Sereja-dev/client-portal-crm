/**
 * Tables Improvement Slice E3A — the explicit, code-owned stable column
 * ids for the Quote desktop table, plus the minimal metadata the shared
 * `ColumnVisibilityControl` picker and visibility checks need (label,
 * mandatory). Mirrors `invoices/columns.ts`/`contracts/columns.ts`'s own
 * identical shape and scope — deliberately NOT a generic render-
 * definition/data-grid schema, and deliberately kept separate from
 * Invoice/Contract's own column metadata (no merged cross-surface
 * business render logic).
 *
 * Ids are camelCase, matching the underlying concept rather than the
 * display label — `quote.number` (the field) is named `quoteNumber`
 * here, matching the Invoice/Contract precedent of a descriptive id
 * rather than the raw field name (`invoiceNumber`/`contractNumber`).
 * `issueDate`/`validUntil`/`total` reuse the same names as
 * `QuoteSortField` (see `./query.ts`'s own `QUOTE_SORT_FIELDS`) for the
 * sortable concepts they mirror, matching Invoice/Contract's own "reuse
 * sort-field vocabulary" choice — Quotes has no clickable sortable
 * headers at all (sorting is Sort-by-select-only, per the E3A readiness
 * audit), but the dropdown's own `total`/`issueDate`/`validUntil`
 * values are the same underlying concept as these columns.
 *
 * Kept in its own tiny module (not added to `./query.ts`) for the exact
 * same bundle-boundary reason `invoices/columns.ts`'s own header comment
 * documents: this file is imported by a Client Component
 * (`quote-desktop-table.tsx`) as well as the server page, and must stay
 * Prisma-free (`./query.ts` imports `Prisma` and is otherwise
 * exclusively consumed server-side).
 */

export const QUOTE_COLUMNS_SURFACE = "quotes" as const;

export type QuoteColumnId =
  | "quoteNumber"
  | "target"
  | "title"
  | "status"
  | "total"
  | "issueDate"
  | "validUntil"
  | "actions";

export type QuoteColumnMeta = { id: QuoteColumnId; label: string; mandatory: boolean };

/**
 * Canonical column order — identical to the Quote desktop table's own
 * pre-existing left-to-right order (E3A readiness audit §12: "Preserve
 * the exact current rendered order... No default-hidden columns").
 * `quoteNumber` (identity), `status`, and `actions` are mandatory
 * (readiness audit §F) — every other column is optional/hideable, and
 * every column here is default-visible.
 */
export const QUOTE_COLUMNS: QuoteColumnMeta[] = [
  { id: "quoteNumber", label: "Quote #", mandatory: true },
  { id: "target", label: "Target", mandatory: false },
  { id: "title", label: "Title", mandatory: false },
  { id: "status", label: "Status", mandatory: true },
  { id: "total", label: "Total", mandatory: false },
  { id: "issueDate", label: "Issue date", mandatory: false },
  { id: "validUntil", label: "Valid until", mandatory: false },
  { id: "actions", label: "Actions", mandatory: true },
];

/**
 * Referentially stable (module-level constants) — `useTableColumns`/
 * `ColumnVisibilityProvider` both require this; see `invoices/columns.ts`'s
 * own identical comment for the full "why."
 */
export const QUOTE_COLUMN_IDS: readonly QuoteColumnId[] = QUOTE_COLUMNS.map((c) => c.id);
export const QUOTE_MANDATORY_COLUMN_IDS: readonly QuoteColumnId[] = QUOTE_COLUMNS.filter(
  (c) => c.mandatory,
).map((c) => c.id);
