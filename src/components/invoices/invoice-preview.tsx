import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import type { InvoicePreviewLineItem, InvoicePreviewTotals } from "@/lib/invoices/invoice-preview-view-model";

/**
 * Invoice Live Preview V1 — the smallest reusable presentational
 * component for the Invoice form's new document-style live preview. Pure
 * rendering only: every prop here is already a display-ready string
 * (formatted currency, formatted date, or a label) produced by the
 * caller via the existing canonical calculation/view-model stack
 * (`calculateInvoiceTotals()` -> `buildInvoiceTotalsViewModel()`, see
 * `invoice-preview-view-model.ts`). This component never reaches into
 * Prisma, a Server Action, or `calculateInvoiceTotals()` itself — it only
 * renders the typed view-model it's handed, mirroring the same
 * "renderer receives a finished presentation, never raw domain data"
 * boundary `invoice-read-only-view.tsx` and the PDF renderer both already
 * follow.
 *
 * Semantic fidelity only — this does NOT aim to visually match the PDF
 * pixel-for-pixel (react-pdf's own `document.tsx` primitives are never
 * imported here; this is plain, ordinary browser DOM reusing the app's
 * existing Table/surface primitives). The monetary values, currency, and
 * line-item math are guaranteed identical to the PDF/detail view because
 * they all come from the exact same `buildInvoiceTotalsViewModel()` call.
 *
 * Every empty/partial state renders a truthful placeholder — never
 * throws, never fabricates a value. `aria-live="polite"` on the root so
 * assistive tech hears the total update as the user edits, the same
 * accessibility property the form's own existing inline total preview
 * already has (unchanged, elsewhere in InvoiceForm).
 */
export function InvoicePreview({
  invoiceNumber,
  issuerDisplayName,
  clientName,
  projectName,
  currency,
  issueDateDisplay,
  dueDateDisplay,
  mode,
  lineItems,
  flatServiceLabel,
  result,
  notes,
}: {
  invoiceNumber: string;
  /** Organization.name / the company profile's display name — never a logo, address, or any other issuer detail (out of this bounded scope). */
  issuerDisplayName: string;
  clientName: string | null;
  projectName: string | null;
  currency: string;
  /** Already formatted for display (e.g. "Aug 24, 2026"), or null when not yet set. */
  issueDateDisplay: string | null;
  dueDateDisplay: string | null;
  mode: "flat" | "itemized";
  /** Itemized mode only — already-formatted strings from buildInvoicePreviewTotals(), never recomputed here. */
  lineItems: InvoicePreviewLineItem[];
  /** Flat mode only — the single synthetic row's formatted amount, or null while the amount isn't a valid number yet. */
  flatServiceLabel: string | null;
  result: InvoicePreviewTotals;
  notes: string | null;
}) {
  return (
    <div aria-live="polite" data-testid="invoice-preview" className={`${CARD_SURFACE_CLASSES} space-y-4 p-6 text-sm`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-text-muted text-xs font-medium uppercase tracking-wide">From</p>
          <p className="text-text-primary mt-0.5 font-medium">{issuerDisplayName || "Your company"}</p>
        </div>
        <div className="text-right">
          <p className="text-text-muted text-xs font-medium uppercase tracking-wide">Invoice</p>
          <p className="text-text-primary mt-0.5 font-medium">{invoiceNumber || "—"}</p>
        </div>
      </div>

      <div>
        <p className="text-text-muted text-xs font-medium uppercase tracking-wide">Bill to</p>
        <p className="text-text-primary mt-0.5">{clientName ?? "No client selected yet"}</p>
        {projectName && <p className="text-text-secondary text-xs">{projectName}</p>}
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
          <dt className="text-text-muted">Due date</dt>
          <dd className="text-text-primary mt-0.5">{dueDateDisplay ?? "—"}</dd>
        </div>
      </dl>

      {mode === "itemized" ? (
        lineItems.length > 0 ? (
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
        )
      ) : (
        <div className="border-border-default flex justify-between border-t pt-3 text-sm">
          <span className="text-text-secondary">Services</span>
          <span className="text-text-primary">{flatServiceLabel ?? "—"}</span>
        </div>
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
              <span data-testid="invoice-preview-total" className="text-text-primary">
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
