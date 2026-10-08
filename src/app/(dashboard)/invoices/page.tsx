import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentMembership } from "@/lib/current-user";
import { getCachedEffectivePermissionSet } from "@/lib/permissions/resolver";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/format";
import { formatInvoiceStatusLabel } from "@/lib/invoices/status-label";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { PAGE_SIZE, getOffset, getTotalPages, type RawSearchParams } from "@/lib/list-params";
import { DeleteButton } from "@/components/ui/delete-button";
import { deleteInvoiceAction } from "./actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PencilIcon } from "@/components/ui/icons";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { SearchFilterBar } from "@/components/list/search-filter-bar";
import { Pagination } from "@/components/list/pagination";
import { QuickFilterChips } from "@/components/list/quick-filter-chips";
import { RowActionMenu, RowActionMenuItem } from "@/components/ui/row-action-menu";
import { SortableHeader } from "@/components/ui/sortable-header";
import { InvoiceSavedViews } from "@/components/invoices/invoice-saved-views";
import {
  TableHeaderCell,
  TableCell,
} from "@/components/ui/table";
import {
  RecordCardList,
  RecordCard,
  RecordCardField,
  RecordCardActions,
} from "@/components/ui/record-list";
import { INVOICE_STATUSES } from "@/lib/validation/invoice";
import {
  parseInvoiceListParams,
  buildInvoiceWhere,
  buildInvoiceOrderBy,
  buildInvoicesHref,
  nextInvoiceSortCombined,
  INVOICE_QUICK_FILTERS,
  type InvoiceSortField,
} from "./query";
import { serializeInvoiceSavedViewParams } from "./saved-view";
import {
  INVOICE_COLUMNS,
  INVOICE_COLUMNS_SURFACE,
  INVOICE_COLUMN_IDS,
  INVOICE_MANDATORY_COLUMN_IDS,
  type InvoiceColumnId,
} from "./columns";
import { ColumnVisibilityProvider } from "@/components/list/column-visibility-context";
import { ColumnVisibilityControl } from "@/components/list/column-visibility-control";
import { InvoiceDesktopTable, type InvoiceTableRow } from "@/components/invoices/invoice-desktop-table";

// Page-owned primary call-to-action link (navigates, so a real <Link> —
// not the shared <Button>, which renders a <button>). Matches Button's
// own primary variant tokens (bg-accent/hover:bg-accent-hover/focus-ring)
// — the same constant Batch 1 introduced for Clients' identical pattern.
const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

const SORT_OPTIONS = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "dueDate:asc", label: "Due date (soonest)" },
  { value: "dueDate:desc", label: "Due date (latest)" },
  { value: "amount:desc", label: "Amount (high to low)" },
  { value: "amount:asc", label: "Amount (low to high)" },
];

