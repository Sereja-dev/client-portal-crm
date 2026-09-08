import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/format";
import { formatInvoiceStatusLabel } from "@/lib/invoices/status-label";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { PAGE_SIZE, getOffset, getTotalPages, type RawSearchParams } from "@/lib/list-params";
import { requireInvoiceProject } from "@/lib/invoices/require-invoice-project";
import { DeleteButton } from "@/components/ui/delete-button";
import { deleteInvoiceAction } from "./actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PencilIcon } from "@/components/ui/icons";
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
  RecordCardActions,
} from "@/components/ui/record-list";
import { INVOICE_STATUSES } from "@/lib/validation/invoice";
import {
  parseInvoiceListParams,
  buildInvoiceWhere,
  buildInvoiceOrderBy,
} from "./query";

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

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;
  const listParams = parseInvoiceListParams(resolvedSearchParams);

  const where = buildInvoiceWhere(organizationId, listParams);
  const orderBy = buildInvoiceOrderBy(listParams);

  const [projectCount, [rawInvoices, total]] = await Promise.all([
    prisma.project.count({ where: { organizationId } }),
    prisma.$transaction([
      prisma.invoice.findMany({
        where,
        orderBy,
        skip: getOffset(listParams.page),
        take: PAGE_SIZE,
        include: {
          project: { select: { name: true, client: { select: { name: true } } } },
        },
      }),
      prisma.invoice.count({ where }),
    ]),
  ]);

  // Quotes / Estimates Phase 2.2b — TRANSITIONAL compile-safety narrow
  // (see src/lib/invoices/require-invoice-project.ts's own header
  // comment). buildInvoiceWhere's own `where` already requires
  // `project: { organizationId }`, so every fetched row here always has
  // one.
  const invoices = rawInvoices.map((invoice) => ({
    ...invoice,
    project: requireInvoiceProject(invoice.project, "invoices list page"),
  }));

  const totalPages = getTotalPages(total);
  const hasActiveParams = Boolean(listParams.q || listParams.status);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">
            Invoices
          </h1>
          <p className="text-text-secondary mt-1 text-sm">
            {total} {total === 1 ? "invoice" : "invoices"}
          </p>
        </div>
        {projectCount > 0 && (
          <Link
            href="/invoices/new"
            className={PRIMARY_LINK_CLASSES}
          >
            Add invoice
          </Link>
        )}
      </div>

      {projectCount > 0 && (
        <SearchFilterBar
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
      )}

      {total === 0 ? (
        projectCount === 0 ? (
          <EmptyState
            title="You need a project first"
            description="Invoices must belong to a project. Add one before creating an invoice."
            action={
              <Link
                href="/projects/new"
                className={PRIMARY_LINK_CLASSES}
              >
                Add project
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
          <div className="hidden xl:block">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Invoice #</TableHeaderCell>
                  <TableHeaderCell>Project</TableHeaderCell>
                  <TableHeaderCell>Client</TableHeaderCell>
                  <TableHeaderCell>Amount</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Due date</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell emphasis>{invoice.invoiceNumber}</TableCell>
                    <TableCell>{invoice.project.name}</TableCell>
                    <TableCell>{invoice.project.client.name}</TableCell>
                    <TableCell>
                      {formatCurrency(Number(invoice.amount), invoice.currency)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={invoice.status} label={formatInvoiceStatusLabel(invoice.status)} />
                    </TableCell>
                    <TableCell>
                      {invoice.dueDate
                        ? formatDateOnlyForDisplay(invoice.dueDate)
                        : "—"}
                    </TableCell>
                    <TableCell>{invoice.createdAt.toLocaleDateString()}</TableCell>
                    <TableCell align="right">
                      <div className="flex items-center justify-end gap-4">
                        {invoice.status === "DRAFT" ? (
                          <>
                            <Link
                              href={`/invoices/${invoice.id}/edit`}
                              className={`inline-flex items-center gap-1 ${ACTION_LINK_CLASSES}`}
                            >
                              <PencilIcon className="h-3.5 w-3.5" />
                              Edit
                            </Link>
                            <DeleteButton
                              action={deleteInvoiceAction.bind(null, invoice.id)}
                              itemName={invoice.invoiceNumber}
                              confirmTitle="Delete invoice"
                              confirmDescription={`Delete invoice ${invoice.invoiceNumber}? This action cannot be undone.`}
                              successMessage="Invoice deleted"
                              conflictMessage="This invoice can no longer be deleted — it may have already been issued."
                            />
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <RecordCardList>
            {invoices.map((invoice) => (
              <RecordCard key={invoice.id}>
                <RecordCardField label="Invoice #" value={invoice.invoiceNumber} emphasis />
                <RecordCardField label="Project" value={invoice.project.name} />
                <RecordCardField label="Client" value={invoice.project.client.name} />
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
                      <DeleteButton
                        action={deleteInvoiceAction.bind(null, invoice.id)}
                        itemName={invoice.invoiceNumber}
                        confirmTitle="Delete invoice"
                        confirmDescription={`Delete invoice ${invoice.invoiceNumber}? This action cannot be undone.`}
                        successMessage="Invoice deleted"
                        conflictMessage="This invoice can no longer be deleted — it may have already been issued."
                      />
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
  );
}
