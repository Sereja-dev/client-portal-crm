import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
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
import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  RecordCardList,
  RecordCard,
  RecordCardField,
} from "@/components/ui/record-list";
import { QUOTE_STATUS_FILTER_VALUES, parseQuoteListParams, buildQuoteWhere, buildQuoteOrderBy } from "./query";

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
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;
  const listParams = parseQuoteListParams(resolvedSearchParams);

  const where = buildQuoteWhere(organizationId, listParams);
  const orderBy = buildQuoteOrderBy(listParams);

  // A Quote target is Lead OR Client (§B) — creation only needs at least
  // one of the two to exist at all, mirroring Invoice's own
  // clientCount-gated "Add invoice" precedent, widened to either target.
  const [leadCount, clientCount, [quotes, total]] = await Promise.all([
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

  return (
    <div>
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
        <SearchFilterBar
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
          <div className="hidden xl:block">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Quote #</TableHeaderCell>
                  <TableHeaderCell>Target</TableHeaderCell>
                  <TableHeaderCell>Title</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell align="right">Total</TableHeaderCell>
                  <TableHeaderCell>Issue date</TableHeaderCell>
                  <TableHeaderCell>Valid until</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {quotes.map((quote) => {
                  const target = deriveQuoteTargetDisplay(quote);
                  return (
                    <TableRow key={quote.id}>
                      <TableCell emphasis>{quote.number}</TableCell>
                      <TableCell>
                        <Link href={target.href} className={ACTION_LINK_CLASSES}>
                          {target.name}
                        </Link>
                        <span className="text-text-muted ml-2 text-xs">
                          {target.type === "LEAD" ? "Lead" : "Client"}
                        </span>
                      </TableCell>
                      <TableCell>{quote.title ?? "—"}</TableCell>
                      <TableCell>
                        <QuoteStatusBadge quote={quote} />
                      </TableCell>
                      <TableCell align="right">
                        {formatInvoiceCurrencyAmount(quote.total, quote.currency) ?? quote.total.toString()}
                      </TableCell>
                      <TableCell>{formatDateOnlyForDisplay(quote.issueDate)}</TableCell>
                      <TableCell>{quote.validUntil ? formatDateOnlyForDisplay(quote.validUntil) : "—"}</TableCell>
                      <TableCell align="right">
                        <Link
                          href={`/quotes/${quote.id}/edit`}
                          className={ACTION_LINK_CLASSES}
                        >
                          {quote.status === "DRAFT" ? "Edit" : "View"}
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

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
  );
}
