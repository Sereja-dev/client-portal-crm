import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { QuoteStatusBadge, type QuoteStatusInput } from "@/components/quotes/quote-status-badge";
import { buildInvoiceTotalsViewModel } from "@/lib/invoices/totals-view-model";
import { formatInvoiceCurrencyAmount } from "@/lib/invoices/currencies";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { deriveQuoteTargetDisplay, type QuoteTargetDisplayInput } from "@/lib/quotes/target-display";

type MoneyValue = Prisma.Decimal | string | number;

export type QuoteReadOnlyLineItem = { description: string; quantity: MoneyValue; unitPrice: MoneyValue; lineTotal: MoneyValue };

/**
 * Quotes / Estimates Phase 3 (Staff UI) §G — the read-only presentation
 * for a Quote that is not currently DRAFT-editable (SENT/APPROVED/
 * DECLINED/expired-SENT, or converted). Renders the target using
 * deriveQuoteTargetDisplay (§M/§N's shared helper) and, per §G's own
 * instruction, ALWAYS shows the original Lead when leadId is set —
 * regardless of whether the current target is already a reconciled
 * Client — never silently dropping that lineage the way a compact list
 * row reasonably can.
 */
export function QuoteReadOnlyView({
  number,
  status,
  validUntil,
  convertedInvoiceId,
  target,
  title,
  issueDate,
  recipientName,
  recipientEmail,
  lineItems,
  currency,
  subtotal,
  discountType,
  discountAmount,
  discountValue,
  taxRatePercent,
  taxAmount,
  taxLabel,
  total,
  notes,
  convertedInvoice,
}: {
  number: string;
  status: QuoteStatusInput["status"];
  validUntil: Date | null;
  convertedInvoiceId: string | null;
  target: QuoteTargetDisplayInput;
  title: string | null;
  issueDate: Date;
  recipientName: string | null;
  recipientEmail: string | null;
  lineItems: QuoteReadOnlyLineItem[];
  currency: string;
  subtotal: string;
  discountType: string;
  discountAmount: string | null;
  discountValue: string | null;
  taxRatePercent: string | null;
  taxAmount: string | null;
  taxLabel: string;
  total: string;
  notes: string | null;
  convertedInvoice: { id: string; invoiceNumber: string } | null;
}) {
  const format = (value: MoneyValue) => formatInvoiceCurrencyAmount(value, currency) ?? String(value);
  const targetDisplay = deriveQuoteTargetDisplay(target);
  const totals = buildInvoiceTotalsViewModel({
    amount: total,
    subtotal,
    discountType,
    discountAmount,
    discountValue,
    taxRatePercent,
    taxAmount,
    taxLabel,
    currency,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-text-primary text-lg font-semibold">{number}</h2>
          <p className="text-text-secondary mt-1 text-sm">
            <Link href={targetDisplay.href} className={ACTION_LINK_CLASSES}>
              {targetDisplay.name}
            </Link>
            <span className="text-text-muted ml-2 text-xs">{targetDisplay.type === "LEAD" ? "Lead" : "Client"}</span>
            {title && <span> — {title}</span>}
          </p>
          {/* §G — never pretend the Lead relation disappeared: shown
              whenever leadId is set, even though the current target above
              is already the reconciled Client. */}
          {targetDisplay.type === "CLIENT" && targetDisplay.originLead && (
            <p className="text-text-muted mt-1 text-xs">
              Originally from lead{" "}
              <Link href={targetDisplay.originLead.href} className={ACTION_LINK_CLASSES}>
                {targetDisplay.originLead.name}
              </Link>
              .
            </p>
          )}
        </div>
        <QuoteStatusBadge quote={{ status, validUntil, convertedInvoiceId }} />
      </div>

      {convertedInvoice && (
        <div className="border-success bg-success-subtle rounded-md border px-4 py-3 text-sm">
          <span className="text-success font-medium">Converted to invoice </span>
          <Link href={`/invoices/${convertedInvoice.id}/edit`} className={ACTION_LINK_CLASSES}>
            {convertedInvoice.invoiceNumber}
          </Link>
        </div>
      )}

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
          <dt className="text-text-muted">Valid until</dt>
          <dd className="text-text-primary mt-0.5">{validUntil ? formatDateOnlyForDisplay(validUntil) : "—"}</dd>
        </div>
        {(recipientName || recipientEmail) && (
          <div>
            <dt className="text-text-muted">Sent to</dt>
            <dd className="text-text-primary mt-0.5">
              {recipientName ?? "—"}
              {recipientEmail && <span className="text-text-muted block text-xs">{recipientEmail}</span>}
            </dd>
          </div>
        )}
      </dl>

      {lineItems.length > 0 && (
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

      {notes && (
        <div>
          <h3 className="text-text-secondary text-sm font-medium">Notes</h3>
          <p className="text-text-secondary mt-1 text-sm whitespace-pre-wrap">{notes}</p>
        </div>
      )}
    </div>
  );
}
