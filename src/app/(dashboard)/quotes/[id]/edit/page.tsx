import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { QuoteForm, type QuoteFormDefaults, type QuoteTargetOption } from "@/components/quotes/quote-form";
import { QuoteSendControl } from "@/components/quotes/quote-send-control";
import { QuoteReadOnlyView } from "@/components/quotes/quote-read-only-view";
import { QuoteLifecycleControls } from "@/components/quotes/quote-lifecycle-controls";
import { QuoteSentPanel } from "@/components/quotes/quote-sent-panel";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { UnsavedChangesScope } from "@/components/forms/unsaved-changes-scope";
import { UnsavedChangesCancelLink } from "@/components/forms/unsaved-changes-cancel-link";
import { getCompanyProfile } from "@/lib/organization-setup/company-profile";
import { getSupportedInvoiceCurrencies } from "@/lib/invoices/currencies";
import { formatDateOnly } from "@/lib/invoices/date-only";
import { isQuoteConverted, isQuoteExpired } from "@/lib/quotes/status";
import { updateQuoteAction } from "../../actions";

function formatLeadLabel(lead: { name: string; company: string | null; email: string | null }): string {
  let label = lead.name;
  if (lead.company) label += ` — ${lead.company}`;
  if (lead.email) label += ` (${lead.email})`;
  return label;
}

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId } = await getCurrentUserOrganization();

  // Scoped by organizationId alone — never a client/lead relation filter,
  // which could silently 404 a Quote whose lead or client relation is for
  // some other reason unreachable. Matches Invoice edit page's own
  // identical "the one shared fetch" precedent.
  const quote = await prisma.quote.findFirst({
    where: { id, organizationId },
    include: {
      items: { orderBy: { position: "asc" } },
      client: { select: { id: true, name: true } },
      lead: { select: { id: true, name: true } },
      convertedInvoice: { select: { id: true, invoiceNumber: true } },
    },
  });

  if (!quote) {
    notFound();
  }

  const converted = isQuoteConverted({ convertedInvoiceId: quote.convertedInvoiceId });
  const expired = isQuoteExpired({ status: quote.status, validUntil: quote.validUntil });

  // §F/§G — three real branches, not two:
  //  - DRAFT: always directly editable, no gate.
  //  - a still-live SENT (not expired, not converted): §G's own read-only
  //    view (showing the recipient snapshot) is the DEFAULT presentation;
  //    editing it is still allowed (§F), but only behind an explicit
  //    confirmation of the DRAFT-reset consequence — see QuoteSentPanel's
  //    own header comment for the full reasoning.
  //  - everything else (APPROVED, DECLINED, expired-SENT, or converted
  //    regardless of status): read-only only, no edit path at all outside
  //    Reopen (DECLINED/expired-SENT) or Convert (APPROVED).
  const isDraft = quote.status === "DRAFT";
  const isSentLive = !converted && quote.status === "SENT" && !expired;
  const needsFormOptions = isDraft || isSentLive;

  // Forms Improvement Slice B2 — companyProfile is fetched here, alongside
  // leads/clients, only when a form actually renders (isDraft/isSentLive)
  // — the read-only-only branch below never needed this data before and
  // still doesn't now, so it incurs no new query.
  const [leadOptions, clientOptions, companyDisplayName] = needsFormOptions
    ? await (async () => {
        const [leads, clients, companyProfile] = await Promise.all([
          prisma.lead.findMany({
            where: { organizationId, archivedAt: null },
            orderBy: { name: "asc" },
            select: { id: true, name: true, company: true, email: true },
          }),
          prisma.client.findMany({
            where: { organizationId },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
          }),
          getCompanyProfile(organizationId),
        ]);
        return [
          leads.map((lead): QuoteTargetOption => ({ id: lead.id, label: formatLeadLabel(lead), name: lead.name })),
          clients.map((client): QuoteTargetOption => ({ id: client.id, label: client.name, name: client.name })),
          companyProfile.displayName,
        ];
      })()
    : [[], [], undefined];

  const formDefaults: QuoteFormDefaults = {
    number: quote.number,
    title: quote.title ?? undefined,
    // Defaulting to "lead" whenever leadId is set (even though clientId
    // may also already be set) — never "client" in that case — is what
    // keeps an untouched save from silently dropping the Lead lineage;
    // see QuoteFormDefaults's own doc comment on `targetType`.
    targetType: quote.leadId ? "lead" : "client",
    leadId: quote.leadId ?? undefined,
    clientId: quote.clientId ?? undefined,
    issueDate: formatDateOnly(quote.issueDate),
    validUntil: quote.validUntil ? formatDateOnly(quote.validUntil) : undefined,
    currency: quote.currency,
    notes: quote.notes ?? undefined,
    discountType: quote.discountType,
    discountValue: quote.discountValue?.toString(),
    taxRatePercent: quote.taxRatePercent?.toString(),
    taxLabel: quote.taxLabel,
    items: quote.items.map((item) => ({
      description: item.description,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
    })),
  };

  const boundUpdateQuoteAction = updateQuoteAction.bind(null, quote.id);

  const readOnlyLineItems = quote.items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineTotal: item.lineTotal,
  }));

  if (isDraft) {
    return (
      // Forms Improvement Slice B2 — widened from max-w-2xl to max-w-5xl
      // to fit QuoteForm's own new two-column form+live-preview layout,
      // mirroring Invoice's identical edit/page.tsx precedent exactly.
      // Forms Improvement Slice C1a — wraps the same region in a
      // dirty-tracking boundary; see Invoice's own new/page.tsx header
      // comment for why this is purely structural.
      <UnsavedChangesScope>
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Edit quote</h1>
            <UnsavedChangesCancelLink href="/quotes" className={ACTION_LINK_CLASSES}>
              Back
            </UnsavedChangesCancelLink>
          </div>
          <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
            <QuoteForm
              action={boundUpdateQuoteAction}
              leads={leadOptions}
              clients={clientOptions}
              currencyOptions={getSupportedInvoiceCurrencies()}
              defaultValues={formDefaults}
              companyDisplayName={companyDisplayName}
              submitLabel="Save changes"
              pendingLabel="Saving…"
              successToast="Quote updated"
            />
            <QuoteSendControl quoteId={quote.id} />
            {/* §J — Archive/unarchive is available at any status, DRAFT
                included; canReopen/canConvert both stay false here (a DRAFT
                can never do either), so this renders only the Archive
                control, never a stray Reopen/Convert one. */}
            <div className="border-border-default mt-6 border-t pt-6">
              <QuoteLifecycleControls
                quoteId={quote.id}
                status={quote.status}
                validUntil={quote.validUntil}
                convertedInvoiceId={quote.convertedInvoiceId}
                archivedAt={quote.archivedAt}
                clientId={null}
                projects={[]}
              />
            </div>
          </div>
        </div>
      </UnsavedChangesScope>
    );
  }

  if (isSentLive) {
    return (
      // Forms Improvement Slice B2 — widened to max-w-5xl for the same
      // reason as the DRAFT branch above: this one server-rendered
      // wrapper serves both QuoteSentPanel's own pre-confirmation
      // read-only presentation AND the live-preview QuoteForm it reveals
      // once "Edit quote" is confirmed, and the two share a single
      // wrapper div — there is no client-side-only width to apply
      // narrower while read-only without inventing a new layout
      // mechanism, which this slice's own scope excludes.
      // Forms Improvement Slice C1a — same reasoning applies to this
      // Scope: it's harmless while QuoteSentPanel shows its own
      // read-only presentation (no QuoteForm mounted, isDirty never
      // becomes true), and is exactly what QuoteForm needs once "Edit
      // quote" is confirmed and it mounts.
      <UnsavedChangesScope>
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Quote</h1>
            <UnsavedChangesCancelLink href="/quotes" className={ACTION_LINK_CLASSES}>
              Back
            </UnsavedChangesCancelLink>
          </div>
          <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
            <QuoteSentPanel
              quoteId={quote.id}
              archivedAt={quote.archivedAt}
              companyDisplayName={companyDisplayName}
              readOnly={{
                number: quote.number,
                validUntil: quote.validUntil,
                convertedInvoiceId: quote.convertedInvoiceId,
                target: { leadId: quote.leadId, clientId: quote.clientId, lead: quote.lead, client: quote.client },
                title: quote.title,
                issueDate: quote.issueDate,
                recipientName: quote.recipientName,
                recipientEmail: quote.recipientEmail,
                lineItems: readOnlyLineItems,
                currency: quote.currency,
                subtotal: quote.subtotal.toString(),
                discountType: quote.discountType,
                discountAmount: quote.discountAmount?.toString() ?? null,
                discountValue: quote.discountValue?.toString() ?? null,
                taxRatePercent: quote.taxRatePercent?.toString() ?? null,
                taxAmount: quote.taxAmount?.toString() ?? null,
                taxLabel: quote.taxLabel,
                total: quote.total.toString(),
                notes: quote.notes,
              }}
              formAction={boundUpdateQuoteAction}
              formDefaults={formDefaults}
              leads={leadOptions}
              clients={clientOptions}
              currencyOptions={getSupportedInvoiceCurrencies()}
            />
          </div>
        </div>
      </UnsavedChangesScope>
    );
  }

  // Read-only-only branch — Convert to Invoice needs this Quote's own
  // Client's Projects, but only when Convert could actually be offered at
  // all (§L); every other branch never runs this extra query.
  const canConvert = !converted && quote.status === "APPROVED" && quote.clientId !== null;
  const projects = canConvert
    ? await prisma.project.findMany({
        where: { organizationId, clientId: quote.clientId as string },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Quote</h1>
        <Link href="/quotes" className={ACTION_LINK_CLASSES}>
          Back
        </Link>
      </div>
      <div className={`space-y-6 p-6 ${CARD_SURFACE_CLASSES}`}>
        <QuoteReadOnlyView
          number={quote.number}
          status={quote.status}
          validUntil={quote.validUntil}
          convertedInvoiceId={quote.convertedInvoiceId}
          target={{ leadId: quote.leadId, clientId: quote.clientId, lead: quote.lead, client: quote.client }}
          title={quote.title}
          issueDate={quote.issueDate}
          recipientName={quote.recipientName}
          recipientEmail={quote.recipientEmail}
          lineItems={readOnlyLineItems}
          currency={quote.currency}
          subtotal={quote.subtotal.toString()}
          discountType={quote.discountType}
          discountAmount={quote.discountAmount?.toString() ?? null}
          discountValue={quote.discountValue?.toString() ?? null}
          taxRatePercent={quote.taxRatePercent?.toString() ?? null}
          taxAmount={quote.taxAmount?.toString() ?? null}
          taxLabel={quote.taxLabel}
          total={quote.total.toString()}
          notes={quote.notes}
          convertedInvoice={quote.convertedInvoice}
        />
        <QuoteLifecycleControls
          quoteId={quote.id}
          status={quote.status}
          validUntil={quote.validUntil}
          convertedInvoiceId={quote.convertedInvoiceId}
          archivedAt={quote.archivedAt}
          clientId={canConvert ? quote.clientId : null}
          projects={projects}
        />
      </div>
    </div>
  );
}
