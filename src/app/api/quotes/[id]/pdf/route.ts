import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { checkRateLimit, QUOTE_PDF_DOWNLOAD_LIMIT } from "@/lib/rate-limit";
import { getCompanyProfile } from "@/lib/organization-setup/company-profile";
import { resolveInvoiceLogo } from "@/lib/invoices/pdf/logo";
import { validatePdfBuffer } from "@/lib/invoices/pdf/buffer-validation";
import { deriveQuoteStatusDisplay } from "@/lib/quotes/status-display";
import { buildQuotePdfViewModel, type QuotePdfIssuerPresentation, type QuotePdfRecipientPresentation } from "@/lib/quotes/pdf/view-model";
import { renderQuotePdfBuffer } from "@/lib/quotes/pdf/document";
import { buildQuotePdfDownloadFilename } from "@/lib/quotes/pdf/filename";

const NOT_FOUND_MESSAGE = "Not found";
const RENDER_FAILURE_MESSAGE = "Unable to generate this PDF.";

/**
 * Quote PDF — current-state, ON-DEMAND download (schema-free slice; see
 * this feature's own Product Owner decision). Deliberately NOT structured
 * like src/app/api/invoices/[id]/pdf/route.ts's own archived-snapshot
 * flow (scoped read -> classifyInvoiceArchival() -> ledger-consistency
 * proof -> 307 redirect to a short-lived signed URL): there is no Quote
 * archive, no ledger, and no Storage object to redirect to. Instead this
 * route renders a real PDF buffer fresh, from the Quote's own current
 * database state, on every single request, and streams the bytes back
 * directly. A Quote edited after a PDF was downloaded will produce a
 * different PDF next time — intentional, not a bug.
 *
 * Permissions mirror the rest of the Quote domain exactly (see the
 * Finance Document Actions audit's own §I finding): any authenticated
 * org member may download — no OWNER-only gate, unlike Invoice's own
 * Issue/Send/Legacy-Archive actions. No payment instructions are ever
 * rendered into a Quote PDF (see view-model.ts's own header comment) —
 * this keeps this route's own data reads entirely inside the "any member"
 * authorization tier (getCompanyProfile() is itself never role-gated;
 * getPaymentDetails() is deliberately never called here).
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/quotes/[id]/pdf">,
) {
  const { id } = await ctx.params;

  // 1. getCurrentUserOrganization() only ever resolves an organizationId
  // backed by an existing Membership for the current user — a foreign
  // org's quote id simply won't match the scoped lookup below,
  // indistinguishable from a nonexistent one. No role gate: every staff
  // Membership role may download, matching every other Quote action.
  const { user, organizationId } = await getCurrentUserOrganization();

  // 2. Dedicated rate limiter, isolated from INVOICE_PDF_DOWNLOAD_LIMIT,
  // checked before any Quote-domain query.
  const limitCheck = checkRateLimit(QUOTE_PDF_DOWNLOAD_LIMIT, user.id);
  if (limitCheck.limited) {
    return new NextResponse(limitCheck.message, { status: 429 });
  }

  // 3. Organization-scoped fetch — Quote.organizationId alone. Every
  // status/archivedAt/convertedInvoiceId value is eligible (§14 of this
  // slice's own spec: archive state does not prohibit PDF generation if
  // the Quote detail itself is accessible) — this route performs no
  // lifecycle classification of any kind, unlike Invoice's own
  // classifyInvoiceArchival() gate, because there is no archive state to
  // classify here.
  const quote = await prisma.quote.findFirst({
    where: { id, organizationId },
    include: {
      items: { orderBy: { position: "asc" } },
      client: { select: { name: true, email: true } },
      lead: { select: { name: true, email: true } },
    },
  });

  if (!quote) {
    return new NextResponse(NOT_FOUND_MESSAGE, { status: 404 });
  }

  // 4. Issuer identity — current OrganizationProfile/Organization data
  // (never a frozen snapshot; see this route's own header comment), same
  // fallback rule buildIssuerSnapshotV1() already establishes
  // (profile.legalName ?? organization.name) but built directly into the
  // plain QuotePdfIssuerPresentation shape, with no snapshot/provenance
  // wrapper — nothing here is ever persisted. No payment instructions.
  const [profile, organization] = await Promise.all([
    getCompanyProfile(organizationId),
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } }),
  ]);

  let logoImage: QuotePdfIssuerPresentation["logoImage"] = null;
  try {
    const resolvedLogo = await resolveInvoiceLogo({ organizationId, logoUrl: profile.logoUrl });
    if (resolvedLogo.bytes) {
      logoImage = { dataUri: `data:${resolvedLogo.bytes.contentType};base64,${resolvedLogo.bytes.data.toString("base64")}` };
    }
  } catch {
    // Never fails the whole PDF over a logo-fetch problem — the same
    // "degrade to no logo" tolerance issue-invoice.ts's own render-retry
    // path already establishes, just without a retry (there is nothing
    // to retry: a missing logo here just means no <Image> is rendered).
    logoImage = null;
  }

  const issuer: QuotePdfIssuerPresentation = {
    legalName: profile.legalName ?? organization.name,
    address: {
      streetAddress: profile.streetAddress,
      city: profile.city,
      state: profile.state,
      postalCode: profile.postalCode,
    },
    country: profile.country,
    taxId: profile.taxId,
    supportEmail: profile.supportEmail,
    phone: profile.phone,
    website: profile.website,
    logoImage,
  };

  // 5. Recipient — deliberately minimal (name/type/email only), matching
  // QuoteReadOnlyView's own existing presentation exactly (see
  // view-model.ts's own header comment: no field is invented beyond what
  // the rest of the Quote domain already surfaces). Quote's own durable
  // invariant (clientId set means the CURRENT target, even when leadId is
  // also set) is the same precedence deriveQuoteTargetDisplay() already
  // encodes.
  const recipient: QuotePdfRecipientPresentation = quote.clientId
    ? { name: quote.client?.name ?? "—", type: "CLIENT", email: quote.client?.email ?? null }
    : { name: quote.lead?.name ?? "—", type: "LEAD", email: quote.lead?.email ?? null };

  const statusLabel = deriveQuoteStatusDisplay({
    status: quote.status,
    validUntil: quote.validUntil,
    convertedInvoiceId: quote.convertedInvoiceId,
  }).label;

  const viewModel = buildQuotePdfViewModel({
    quoteNumber: quote.number,
    statusLabel,
    title: quote.title,
    currency: quote.currency,
    issueDate: quote.issueDate,
    validUntil: quote.validUntil,
    lineItems: quote.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    subtotal: quote.subtotal,
    discountType: quote.discountType,
    discountAmount: quote.discountAmount,
    discountValue: quote.discountValue,
    taxRatePercent: quote.taxRatePercent,
    taxAmount: quote.taxAmount,
    taxLabel: quote.taxLabel,
    total: quote.total,
    notes: quote.notes,
    issuer,
    recipient,
  });

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderQuotePdfBuffer(viewModel);
  } catch {
    return new NextResponse(RENDER_FAILURE_MESSAGE, { status: 502 });
  }

  const validation = validatePdfBuffer(pdfBuffer);
  if (!validation.ok) {
    return new NextResponse(RENDER_FAILURE_MESSAGE, { status: 502 });
  }

  const filename = buildQuotePdfDownloadFilename(quote.number);

  // 6. Bytes streamed directly — never a redirect, never a signed URL:
  // there is no Storage object backing this response (see this route's
  // own header comment). Cache-Control matches the staff Invoice PDF
  // route's own choice: never cached, this is a live render of current
  // state.
  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdfBuffer.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
