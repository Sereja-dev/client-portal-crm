import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { QuoteForm, type QuoteTargetOption } from "@/components/quotes/quote-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { UnsavedChangesScope } from "@/components/forms/unsaved-changes-scope";
import { UnsavedChangesCancelLink } from "@/components/forms/unsaved-changes-cancel-link";
import { getCompanyProfile } from "@/lib/organization-setup/company-profile";
import { getSupportedInvoiceCurrencies } from "@/lib/invoices/currencies";
import { getDuplicateSourceQuote } from "@/lib/quotes/duplicate-source";
import { buildDuplicateQuoteDefaults, type DuplicateSourceQuoteData } from "@/lib/quotes/duplicate";
import { suggestNextQuoteNumber } from "@/lib/quotes/suggest-next-quote-number";
import { createQuoteAction } from "../../actions";

/** "Jane Doe — Acme Inc (jane@acme.com)" — degrades gracefully when company/email are absent. Byte-identical to new/page.tsx's own copy (same established convention per-page, not shared, matching this codebase's own duplicate-helper precedent). */
function formatLeadLabel(lead: { name: string; company: string | null; email: string | null }): string {
  let label = lead.name;
  if (lead.company) label += ` — ${lead.company}`;
  if (lead.email) label += ` (${lead.email})`;
  return label;
}

/**
 * Quote Duplicate-as-new-DRAFT. Opening this page performs zero writes —
 * it only ever reads the organization-scoped source Quote (at ANY status;
 * see duplicate-source.ts's own header comment for why there is no
 * CANCELLED-style restriction here, unlike Invoice's) and the org's own
 * Lead/Client lists and next-number suggestion, exactly the same reads
 * `/quotes/new` already performs. The only write happens later, when the
 * user explicitly submits through the ordinary, completely unmodified
 * `createQuoteAction` — this page never adds a `sourceQuoteId` or any
 * other source-identity field to the form, so the created Quote is, and
 * always was, an ordinary new Quote; the source is only a page-load
 * prefill snapshot.
 */
export default async function DuplicateQuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await getCurrentUserOrganization();

  const source = await getDuplicateSourceQuote(id, organizationId);
  if (!source) {
    notFound();
  }

  const sourceData: DuplicateSourceQuoteData = {
    leadId: source.leadId,
    clientId: source.clientId,
    title: source.title,
    currency: source.currency,
    notes: source.notes,
    discountType: source.discountType,
    discountValue: source.discountValue?.toString() ?? null,
    taxRatePercent: source.taxRatePercent?.toString() ?? null,
    taxLabel: source.taxLabel,
    items: source.items.map((item) => ({
      description: item.description,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
    })),
  };

  const [leads, clients, suggestedNumber, companyProfile] = await Promise.all([
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
    suggestNextQuoteNumber(organizationId),
    getCompanyProfile(organizationId),
  ]);

  const leadOptions: QuoteTargetOption[] = leads.map((lead) => ({ id: lead.id, label: formatLeadLabel(lead), name: lead.name }));
  const clientOptions: QuoteTargetOption[] = clients.map((client) => ({ id: client.id, label: client.name, name: client.name }));

  // Captured exactly once, then injected — the pure mapper below never
  // calls `new Date()` internally (matches Invoice's own duplicate page
  // precedent exactly).
  const today = new Date();
  const defaults = buildDuplicateQuoteDefaults(sourceData, suggestedNumber, today);

  return (
    // Forms Improvement Slice B2 — widened from max-w-2xl to max-w-5xl to
    // fit QuoteForm's own new two-column form+live-preview layout.
    // Forms Improvement Slice C1a — the duplicate-prefilled state is
    // QuoteForm's own mount-time baseline; the duplicate form starts
    // CLEAN, never compared against the source Quote.
    <UnsavedChangesScope>
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Duplicate quote</h1>
        <UnsavedChangesCancelLink href="/quotes" className={ACTION_LINK_CLASSES}>
          Cancel
        </UnsavedChangesCancelLink>
      </div>
      <p className="text-text-secondary -mt-4 mb-6 text-sm">
        Creates a new draft pre-filled from quote {source.number}. Review and confirm the quote number before
        saving.{" "}
        <Link href={`/quotes/${source.id}/edit`} className="text-text-primary font-medium hover:underline">
          View original quote
        </Link>
        .
      </p>

      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <QuoteForm
          action={createQuoteAction}
          leads={leadOptions}
          clients={clientOptions}
          currencyOptions={getSupportedInvoiceCurrencies()}
          defaultValues={defaults}
          companyDisplayName={companyProfile.displayName}
          submitLabel="Create duplicate"
          pendingLabel="Creating…"
          successToast="Quote created"
        />
      </div>
    </div>
    </UnsavedChangesScope>
  );
}
