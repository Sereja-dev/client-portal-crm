import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatInvoiceStatusLabel } from "@/lib/invoices/status-label";
import { formatCurrency } from "@/lib/format";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { RecordCardList, RecordCard, RecordCardField } from "@/components/ui/record-list";
import type { ClientInvoiceRow } from "./profile-query";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

function formatDate(date: Date | null): string {
  return date ? date.toLocaleDateString() : "—";
}

/** Each row's own amount is formatted in that invoice's own currency — never summed across rows (Section 13's own explicit invariant; see also the Overview's own currency-agnostic unpaid COUNT). */
export function ClientInvoicesTab({ clientId, invoices }: { clientId: string; invoices: ClientInvoiceRow[] }) {
  if (invoices.length === 0) {
    return (
      <EmptyState
        title="No invoices yet"
        description="Invoices for this client will appear here."
        action={
          <Link href={`/invoices/new?clientId=${clientId}`} className={PRIMARY_LINK_CLASSES}>
            Create invoice
          </Link>
        }
      />
    );
  }

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Invoice #</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Issued</TableHeaderCell>
              <TableHeaderCell>Due</TableHeaderCell>
              <TableHeaderCell align="right">Amount</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell emphasis>
                  <Link href={`/invoices/${invoice.id}/edit`} className={ACTION_LINK_CLASSES}>
                    {invoice.invoiceNumber}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={invoice.status} label={formatInvoiceStatusLabel(invoice.status)} />
                </TableCell>
                <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                <TableCell align="right">{formatCurrency(Number(invoice.amount), invoice.currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <RecordCardList>
        {invoices.map((invoice) => (
          <RecordCard key={invoice.id}>
            <RecordCardField
              label="Invoice #"
              value={
                <Link href={`/invoices/${invoice.id}/edit`} className={ACTION_LINK_CLASSES}>
                  {invoice.invoiceNumber}
                </Link>
              }
              emphasis
            />
            <RecordCardField
              label="Status"
              value={<StatusBadge status={invoice.status} label={formatInvoiceStatusLabel(invoice.status)} />}
            />
            <RecordCardField label="Issued" value={formatDate(invoice.issueDate)} />
            <RecordCardField label="Due" value={formatDate(invoice.dueDate)} />
            <RecordCardField label="Amount" value={formatCurrency(Number(invoice.amount), invoice.currency)} />
          </RecordCard>
        ))}
      </RecordCardList>
    </>
  );
}
