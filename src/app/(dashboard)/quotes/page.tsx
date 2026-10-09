import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentMembership } from "@/lib/current-user";
import { getCachedEffectivePermissionSet } from "@/lib/permissions/resolver";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import { prisma } from "@/lib/prisma";
import { formatInvoiceCurrencyAmount } from "@/lib/invoices/currencies";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { deriveQuoteTargetDisplay } from "@/lib/quotes/target-display";
import { PAGE_SIZE, getOffset, getTotalPages, type RawSearchParams } from "@/lib/list-params";
import { QuoteStatusBadge } from "@/components/quotes/quote-status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { SearchFilterBar } from "@/components/list/search-filter-bar";
import { Pagination } from "@/components/list/pagination";
import { TableHeaderCell, TableCell } from "@/components/ui/table";
import {
  RecordCardList,
  RecordCard,
  RecordCardField,
} from "@/components/ui/record-list";
import { QUOTE_STATUS_FILTER_VALUES, parseQuoteListParams, buildQuoteWhere, buildQuoteOrderBy } from "./query";
import { serializeQuoteSavedViewParams } from "./saved-view";
import { QuoteSavedViews } from "@/components/quotes/quote-saved-views";
import {
  QUOTE_COLUMNS,
  QUOTE_COLUMNS_SURFACE,
  QUOTE_COLUMN_IDS,
  QUOTE_MANDATORY_COLUMN_IDS,
  type QuoteColumnId,
} from "./columns";
import { ColumnVisibilityProvider } from "@/components/list/column-visibility-context";
import { ColumnVisibilityControl } from "@/components/list/column-visibility-control";
import { QuoteDesktopTable, type QuoteTableRow } from "@/components/quotes/quote-desktop-table";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

const STATUS_FILTER_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  APPROVED: "Approved",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  CONVERTED: "Converted",
};

