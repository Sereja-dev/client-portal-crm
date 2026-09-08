import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentPortalUser } from "@/lib/current-portal-user";
import { getPortalQuote } from "@/lib/client-portal/queries";
import { formatCurrency } from "@/lib/format";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { buildInvoiceTotalsViewModel } from "@/lib/invoices/totals-view-model";
import { isQuoteConverted, isQuoteExpired } from "@/lib/quotes/status";
import { StatusBadge } from "@/components/ui/status-badge";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { PortalQuoteDecisionControls } from "@/components/client-portal/portal-quote-decision-controls";
import { deriveQuoteStatusDisplay } from "@/lib/quotes/status-display";

/**
 * Quotes / Estimates Phase 4 §E. Read-only, customer-facing: no
 * createdByUserId, no internal database ids beyond this Quote's own
 * (never rendered), no organizationId, no Lead relationship (a Portal
 * Client only ever sees the Quote as a Client-owned document — its own
 * possible Lead origin is Staff-only context, per §M/§F of Phase 3's own
 * task spec for the equivalent Staff read-only view), no Activity
 * metadata, no raw convertedInvoiceId value (only a re-validated,
 * safe "View invoice" link when eligible — see getPortalQuote's own doc
 * comment on `convertedInvoice`). notes is shown — Quote has no separate
 * internalNotes field, so its one `notes` column is this document's own
 * general, customer-facing notes (§E).
 */
export default async function PortalQuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { clientId, organizationId } = await getCurrentPortalUser();

  // §L/§M — scoped by id + clientId + organizationId + archivedAt +
  // visible-status together (inside getPortalQuote): a DRAFT Quote, an
  // archived Quote, a foreign Client's/org's Quote, and a Lead-only
  // (clientId null) Quote are all simply not found here, indistinguishably
  // from a nonexistent id.
  const quote = await getPortalQuote(clientId, organizationId, id);

  if (!quote) {
    notFound();
  }

  const { key: statusKey, label: statusLabel } = deriveQuoteStatusDisplay(quote);
  const converted = isQuoteConverted({ convertedInvoiceId: quote.convertedInvoiceId });
  const expired = isQuoteExpired({ status: quote.status, validUntil: quote.validUntil });
  // §H — Expired never allows Approve/Decline; §F/§G — only a still-live
  // SENT Quote does. converted is structurally impossible alongside
  // status === "SENT" (conversion only ever starts from APPROVED), kept
  // here only as an explicit, defensive third condition rather than an
  // assumption.
  const canDecide = quote.status === "SENT" && !expired && !converted;

  const totals = buildInvoiceTotalsViewModel({
    amount: quote.total,
    subtotal: quote.subtotal,
    discountType: quote.discountType,
    discountAmount: quote.discountAmount,
    discountValue: quote.discountValue,
    taxRatePercent: quote.taxRatePercent,
    taxAmount: quote.taxAmount,
    taxLabel: quote.taxLabel,
    currency: quote.currency,
  });

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/portal/quotes" className={ACTION_LINK_CLASSES}>
        ← Back to quotes
      </Link>

      <div className={`mt-4 space-y-6 p-6 ${CARD_SURFACE_CLASSES}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-text-primary text-xl font-semibold tracking-tight">{quote.number}</h1>
            {quote.title && <p className="text-text-secondary mt-1 text-sm">{quote.title}</p>}
          </div>
          <StatusBadge status={statusKey} label={statusLabel} />
        </div>

        {converted && quote.convertedInvoice && (
          <div className="border-success bg-success-subtle rounded-md border px-4 py-3 text-sm">
            <span className="text-success font-medium">Converted to invoice </span>
            <Link href={`/portal/invoices/${quote.convertedInvoice.id}`} className={ACTION_LINK_CLASSES}>
              {quote.convertedInvoice.invoiceNumber}
            </Link>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Currency</dt>
            <dd className="text-text-primary mt-1">{quote.currency}</dd>
          </div>
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Issue date</dt>
            <dd className="text-text-primary mt-1">{formatDateOnlyForDisplay(quote.issueDate)}</dd>
          </div>
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Valid until</dt>
            <dd className="text-text-primary mt-1">
              {quote.validUntil ? formatDateOnlyForDisplay(quote.validUntil) : "—"}
            </dd>
          </div>
        </dl>

        {quote.items.length > 0 && (
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
              {quote.items.map((item, index) => (
                <TableRow key={index}>
                  <TableCell emphasis>{item.description}</TableCell>
                  <TableCell align="right">{item.quantity}</TableCell>
                  <TableCell align="right">{formatCurrency(item.unitPrice, quote.currency)}</TableCell>
                  <TableCell align="right" emphasis>
                    {formatCurrency(item.lineTotal, quote.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

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

        {quote.notes && (
          <div>
            <h2 className="text-text-secondary text-sm font-medium">Notes</h2>
            <p className="text-text-secondary mt-1 text-sm whitespace-pre-wrap">{quote.notes}</p>
          </div>
        )}

        {canDecide && (
          <div className="border-border-default border-t pt-6">
            <PortalQuoteDecisionControls
              quoteId={quote.id}
              quoteNumber={quote.number}
              total={quote.total}
              currency={quote.currency}
            />
          </div>
        )}

        {quote.status === "APPROVED" && !converted && (
          <p className="text-text-muted text-sm">You approved this quote.</p>
        )}
        {quote.status === "DECLINED" && (
          <p className="text-text-muted text-sm">
            You declined this quote. The business may revise and resend it.
          </p>
        )}
        {expired && !converted && (
          <p className="text-text-muted text-sm">This quote is no longer open for a decision.</p>
        )}
      </div>
    </div>
  );
}