/**
 * Tables Improvement Slice A (pilot) — the Invoice list, upgraded from a
 * generic CRUD table toward a workflow-oriented one, per the approved
 * readiness audit:
 *  - Row action hierarchy: DRAFT keeps a direct Edit action, with Delete
 *    relocated into an accessible overflow menu (RowActionMenu) instead
 *    of a prominent inline red button — the existing DeleteButton/
 *    ConfirmDialog/deleteInvoiceAction are reused completely unmodified,
 *    never duplicated. Every other status keeps its existing plain View
 *    action, with no menu at all (never an empty "..." with nothing in
 *    it).
 *  - Clickable desktop sortable headers (SortableHeader) are a pure UI
 *    entry point onto the EXISTING, unchanged server-side sort pipeline
 *    (INVOICE_SORT_FIELDS/parseSortParam/buildInvoiceOrderBy in
 *    ./query.ts) — the Sort-by dropdown below is deliberately kept,
 *    since RecordCardList (mobile) has no headers at all and still needs
 *    it, and both read the exact same `?sort=field:dir` URL state so
 *    they can never drift out of sync.
 *  - Quick-filter chips (Draft/Sent/Overdue/Paid) are shortcuts for the
 *    SAME singular `?status=` the Status dropdown already uses — never a
 *    parallel filter model. "Overdue" here means exactly the persisted
 *    OVERDUE InvoiceStatus value, NOT Finance's own separate
 *    operationally-overdue KPI calculation.
 *  - The desktop table (xl: and up) gets a browser-proven sticky header
 *    (see the dedicated wrapper below) — kept entirely local to this one
 *    page; the shared `Table` component's own default wrapper (used by
 *    every other list in the app) is completely untouched.
 *
 * Every other behavior (tenant scoping, money/currency rendering,
 * pagination, empty states, permissions) is byte-for-byte unchanged from
 * before this slice.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { user, organizationId, membership } = await getCurrentMembership();
  const resolvedSearchParams = await searchParams;
  const listParams = parseInvoiceListParams(resolvedSearchParams);

  const where = buildInvoiceWhere(organizationId, listParams);
  const orderBy = buildInvoiceOrderBy(listParams);

  // Quotes / Estimates Phase 2.3 — Client REQUIRED, Project OPTIONAL
  // (Invoice / Project Coupling Audit). Gating Invoice creation on
  // `clientCount` (never `projectCount`) — an org with zero Projects can
  // still fully use Invoices, as long as it has at least one Client.
  const [clientCount, [invoices, total], effectivePermissions] = await Promise.all([
    prisma.client.count({ where: { organizationId } }),
    prisma.$transaction([
      prisma.invoice.findMany({
        where,
        orderBy,
        skip: getOffset(listParams.page),
        take: PAGE_SIZE,
        include: {
          client: { select: { name: true } },
          project: { select: { name: true } },
        },
      }),
      prisma.invoice.count({ where }),
    ]),
    getCachedEffectivePermissionSet(organizationId, membership.role),
  ]);

  const totalPages = getTotalPages(total);
  const hasActiveParams = Boolean(listParams.q || listParams.status);

  // Tables Improvement Slice A — the one shared base every quick-filter
  // chip and every sortable header builds its own href from, so `q` is
  // never accidentally dropped by one and not the other. `page` is
  // deliberately never included here — omitting it always resets
  // pagination to page 1 (parsePageParam's own fallback), satisfying
  // "changing sort/filter resets to page 1" with no special-cased reset
  // logic anywhere below.
  const hrefBase = { q: listParams.q || undefined };

  const quickFilterChips = INVOICE_QUICK_FILTERS.map((filter) => ({
    label: filter.label,
    active: listParams.status === filter.status,
    href: buildInvoicesHref({
      ...hrefBase,
      // Clicking the already-active chip clears `status` entirely —
      // exactly the existing Status dropdown's own "All statuses" value
      // — never a second, competing "cleared" representation.
      status: listParams.status === filter.status ? undefined : filter.status,
      sort: listParams.sortCombined,
    }),
  }));

  function sortHrefFor(field: InvoiceSortField): string {
    return buildInvoicesHref({
      ...hrefBase,
      status: listParams.status,
      sort: nextInvoiceSortCombined(listParams, field),
    });
  }
  function directionFor(field: InvoiceSortField): "asc" | "desc" | null {
    return listParams.sortField === field ? listParams.sortDir : null;
  }

  // Tables Improvement Slice E1 — these are the EXACT SAME header/cell
  // JSX calls (TableHeaderCell/SortableHeader/TableCell, with the exact
  // same Link/StatusBadge/DeleteButton/RowActionMenu children) that
  // rendered this table before this slice, just built into per-column
  // slots instead of a flat `<tr>`/`<TableRow>` sequence. No
  // formatting/business logic is reimplemented — `InvoiceDesktopTable`
  // (a Client Component) only decides which of these already-built
  // slots to include, based on live column-visibility state; every
  // value here is computed server-side exactly as before (locked spec
  // §3/§18). Keyed by the same `InvoiceColumnId`s `./columns.ts` owns.
  const headerCells: Record<InvoiceColumnId, ReactNode> = {
    invoiceNumber: <TableHeaderCell>Invoice #</TableHeaderCell>,
    project: <TableHeaderCell>Project</TableHeaderCell>,
    client: <TableHeaderCell>Client</TableHeaderCell>,
    amount: <SortableHeader label="Amount" href={sortHrefFor("amount")} direction={directionFor("amount")} />,
    status: <TableHeaderCell>Status</TableHeaderCell>,
    dueDate: <SortableHeader label="Due date" href={sortHrefFor("dueDate")} direction={directionFor("dueDate")} />,
    createdAt: <SortableHeader label="Created" href={sortHrefFor("createdAt")} direction={directionFor("createdAt")} />,
    actions: <TableHeaderCell align="right">Actions</TableHeaderCell>,
  };

  const invoiceTableRows: InvoiceTableRow[] = invoices.map((invoice) => ({
    id: invoice.id,
    cells: {
      invoiceNumber: <TableCell emphasis>{invoice.invoiceNumber}</TableCell>,
      project: (
        <TableCell>
          {invoice.project ? (
            <Link href={`/projects/${invoice.projectId}`} className={ACTION_LINK_CLASSES}>
              {invoice.project.name}
            </Link>
          ) : (
            "No project"
          )}
        </TableCell>
      ),
      client: (
        <TableCell>
          <Link href={`/clients/${invoice.clientId}`} className={ACTION_LINK_CLASSES}>
            {invoice.client.name}
          </Link>
        </TableCell>
      ),
      amount: <TableCell>{formatCurrency(Number(invoice.amount), invoice.currency)}</TableCell>,
      status: (
        <TableCell>
          <StatusBadge status={invoice.status} label={formatInvoiceStatusLabel(invoice.status)} />
        </TableCell>
      ),
      dueDate: <TableCell>{invoice.dueDate ? formatDateOnlyForDisplay(invoice.dueDate) : "—"}</TableCell>,
      createdAt: <TableCell>{invoice.createdAt.toLocaleDateString()}</TableCell>,
      actions: (
        <TableCell align="right">
          <div className="flex items-center justify-end gap-3">
            {invoice.status === "DRAFT" ? (
              <>
                <Link
                  href={`/invoices/${invoice.id}/edit`}
                  className={`inline-flex items-center gap-1 ${ACTION_LINK_CLASSES}`}
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                  Edit
                </Link>
                <RowActionMenu label={`More actions for invoice ${invoice.invoiceNumber}`}>
                  <RowActionMenuItem>
                    <DeleteButton
                      action={deleteInvoiceAction.bind(null, invoice.id)}
                      itemName={invoice.invoiceNumber}
                      confirmTitle="Delete invoice"
                      confirmDescription={`Delete invoice ${invoice.invoiceNumber}? This action cannot be undone.`}
                      successMessage="Invoice deleted"
                      conflictMessage="This invoice can no longer be deleted — it may have already been issued."
                    />
                  </RowActionMenuItem>
                </RowActionMenu>
              </>
            ) : (
              <Link
                href={`/invoices/${invoice.id}/edit`}
                className={`inline-flex items-center gap-1 ${ACTION_LINK_CLASSES}`}
              >
                View
              </Link>
            )}
          </div>
        </TableCell>
      ),
    },
  }));

  return (
    <ColumnVisibilityProvider
      organizationId={organizationId}
      userId={user.id}
      surface={INVOICE_COLUMNS_SURFACE}
      knownColumnIds={INVOICE_COLUMN_IDS}
      mandatoryColumnIds={INVOICE_MANDATORY_COLUMN_IDS}
    >
    <div>
      <FinanceTabs recurringInvoicesManage={effectivePermissions.RECURRING_INVOICES_MANAGE} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">
            Invoices
          </h1>
          <p className="text-text-secondary mt-1 text-sm">
            {total} {total === 1 ? "invoice" : "invoices"}
          </p>
        </div>
        {clientCount > 0 && (
          <Link
            href="/invoices/new"
            className={PRIMARY_LINK_CLASSES}
          >
            Add invoice
          </Link>
        )}
      </div>

      {clientCount > 0 && (
        <>
          <QuickFilterChips label="Invoice quick filters" chips={quickFilterChips} />

          {/*
            Tables Improvement Slice D1 — placed between QuickFilterChips
            and SearchFilterBar (locked spec §25), never inside the
            filter bar itself. `currentParams` is built from the already-
            parsed canonical `listParams` server-side — never a raw
            query-string re-parse (locked spec §11) — and is plain,
            serializable data, safe to pass straight into this Client
            Component from the Server Component page.
          */}
          <div className="flex flex-wrap items-end justify-between gap-2">
            <InvoiceSavedViews
              organizationId={organizationId}
              userId={user.id}
              currentParams={serializeInvoiceSavedViewParams(listParams)}
            />

            {/*
              Tables Improvement Slice E1 — same controls-band placement
              contract as Saved Views (locked spec §12): never inside
              SearchFilterBar/QuickFilterChips, never in the page title/
              CTA row. Desktop-only (hidden below `xl` — the component's
              own wrapper carries `hidden xl:inline-block`): Column
              Customization has zero effect on the fixed mobile
              RecordCardList (locked spec §13), so showing a "Columns"
              trigger on mobile would only ever open a popover that
              changes nothing a mobile user can see — hiding it there is
              the least-confusing option, not an oversight.
            */}
            <ColumnVisibilityControl columns={INVOICE_COLUMNS} />
          </div>

          <SearchFilterBar
            // Tables Improvement Slice A — the quick-filter chips and the
            // new sortable headers are the first things on this page to
            // change `?status=`/`?sort=` via a plain client-side <Link>
            // navigation rather than a real form submission (every other
            // existing control here still submits the form, a genuine
            // browser navigation that always remounts fresh). Without a
            // key, React treats this as the SAME component instance across
            // such a Link navigation, so the Status/Sort <select>s (both
            // uncontrolled, via `defaultValue`) silently keep their OLD
            // value — `defaultValue` only applies on initial mount, never
            // on a later prop change. Keying on the exact state the chips/
            // headers can change forces a fresh mount whenever either
            // changes, so both dropdowns always reflect the current URL.
            //
            // Tables Improvement Slice D1 — widened to also include `q`:
            // Saved Views' own "Apply" control is the first Link-based
            // navigation on this page that can change `q` on its own while
            // leaving `status`/`sort` unchanged (no existing chip/header
            // href ever varies `q`), which would otherwise leave the
            // Search input (also `defaultValue`-based) showing stale text
            // even though the URL/results were already correct — see
            // contracts/page.tsx's own identical fix and header comment.
            key={`${listParams.q}:${listParams.status ?? "all"}:${listParams.sortCombined}`}
            basePath="/invoices"
            searchValue={listParams.q}
            searchPlaceholder="Search by invoice #, project, or client"
            filters={[
              {
                name: "status",
                label: "Status",
                value: listParams.status ?? "",
                options: [
                  { value: "", label: "All statuses" },
                  ...INVOICE_STATUSES.map((status) => ({
                    value: status,
                    label: formatInvoiceStatusLabel(status),
                  })),
                ],
              },
            ]}
            sort={{ value: listParams.sortCombined, options: SORT_OPTIONS }}
            hasActiveParams={hasActiveParams}
          />
        </>
      )}

      {total === 0 ? (
        clientCount === 0 ? (
          <EmptyState
            title="You need a client first"
            description="Invoices must belong to a client. Add one before creating an invoice."
            action={
              <Link
                href="/clients/new"
                className={PRIMARY_LINK_CLASSES}
              >
                Add client
              </Link>
            }
          />
        ) : hasActiveParams ? (
          <EmptyState
            title="No matching invoices"
            description="Try a different search term or clear your filters."
            action={
              <Link
                href="/invoices"
                className={PRIMARY_LINK_CLASSES}
              >
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="No invoices yet"
            description="Get started by adding your first invoice."
            action={
              <Link
                href="/invoices/new"
                className={PRIMARY_LINK_CLASSES}
              >
                Add invoice
              </Link>
            }
          />
        )
      ) : (
        <>
          {/*
            Tables Improvement Slice E1 — the sticky-header pilot
            (Slice A) markup/classes now live inside
            `InvoiceDesktopTable` itself, byte-identical to before this
            slice (locked spec §15 — "do not change sticky-header
            architecture unless strictly necessary"); only WHICH columns
            render is now a client-side decision, fed by the already-
            server-built `headerCells`/`invoiceTableRows` slots above.
          */}
          <InvoiceDesktopTable headerCells={headerCells} rows={invoiceTableRows} />

          <RecordCardList>
            {invoices.map((invoice) => (
              <RecordCard key={invoice.id}>
                <RecordCardField label="Invoice #" value={invoice.invoiceNumber} emphasis />
                <RecordCardField
                  label="Project"
                  value={
                    invoice.project ? (
                      <Link href={`/projects/${invoice.projectId}`} className={ACTION_LINK_CLASSES}>
                        {invoice.project.name}
                      </Link>
                    ) : (
                      "No project"
                    )
                  }
                />
                <RecordCardField
                  label="Client"
                  value={
                    <Link href={`/clients/${invoice.clientId}`} className={ACTION_LINK_CLASSES}>
                      {invoice.client.name}
                    </Link>
                  }
                />
                <RecordCardField
                  label="Amount"
                  value={formatCurrency(Number(invoice.amount), invoice.currency)}
                />
                <RecordCardField
                  label="Status"
                  value={<StatusBadge status={invoice.status} label={formatInvoiceStatusLabel(invoice.status)} />}
                />
                <RecordCardField
                  label="Due date"
                  value={invoice.dueDate ? formatDateOnlyForDisplay(invoice.dueDate) : "—"}
                />
                <RecordCardField label="Created" value={invoice.createdAt.toLocaleDateString()} />
                <RecordCardActions>
                  {invoice.status === "DRAFT" ? (
                    <>
                      <Link
                        href={`/invoices/${invoice.id}/edit`}
                        className={`inline-flex items-center gap-1 ${ACTION_LINK_CLASSES}`}
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                        Edit
                      </Link>
                      <RowActionMenu label={`More actions for invoice ${invoice.invoiceNumber}`}>
                        <RowActionMenuItem>
                          <DeleteButton
                            action={deleteInvoiceAction.bind(null, invoice.id)}
                            itemName={invoice.invoiceNumber}
                            confirmTitle="Delete invoice"
                            confirmDescription={`Delete invoice ${invoice.invoiceNumber}? This action cannot be undone.`}
                            successMessage="Invoice deleted"
                            conflictMessage="This invoice can no longer be deleted — it may have already been issued."
                          />
                        </RowActionMenuItem>
                      </RowActionMenu>
                    </>
                  ) : (
                    <Link
                      href={`/invoices/${invoice.id}/edit`}
                      className={`inline-flex items-center gap-1 ${ACTION_LINK_CLASSES}`}
                    >
                      View
                    </Link>
                  )}
                </RecordCardActions>
              </RecordCard>
            ))}
          </RecordCardList>

          <Pagination
            basePath="/invoices"
            params={{
              ...(listParams.q ? { q: listParams.q } : {}),
              ...(listParams.status ? { status: listParams.status } : {}),
              sort: listParams.sortCombined,
            }}
            page={listParams.page}
            totalPages={totalPages}
          />
        </>
      )}
    </div>
    </ColumnVisibilityProvider>
  );
}
