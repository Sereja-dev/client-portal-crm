import type { Prisma } from "@/generated/prisma/client";
import { StatusBadge } from "@/components/ui/status-badge";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { formatInvoiceStatusLabel } from "@/lib/invoices/status-label";
import { formatInvoiceCurrencyAmount } from "@/lib/invoices/currencies";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { InvoiceLifecycleControls } from "./invoice-lifecycle-controls";
import { InvoiceInternalNotesForm } from "./invoice-internal-notes-form";
import { InvoiceLegacyArchiveControls } from "./invoice-legacy-archive-controls";
import { InvoiceSendControls } from "./invoice-send-controls";
import type { InvoiceEmailAttemptSummary } from "@/lib/invoices/email/attempt-history";
import type { InvoiceStatusValue } from "@/lib/validation/invoice";
import type { InvoiceTotalsViewModel } from "@/lib/invoices/totals-view-model";

type MoneyValue = Prisma.Decimal | string | number;

export type InvoiceReadOnlyLineItem = { description: string; quantity: MoneyValue; unitPrice: MoneyValue; lineTotal: MoneyValue };

/**
 * The complete visible contract for an existing non-DRAFT invoice
 * (docs/invoicing-architecture.md §4.6). Never fabricates a line item for
 * a flat invoice, and renders no editable frozen field, Issue, Send, or
 * email control. Duplicate (via InvoiceLifecycleControls, §3.2) is
 * available only for a terminal CANCELLED invoice, never for
 * SENT/PAID/OVERDUE. As of Invoice System Official Slice 3, sub-PR 3c, a
 * genuinely archived invoice (`hasArchivedPdf`, computed server-side by
 * the caller via classifyInvoiceArchival() — never derived here, and
 * never backed by pdfStoragePath/a ledger id/a snapshot/a signed URL
 * crossing into this component's own props) renders one plain
 * "Download PDF" link. As of Invoice System Official Slice 3, Legacy
 * Archive, a `legacy_eligible` invoice (also computed server-side by the
 * caller, never derived here) instead renders the OWNER-only "Archive
 * Legacy Invoice" control — the two are always mutually exclusive, since
 * a row can never be both `archived` and `legacy_eligible` at once. DRAFT
 * never reaches this component at all; every `invariant_violation` reason
 * renders neither control.
 */
export function InvoiceReadOnlyView({
  invoiceId,
  invoiceNumber,
  status,
  projectName,
  clientName,
  currency,
  issueDate,
  dueDate,
  paidAt,
  lineItems,
  notes,
  internalNotes,
  hasArchivedPdf,
  canArchiveLegacy,
  canSendEmail,
  emailAttempts,
  expectedUpdatedAt,
  totals,
}: {
  invoiceId: string;
  invoiceNumber: string;
  status: InvoiceStatusValue;
  projectName: string | null;
  clientName: string;
  currency: string;
  issueDate: Date;
  dueDate: Date | null;
  paidAt: Date | null;
  lineItems: InvoiceReadOnlyLineItem[];
  notes: string | null;
  internalNotes: string | null;
  hasArchivedPdf: boolean;
  canArchiveLegacy: boolean;
  canSendEmail: boolean;
  emailAttempts: InvoiceEmailAttemptSummary[];
  expectedUpdatedAt: string;
  totals: InvoiceTotalsViewModel;
}) {
  const format = (value: MoneyValue) => formatInvoiceCurrencyAmount(value, currency) ?? String(value);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-text-primary text-lg font-semibold">{invoiceNumber}</h2>
          <p className="text-text-secondary mt-1 text-sm">
            {projectName ? `${projectName} — ${clientName}` : clientName}
          </p>
        </div>
        <StatusBadge status={status} label={formatInvoiceStatusLabel(status)} />
      </div>

      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-text-muted">Currency</dt>
          <dd className="text-text-primary mt-0.5">{currency}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Issue date</dt>
          <dd className="text-text-primary mt-0.5">{formatDateOnlyForDisplay(issueDate)}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Due date</dt>
          <dd className="text-text-primary mt-0.5">{dueDate ? formatDateOnlyForDisplay(dueDate) : "—"}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Paid date</dt>
          <dd className="text-text-primary mt-0.5">{paidAt ? paidAt.toLocaleDateString() : "—"}</dd>
        </div>
      </dl>

      {lineItems.length > 0 ? (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Description</TableHeaderCell>
              <TableHeaderCell align="right">Qty</TableHeaderCell>
              <TableHeaderCell align="right">Unit price</TableHeaderCell>
              <TableHeaderCell align="right">Line total</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {lineItems.map((item, index) => (
              <TableRow key={index}>
                <TableCell emphasis>{item.description}</TableCell>
                <TableCell align="right">{String(item.quantity)}</TableCell>
                <TableCell align="right">{format(item.unitPrice)}</TableCell>
                <TableCell align="right" emphasis>
                  {format(item.lineTotal)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      <div className="ml-auto max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-text-muted">Subtotal</span>
          <span className="text-text-primary">{totals.displayedSubtotal}</span>
        </div>
        {totals.discountRow && (
          <div className="flex justify-between">
            <span className="text-text-muted">{totals.discountRow.label}</span>
            <span className="text-text-primary">-{totals.discountRow.amount}</span>
          </div>
        )}
        {totals.taxRow && (
          <div className="flex justify-between">
            <span className="text-text-muted">{totals.taxRow.label}</span>
            <span className="text-text-primary">{totals.taxRow.amount}</span>
          </div>
        )}
        <div className="border-border-default flex justify-between border-t pt-1 font-medium">
          <span className="text-text-primary">Total</span>
          <span className="text-text-primary">{totals.total}</span>
        </div>
      </div>

      {notes && (
        <div>
          <h3 className="text-text-secondary text-sm font-medium">Notes</h3>
          <p className="text-text-secondary mt-1 text-sm whitespace-pre-wrap">{notes}</p>
        </div>
      )}

      <InvoiceInternalNotesForm invoiceId={invoiceId} initialValue={internalNotes ?? ""} />

      {hasArchivedPdf && (
        <a href={`/api/invoices/${invoiceId}/pdf`} className={`inline-block ${ACTION_LINK_CLASSES}`}>
          Download PDF
        </a>
      )}

      {canArchiveLegacy && (
        <InvoiceLegacyArchiveControls invoiceId={invoiceId} invoiceNumber={invoiceNumber} expectedUpdatedAt={expectedUpdatedAt} />
      )}

      {canSendEmail && (
        <InvoiceSendControls invoiceId={invoiceId} invoiceNumber={invoiceNumber} attempts={emailAttempts} />
      )}

      <InvoiceLifecycleControls invoiceId={invoiceId} status={status} invoiceNumber={invoiceNumber} />
    </div>
  );
}
