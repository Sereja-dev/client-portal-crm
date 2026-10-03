import "server-only";
import { Prisma } from "@/generated/prisma/browser";
import type { InvoiceDiscountType, InvoiceTaxLabel } from "@/generated/prisma/browser";
import { formatInvoiceCurrencyAmount } from "@/lib/invoices/currencies";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { buildInvoiceTotalsViewModel, type InvoiceTotalsInput, type InvoiceTotalsViewModel } from "@/lib/invoices/totals-view-model";

/**
 * Quote PDF — current-state, on-demand view-model (schema-free slice; see
 * this feature's own Product Owner decision: NOT an immutable archived
 * snapshot, unlike Invoice's PDF). Mirrors
 * src/lib/invoices/pdf/view-model.ts's own "renderer-safe presentation
 * types, built once, document.tsx never accepts anything else" shape —
 * but deliberately does NOT reuse InvoicePdfViewModel/InvoicePdfBuildInput
 * themselves: those types are intrinsically snapshot-shaped
 * (InvoicePdfIssuerPresentation's own `payment` field and the whole
 * Storage-provenance-dropping mapping step only make sense for a
 * persisted InvoiceIssuerSnapshotV1/InvoiceRecipientSnapshotV1 — nothing
 * here is ever persisted). Reuses only the genuinely domain-neutral
 * primitives: formatInvoiceCurrencyAmount, formatDateOnlyForDisplay,
 * buildInvoiceTotalsViewModel — the exact same totals function
 * QuoteReadOnlyView itself already calls, so a Quote PDF's total can
 * never disagree with the Quote detail page's own total for the same
 * current state.
 *
 * Every value below is read directly from the Quote's own CURRENT
 * database row at request time (never a frozen snapshot) — a Quote
 * edited after a PDF was downloaded will produce a different PDF next
 * time, by design (see the route's own header comment).
 */

const PDF_LOCALE = "en-US";

type Decimal = InstanceType<typeof Prisma.Decimal>;
type MoneyValue = Decimal | string | number;

function formatMoney(value: MoneyValue, currency: string): string {
  return formatInvoiceCurrencyAmount(value, currency, PDF_LOCALE) ?? String(value);
}

export type QuotePdfAddress = {
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

/** No `payment` field — a Quote PDF never includes payment instructions (nothing has been invoiced yet); see this module's own header comment. */
export type QuotePdfIssuerPresentation = {
  legalName: string;
  address: QuotePdfAddress;
  country: string | null;
  taxId: string | null;
  supportEmail: string | null;
  phone: string | null;
  website: string | null;
  /** Already-validated logo bytes, inlined as a data URI — never a bucket/path/URL of any kind, matching Invoice PDF's own logo-embedding contract. */
  logoImage: { dataUri: string } | null;
};

/**
 * Deliberately minimal — a plain name/type/email, never a full billing
 * address. QuoteReadOnlyView itself never surfaces a recipient address
 * anywhere (only a name + Lead/Client badge) — this view-model invents no
 * field absent from the rest of the Quote domain's own existing
 * presentation.
 */
export type QuotePdfRecipientPresentation = {
  name: string;
  type: "LEAD" | "CLIENT";
  email: string | null;
};

export type QuotePdfLineItem = {
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
};

export type QuotePdfViewModel = {
  quoteNumber: string;
  /** A plain display label (e.g. "Sent", "Expired", "Converted") — always supplied by the caller via deriveQuoteStatusDisplay(), never re-derived here. */
  statusLabel: string;
  title: string | null;
  currency: string;
  issueDateDisplay: string;
  validUntilDisplay: string | null;
  issuer: QuotePdfIssuerPresentation;
  recipient: QuotePdfRecipientPresentation;
  lineItems: QuotePdfLineItem[];
  totals: InvoiceTotalsViewModel;
  notes: string | null;
};

export type QuotePdfBuildInput = {
  quoteNumber: string;
  statusLabel: string;
  title: string | null;
  currency: string;
  issueDate: Date;
  validUntil: Date | null;
  lineItems: { description: string; quantity: MoneyValue; unitPrice: MoneyValue; lineTotal: MoneyValue }[];
  subtotal: MoneyValue;
  discountType: InvoiceDiscountType;
  discountAmount: MoneyValue | null;
  discountValue: MoneyValue | null;
  taxRatePercent: MoneyValue | null;
  taxAmount: MoneyValue | null;
  taxLabel: InvoiceTaxLabel;
  total: MoneyValue;
  notes: string | null;
  issuer: QuotePdfIssuerPresentation;
  recipient: QuotePdfRecipientPresentation;
};

/**
 * Builds the renderer-safe view-model from the Quote's own current,
 * already-persisted scalar/line-item values — never recalculates a total
 * via calculateQuoteTotals() a second time (QuoteItem.lineTotal/
 * Quote.subtotal/discountAmount/taxAmount/total are already the
 * authoritative current-state numbers every create/update write already
 * maintains). This is the one and only place a Quote PDF's own display
 * strings are formatted.
 */
export function buildQuotePdfViewModel(input: QuotePdfBuildInput): QuotePdfViewModel {
  const { currency } = input;

  const lineItems: QuotePdfLineItem[] = input.lineItems.map((item) => ({
    description: item.description,
    quantity: String(item.quantity),
    unitPrice: formatMoney(item.unitPrice, currency),
    lineTotal: formatMoney(item.lineTotal, currency),
  }));

  const totalsInput: InvoiceTotalsInput = {
    amount: input.total,
    subtotal: input.subtotal,
    discountType: input.discountType,
    discountAmount: input.discountAmount,
    discountValue: input.discountValue,
    taxRatePercent: input.taxRatePercent,
    taxAmount: input.taxAmount,
    taxLabel: input.taxLabel,
    currency,
  };

  return {
    quoteNumber: input.quoteNumber,
    statusLabel: input.statusLabel,
    title: input.title,
    currency,
    issueDateDisplay: formatDateOnlyForDisplay(input.issueDate, PDF_LOCALE),
    validUntilDisplay: input.validUntil ? formatDateOnlyForDisplay(input.validUntil, PDF_LOCALE) : null,
    issuer: input.issuer,
    recipient: input.recipient,
    lineItems,
    totals: buildInvoiceTotalsViewModel(totalsInput),
    notes: input.notes,
  };
}
