import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import type { QuotePreviewLineItem, QuotePreviewTotals } from "@/lib/quotes/quote-preview-view-model";

/**
 * Forms Improvement Slice B2 — Quote Live Preview's own smallest reusable
 * presentational component, mirroring InvoicePreview's own structure
 * (src/components/invoices/invoice-preview.tsx) but with Quote-correct
 * labels/concepts rather than Invoice ones: "Quote" not "Invoice", "For"
 * not "Bill to", "Valid until" not "Due date", no Project row (Quote has
 * none), no flat/itemized mode (a Quote is always itemized), no internal
 * notes (Quote's own schema has no such field). Deliberately NOT a reuse
 * of InvoicePreview itself — see this slice's own audit (§N): passing a
 * Quote number in as an "Invoice" label, or a Lead/Client name in as
 * "Bill to", would be real, visible semantic leakage, not a style nit.
 *
 * Pure rendering only, exactly like InvoicePreview: every prop here is
 * already a display-ready string or the renderer-agnostic totals
 * view-model produced by the caller via the existing canonical
 * calculation/view-model stack (`calculateQuoteTotals()` ->
 * `buildQuotePreviewTotals()`, itself a thin re-export of Invoice's own
 * `buildInvoicePreviewTotals()` — see that module's own header comment).
 * This component never reaches into Prisma, a Server Action, or any
 * calculation function itself.
 *
 * Semantic fidelity only — this does NOT aim to visually match the Quote
 * PDF pixel-for-pixel (src/lib/quotes/pdf/document.tsx's react-pdf
 * primitives are never imported here, and could not be: that module is
 * "server-only" and depends on @react-pdf/renderer, a Node-only PDF
 * engine). This is plain, ordinary browser DOM reusing the app's existing
 * Table/surface primitives, the same boundary InvoicePreview already
 * draws. The monetary values, currency, and line-item math are guaranteed
 * identical to the PDF/detail view because they all ultimately come from
 * the exact same `calculateInvoiceTotals()`/`buildInvoiceTotalsViewModel()`
 * pair every Quote renderer already shares.
 *
 * Every empty/partial state renders a truthful placeholder — never
 * throws, never fabricates a value. `aria-live="polite"` on the root,
 * mirroring InvoicePreview's own identical accessibility choice exactly
 * (one polite region, not a per-field live region).
 */
export function QuotePreview({
  quoteNumber,
  issuerDisplayName,
  title,
  targetTypeLabel,
  targetName,
  currency,
  issueDateDisplay,
  validUntilDisplay,
  lineItems,
  result,
  notes,
}: {
  quoteNumber: string;
  /** Organization.name / the company profile's own display name — never a logo, address, or any other issuer detail (out of this bounded scope, same as InvoicePreview's own issuerDisplayName). */
  issuerDisplayName: string;
  title: string | null;
  /** `null` before a target type (Lead/Client) has been chosen at all. */
  targetTypeLabel: "Lead" | "Client" | null;
  /** The selected Lead's or Client's plain name — never a richer address/email block (see this slice's own audit §J: Quote's current data model doesn't fetch that, and Invoice's own preview shows name only too). `null` while that type is chosen but no specific one is selected yet. */
  targetName: string | null;
  currency: string;
  /** Already formatted for display (e.g. "Aug 24, 2026"), or null when not yet set. */
  issueDateDisplay: string | null;
  validUntilDisplay: string | null;
  lineItems: QuotePreviewLineItem[];
  result: QuotePreviewTotals;
  notes: string | null;
}) {
  const targetPlaceholder =
    targetTypeLabel === "Lead" ? "No lead selected yet" : targetTypeLabel === "Client" ? "No client selected yet" : "No lead or client selected yet";

  return (
    <div aria-live="polite" data-testid="quote-preview" className={`${CARD_SURFACE_CLASSES} space-y-4 p-6 text-sm`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-text-muted text-xs font-medium uppercase tracking-wide">From</p>
          <p className="text-text-primary mt-0.5 font-medium">{issuerDisplayName || "Your company"}</p>
        </div>
        <div className="text-right">
          <p className="text-text-muted text-xs font-medium uppercase tracking-wide">Quote</p>
          <p className="text-text-primary mt-0.5 font-medium">{quoteNumber || "—"}</p>
        </div>
      </div>

      <div>
        <p className="text-text-muted text-xs font-medium uppercase tracking-wide">For</p>
        <p className="text-text-primary mt-0.5">{targetName ?? targetPlaceholder}</p>
        {targetName && targetTypeLabel && <p className="text-text-secondary text-xs">{targetTypeLabel}</p>}
        {title && <p className="text-text-secondary text-xs">{title}</p>}
      </div>

      <dl className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <dt className="text-text-muted">Currency</dt>
          <dd className="text-text-primary mt-0.5">{currency}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Issue date</dt>
          <dd className="text-text-primary mt-0.5">{issueDateDisplay ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Valid until</dt>
          <dd className="text-text-primary mt-0.5">{validUntilDisplay ?? "—"}</dd>
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
                <TableCell emphasis>{item.description || "—"}</TableCell>
                <TableCell align="right">{item.quantity}</TableCell>
                <TableCell align="right">{item.unitPrice}</TableCell>
                <TableCell align="right" emphasis>
                  {item.lineTotal}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-text-muted text-xs">No line items yet.</p>
      )}

      <div className="ml-auto max-w-xs space-y-1 text-sm">
        {result.ok ? (
          <>
            <div className="flex justify-between">
              <span className="text-text-muted">Subtotal</span>
              <span className="text-text-primary">{result.totals.displayedSubtotal}</span>
            </div>
            {result.totals.discountRow && (
              <div className="flex justify-between">
                <span className="text-text-muted">{result.totals.discountRow.label}</span>
                <span className="text-text-primary">-{result.totals.discountRow.amount}</span>
              </div>
            )}
            {result.totals.taxRow && (
              <div className="flex justify-between">
                <span className="text-text-muted">{result.totals.taxRow.label}</span>
                <span className="text-text-primary">{result.totals.taxRow.amount}</span>
              </div>
            )}
            <div className="border-border-default flex justify-between border-t pt-1 font-medium">
              <span className="text-text-primary">Total</span>
              <span data-testid="quote-preview-total" className="text-text-primary">
                {result.totals.total}
              </span>
            </div>
          </>
        ) : (
          <p className="text-text-muted">Add a valid amount or line item to see totals.</p>
        )}
      </div>

      {notes && (
        <div>
          <h3 className="text-text-secondary text-xs font-medium uppercase tracking-wide">Notes</h3>
          <p className="text-text-secondary mt-1 text-xs whitespace-pre-wrap">{notes}</p>
        </div>
      )}
    </div>
  );
}
