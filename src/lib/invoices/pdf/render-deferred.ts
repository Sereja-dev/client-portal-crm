import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { InvoiceDiscountType, InvoiceTaxLabel } from "@/generated/prisma/enums";
import { calculateInvoiceTotals, type InvoiceCalculationInput } from "@/lib/invoices/calculations";
import { parseIssuerSnapshot, parseRecipientSnapshot } from "./snapshot-types";
import { buildInvoicePdfViewModel, toRendererIssuerPresentation, toRendererRecipientPresentation } from "./view-model";
import { renderInvoicePdfBuffer } from "./document";
import { validatePdfBuffer } from "./buffer-validation";

/**
 * Aqenra Free plan — invoice-PDF storage resolution. An invoice whose
 * classifyInvoiceArchival() kind is "archive_deferred" (see that module's
 * own doc comment) was issued successfully, but its PDF was never written
 * to Storage because the organization's storage allowance was exhausted
 * at the moment of issuance — see issue-invoice.ts's own "no reservation,
 * no archival, issue anyway" branch. This module is what makes such an
 * invoice's PDF still genuinely accessible: it renders a fresh PDF buffer,
 * on demand, directly from the invoice's own frozen issuerSnapshot/
 * recipientSnapshot and already-persisted totals — the exact same
 * durable, immutable record a normal archived invoice's PDF was itself
 * rendered from at issuance time (see issued-snapshot-immutable-after-
 * profile-payment-change.test.ts for the proof that this data never
 * drifts with later Company Profile/Payment Details edits).
 *
 * Deliberately NEVER embeds a logo, even when the frozen snapshot records
 * one as `included: true`. The snapshot's own logo provenance only ever
 * stores a content hash and the ORIGINAL Storage path it was fetched
 * from at issuance — not the bytes themselves — and that original path
 * is not guaranteed to still resolve to the same image: an organization
 * logo replacement explicitly deletes the previous Storage object (see
 * uploadOrganizationLogo's own doc comment in logo-mutations.ts). Unlike
 * an already-archived invoice's PDF (a complete, already-rendered object
 * that never needs to re-fetch anything), re-deriving this one on demand
 * would otherwise risk either silently embedding a DIFFERENT (newer)
 * logo than the one actually present at issuance, or failing outright
 * once the original is gone — both worse than the one, predictable,
 * clearly-scoped simplification made here: every on-demand render is
 * text-only, with the exact same financial data, numbers, and text the
 * real archived PDF would have had, just never a logo image. This is a
 * deliberate, safe design choice, not a limitation discovered by accident.
 */

export type DeferredInvoicePdfFields = {
  status: "SENT" | "PAID" | "OVERDUE" | "CANCELLED";
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date | null;
  currency: string;
  amount: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  discountType: InvoiceDiscountType;
  discountValue: Prisma.Decimal | null;
  taxRatePercent: Prisma.Decimal | null;
  taxLabel: InvoiceTaxLabel;
  notes: string | null;
  issuerSnapshot: unknown;
  recipientSnapshot: unknown;
  lineItems: readonly { description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal }[];
};

export type RenderDeferredInvoicePdfResult = { ok: true; buffer: Buffer } | { ok: false };

export async function renderDeferredInvoicePdf(
  invoice: DeferredInvoicePdfFields,
): Promise<RenderDeferredInvoicePdfResult> {
  const calculationInput: InvoiceCalculationInput = {
    subtotalSource:
      invoice.lineItems.length > 0
        ? {
            mode: "lineItems",
            lineItems: invoice.lineItems.map((li) => ({
              description: li.description,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
            })),
          }
        : { mode: "flat", amount: invoice.subtotal },
    discount:
      invoice.discountType === "NONE"
        ? { type: "NONE" }
        : { type: invoice.discountType, value: invoice.discountValue ?? "0" },
    taxRatePercent: invoice.taxRatePercent,
  };

  const calculation = calculateInvoiceTotals(calculationInput);
  if (!calculation.ok) return { ok: false };

  // Financial-consistency gate — same discipline archiveLegacyInvoice()
  // already applies before ever rendering a PDF for historical data this
  // module did not itself just compute: a fresh recalculation from the
  // invoice's own current (post-issuance, never-editable) line items must
  // exactly equal its own persisted, frozen totals. For a normally issued
  // invoice this can only ever pass — line items are never editable once
  // SENT — but this never assumes that silently; it fails closed, rather
  // than rendering a PDF that disagrees with the invoice's own
  // authoritative financial record, if it somehow does not.
  if (
    !calculation.total.equals(invoice.amount) ||
    !calculation.subtotal.equals(invoice.subtotal) ||
    !calculation.discountAmount.equals(invoice.discountAmount) ||
    !calculation.taxAmount.equals(invoice.taxAmount)
  ) {
    return { ok: false };
  }

  const issuer = parseIssuerSnapshot(invoice.issuerSnapshot);
  const recipient = parseRecipientSnapshot(invoice.recipientSnapshot);
  if (!issuer.ok || !recipient.ok) return { ok: false };

  // The frozen snapshot's own logo provenance is deliberately overridden
  // for rendering purposes only — never persisted, never mutates the
  // stored snapshot — see this module's own header comment for why.
  const issuerForRender = { ...issuer.snapshot, logo: { included: false as const, reason: "fetch_failed" as const } };
  const rendererIssuer = toRendererIssuerPresentation(issuerForRender, null);
  if (!rendererIssuer.ok) return { ok: false };
  const rendererRecipient = toRendererRecipientPresentation(recipient.snapshot);

  const viewModel = buildInvoicePdfViewModel({
    documentStatus: invoice.status,
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    currency: invoice.currency,
    calculation,
    discountType: invoice.discountType,
    discountValue: invoice.discountValue,
    taxRatePercent: invoice.taxRatePercent,
    taxLabel: invoice.taxLabel,
    notes: invoice.notes,
    issuer: rendererIssuer.presentation,
    recipient: rendererRecipient,
  });

  let buffer: Buffer;
  try {
    buffer = await renderInvoicePdfBuffer(viewModel);
  } catch {
    return { ok: false };
  }

  const validation = validatePdfBuffer(buffer);
  if (!validation.ok) return { ok: false };

  return { ok: true, buffer };
}