const SORT_OPTIONS = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "updatedAt:desc", label: "Recently updated" },
  { value: "issueDate:desc", label: "Issue date (newest)" },
  { value: "validUntil:asc", label: "Valid until (soonest)" },
  { value: "total:desc", label: "Total (high to low)" },
  { value: "total:asc", label: "Total (low to high)" },
];

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { user, organizationId, membership } = await getCurrentMembership();
  const resolvedSearchParams = await searchParams;
  const listParams = parseQuoteListParams(resolvedSearchParams);

  const where = buildQuoteWhere(organizationId, listParams);
  const orderBy = buildQuoteOrderBy(listParams);

  // A Quote target is Lead OR Client (§B) — creation only needs at least
  // one of the two to exist at all, mirroring Invoice's own
  // clientCount-gated "Add invoice" precedent, widened to either target.
  const [leadCount, clientCount, [quotes, total], effectivePermissions] = await Promise.all([
    prisma.lead.count({ where: { organizationId, archivedAt: null } }),
    prisma.client.count({ where: { organizationId } }),
    prisma.$transaction([
      prisma.quote.findMany({
        where,
        orderBy,
        skip: getOffset(listParams.page),
        take: PAGE_SIZE,
        include: {
          client: { select: { id: true, name: true } },
          lead: { select: { id: true, name: true } },
          convertedInvoice: { select: { id: true, invoiceNumber: true } },
        },
      }),
      prisma.quote.count({ where }),
    ]),
    getCachedEffectivePermissionSet(organizationId, membership.role),
  ]);

  const canCreate = leadCount > 0 || clientCount > 0;
  const totalPages = getTotalPages(total);
  const hasActiveParams = Boolean(listParams.q || listParams.status || listParams.targetType || listParams.archived);

  const sharedParams = {
    ...(listParams.q ? { q: listParams.q } : {}),
    ...(listParams.status ? { status: listParams.status } : {}),
    ...(listParams.targetType ? { targetType: listParams.targetType } : {}),
    ...(listParams.archived ? { archived: "1" } : {}),
    sort: listParams.sortCombined,
  };

  // Tables Improvement Slice E3A — these are the EXACT SAME header/cell
  // JSX calls (TableHeaderCell/TableCell, with the exact same Link/
  // QuoteStatusBadge/formatInvoiceCurrencyAmount/formatDateOnlyForDisplay/
  // deriveQuoteTargetDisplay calls) that rendered this table before this
  // slice, just built into per-column slots instead of a flat
  // `<tr>`/`<TableRow>` sequence. No formatting/business logic is
  // reimplemented — `QuoteDesktopTable` (a Client Component) only
  // decides which of these already-built slots to include, based on
  // live column-visibility state; every value here is computed
  // server-side exactly as before (E3A readiness audit §J). Keyed by
  // the same `QuoteColumnId`s `./columns.ts` owns.
  const headerCells: Record<QuoteColumnId, ReactNode> = {
    quoteNumber: <TableHeaderCell>Quote #</TableHeaderCell>,
    target: <TableHeaderCell>Target</TableHeaderCell>,
    title: <TableHeaderCell>Title</TableHeaderCell>,
    status: <TableHeaderCell>Status</TableHeaderCell>,
    total: <TableHeaderCell align="right">Total</TableHeaderCell>,
    issueDate: <TableHeaderCell>Issue date</TableHeaderCell>,
    validUntil: <TableHeaderCell>Valid until</TableHeaderCell>,
    actions: <TableHeaderCell align="right">Actions</TableHeaderCell>,
  };

  const quoteTableRows: QuoteTableRow[] = quotes.map((quote) => {
    const target = deriveQuoteTargetDisplay(quote);
    return {
      id: quote.id,
      cells: {
        quoteNumber: <TableCell emphasis>{quote.number}</TableCell>,
        target: (
          <TableCell>
            <Link href={target.href} className={ACTION_LINK_CLASSES}>
              {target.name}
            </Link>
            <span className="text-text-muted ml-2 text-xs">{target.type === "LEAD" ? "Lead" : "Client"}</span>
          </TableCell>
        ),
        title: <TableCell>{quote.title ?? "—"}</TableCell>,
        status: (
          <TableCell>
            <QuoteStatusBadge quote={quote} />
          </TableCell>
        ),
        total: (
          <TableCell align="right">
            {formatInvoiceCurrencyAmount(quote.total, quote.currency) ?? quote.total.toString()}
          </TableCell>
        ),
        issueDate: <TableCell>{formatDateOnlyForDisplay(quote.issueDate)}</TableCell>,
        validUntil: (
          <TableCell>{quote.validUntil ? formatDateOnlyForDisplay(quote.validUntil) : "—"}</TableCell>
        ),
        actions: (
          <TableCell align="right">
            <Link href={`/quotes/${quote.id}/edit`} className={ACTION_LINK_CLASSES}>
              {quote.status === "DRAFT" ? "Edit" : "View"}
            </Link>
          </TableCell>
        ),
      },
    };
  });

  return (
    <ColumnVisibilityProvider
      organizationId={organizationId}
      userId={user.id}
      surface={QUOTE_COLUMNS_SURFACE}
      knownColumnIds={QUOTE_COLUMN_IDS}
      mandatoryColumnIds={QUOTE_MANDATORY_COLUMN_IDS}
    >
    <div>
      <FinanceTabs recurringInvoicesManage={effectivePermissions.RECURRING_INVOICES_MANAGE} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Quotes</h1>
          <p className="text-text-secondary mt-1 text-sm">
            {total} {total === 1 ? "quote" : "quotes"}
          </p>
        </div>
        {canCreate && (
          <Link href="/quotes/new" className={PRIMARY_LINK_CLASSES}>
            Add quote
          </Link>
        )}
      </div>

      {canCreate && (
        <>
          {/*
            Tables Improvement Slice D2A — same placement contract as
            Invoices/Contracts (D1 locked spec §25): below the page
            header/primary action, above SearchFilterBar, no quick-
            filter chips exist on this page to place relative to.
            `currentParams` is built from the already-parsed canonical
            `listParams` server-side — never a raw query-string
            re-parse — and is plain, serializable data, safe to pass
            straight into this Client Component from the Server
            Component page.
          */}
          <div className="flex flex-wrap items-end justify-between gap-2">
            <QuoteSavedViews
              organizationId={organizationId}
              userId={user.id}
              currentParams={serializeQuoteSavedViewParams(listParams)}
            />

            {/*
              Tables Improvement Slice E3A — same controls-band placement
              contract as Saved Views and as Invoices/Contracts' own
              Columns control: never inside SearchFilterBar, never in
              the page title/CTA row. Desktop-only (the component's own
              wrapper carries `hidden xl:inline-block`) — Column
              Customization has zero effect on the fixed mobile
              RecordCardList (readiness audit §I/§14), so showing a
              "Columns" trigger on mobile would only ever open a popover
              that changes nothing a mobile user can see.
            */}
            <ColumnVisibilityControl columns={QUOTE_COLUMNS} />
          </div>

          <SearchFilterBar
            // Tables Improvement Slice D2A — the D2 readiness audit
            // confirmed this page had no existing Link-based navigation
            // that varies q/status/targetType/archived/sort
            // independently of `page`, so SearchFilterBar never needed
            // a remount key before now. Saved Views' own "Apply" link is
            // the first one that can -- the identical gap already found
            // and fixed for Invoices/Contracts (see those pages' own
            // identical comment): without a key, the uncontrolled
            // (defaultValue-based) Status/Target/Archived/Sort
            // <select>s and the Search <input> would silently keep
            // their stale value across such a navigation. Keying on the
            // full set of Saved-View-managed dimensions forces a fresh
            // mount whenever any of them changes -- `page` is
            // deliberately excluded, matching every other surface's
            // identical convention.
            key={`${listParams.q}:${listParams.status ?? ""}:${listParams.targetType ?? ""}:${listParams.archived}:${listParams.sortCombined}`}
            basePath="/quotes"
            searchValue={listParams.q}
            searchPlaceholder="Search by quote #, title, lead, or client"
            filters={[
              {
                name: "status",
                label: "Status",
                value: listParams.status ?? "",
                options: [
                  { value: "", label: "All statuses" },
                  ...QUOTE_STATUS_FILTER_VALUES.map((value) => ({ value, label: STATUS_FILTER_LABELS[value] })),
                ],
              },
              {
                name: "targetType",
                label: "Target",
                value: listParams.targetType ?? "",
                options: [
                  { value: "", label: "Lead or client" },
                  { value: "LEAD", label: "Lead" },
                  { value: "CLIENT", label: "Client" },
                ],
              },
              {
                name: "archived",
                label: "Status",
                value: listParams.archived ? "1" : "",
                options: [
                  { value: "", label: "Active" },
                  { value: "1", label: "Archived" },
                ],
              },
            ]}
            sort={{ value: listParams.sortCombined, options: SORT_OPTIONS }}
            hasActiveParams={hasActiveParams}
          />
        </>
      )}

      {total === 0 ? (
        !canCreate ? (
          <EmptyState
            title="You need a lead or a client first"
            description="Quotes go to a lead or a client. Add one before creating a quote."
            action={
              <div className="flex justify-center gap-3">
                <Link href="/leads/new" className={PRIMARY_LINK_CLASSES}>
                  Add lead
                </Link>
                <Link href="/clients/new" className={PRIMARY_LINK_CLASSES}>
                  Add client
                </Link>
              </div>
            }
          />
        ) : hasActiveParams ? (
          <EmptyState
            title="No matching quotes"
            description="Try a different search term or clear your filters."
            action={
              <Link href="/quotes" className={PRIMARY_LINK_CLASSES}>
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="No quotes yet"
            description="Create a quote for a lead or a client, send it, and track it through approval — right through to converting it into an invoice."
            action={
              <Link href="/quotes/new" className={PRIMARY_LINK_CLASSES}>
                Create quote
              </Link>
            }
          />
        )
      ) : (
        <>
          {/*
            Tables Improvement Slice E3A — only WHICH columns render is
            now a client-side decision, fed by the already-server-built
            `headerCells`/`quoteTableRows` slots above; the `<table>`
            markup itself (no sticky header — readiness audit §P) is
            unchanged from before this slice, now living inside
            `QuoteDesktopTable`.
          */}
          <QuoteDesktopTable headerCells={headerCells} rows={quoteTableRows} />

          <RecordCardList>
            {quotes.map((quote) => {
              const target = deriveQuoteTargetDisplay(quote);
              return (
                <RecordCard key={quote.id}>
                  <RecordCardField label="Quote #" value={quote.number} emphasis />
                  <RecordCardField
                    label="Target"
                    value={
                      <>
                        <Link href={target.href} className={ACTION_LINK_CLASSES}>
                          {target.name}
                        </Link>
                        <span className="text-text-muted ml-2 text-xs">
                          {target.type === "LEAD" ? "Lead" : "Client"}
                        </span>
                      </>
                    }
                  />
                  {quote.title && <RecordCardField label="Title" value={quote.title} />}
                  <RecordCardField label="Status" value={<QuoteStatusBadge quote={quote} />} />
                  <RecordCardField
                    label="Total"
                    value={formatInvoiceCurrencyAmount(quote.total, quote.currency) ?? quote.total.toString()}
                  />
                  <RecordCardField label="Issue date" value={formatDateOnlyForDisplay(quote.issueDate)} />
                  <RecordCardField
                    label="Valid until"
                    value={quote.validUntil ? formatDateOnlyForDisplay(quote.validUntil) : "—"}
                  />
                  <div className="mt-3">
                    <Link href={`/quotes/${quote.id}/edit`} className={ACTION_LINK_CLASSES}>
                      {quote.status === "DRAFT" ? "Edit" : "View"}
                    </Link>
                  </div>
                </RecordCard>
              );
            })}
          </RecordCardList>

          <Pagination basePath="/quotes" params={sharedParams} page={listParams.page} totalPages={totalPages} />
        </>
      )}
    </div>
    </ColumnVisibilityProvider>
  );
}
