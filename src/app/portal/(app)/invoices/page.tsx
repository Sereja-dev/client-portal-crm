import Link from "next/link";
import { getCurrentPortalUser } from "@/lib/current-portal-user";
import {
  getPortalInvoices,
  parsePortalInvoiceFilter,
  type PortalInvoiceFilter,
} from "@/lib/client-portal/queries";
import { parseSearchParam, type RawSearchParams } from "@/lib/list-params";
import { formatCurrency } from "@/lib/format";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";

const FILTER_TABS: { value: PortalInvoiceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "paid", label: "Paid" },
];

export default async function PortalInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { clientId, organizationId } = await getCurrentPortalUser();
  const resolvedSearchParams = await searchParams;
  const filter = parsePortalInvoiceFilter(parseSearchParam(resolvedSearchParams.status));

  const invoices = await getPortalInvoices(clientId, organizationId, filter);

  return (
    <div>
      <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Invoices</h1>
      <p className="text-text-muted mt-1 text-sm">
        {invoices.length} {invoices.length === 1 ? "invoice" : "invoices"}
      </p>

      <div className="mt-4 flex gap-1">
        {FILTER_TABS.map((tab) => {
          const active = tab.value === filter;
          const href = tab.value === "all" ? "/portal/invoices" : `/portal/invoices?status=${tab.value}`;
          return (
            <Link
              key={tab.value}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`focus-visible:ring-focus-ring rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                active ? "bg-accent text-white" : "text-text-secondary hover:bg-[var(--hover)]"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {invoices.length === 0 ? (
        <EmptyState
          title="No invoices"
          description={
            filter === "all"
              ? "Invoices will appear here once your team creates one."
              : "No invoices match this filter."
          }
        />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Invoice #</TableHeaderCell>
              <TableHeaderCell>Project</TableHeaderCell>
              <TableHeaderCell>Issue date</TableHeaderCell>
              <TableHeaderCell>Due date</TableHeaderCell>
              <TableHeaderCell>Amount</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell emphasis>
                  <Link
                    href={`/portal/invoices/${invoice.id}`}
                    className="focus-visible:ring-focus-ring rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    {invoice.invoiceNumber}
                  </Link>
                </TableCell>
                <TableCell>{invoice.projectName ?? "No project"}</TableCell>
                <TableCell>{invoice.issueDate.toLocaleDateString()}</TableCell>
                <TableCell>
                  {invoice.dueDate ? invoice.dueDate.toLocaleDateString() : "—"}
                </TableCell>
                <TableCell>{formatCurrency(invoice.amount, invoice.currency)}</TableCell>
                <TableCell>
                  <StatusBadge status={invoice.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
