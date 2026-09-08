import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { QuoteForm, type QuoteTargetOption } from "@/components/quotes/quote-form";
import { EmptyState } from "@/components/ui/empty-state";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { getCompanyProfile } from "@/lib/organization-setup/company-profile";
import { resolveInvoiceCurrencyDefault, getSupportedInvoiceCurrencies } from "@/lib/invoices/currencies";
import { formatDateOnly } from "@/lib/invoices/date-only";
import { suggestNextQuoteNumber } from "@/lib/quotes/suggest-next-quote-number";
import { createQuoteAction } from "../actions";

/** "Jane Doe — Acme Inc (jane@acme.com)" — degrades gracefully when company/email are absent. */
function formatLeadLabel(lead: { name: string; company: string | null; email: string | null }): string {
  let label = lead.name;
  if (lead.company) label += ` — ${lead.company}`;
  if (lead.email) label += ` (${lead.email})`;
  return label;
}

export default async function NewQuotePage() {
  const { organizationId } = await getCurrentUserOrganization();

  const [leads, clients, companyProfile, suggestedNumber] = await Promise.all([
    // Archived Leads excluded — matches resolveQuoteTarget's own server-
    // side eligibility rule exactly (src/lib/quotes/target.ts), so this
    // selector never offers an id the server would then reject.
    prisma.lead.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, company: true, email: true },
    }),
    // No status filter — matches every other Client selector in this app
    // (Invoice/Project's own "new" pages), the established "current app
    // semantics" for what counts as a selectable Client (§D).
    prisma.client.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getCompanyProfile(organizationId),
    suggestNextQuoteNumber(organizationId),
  ]);

  const currencyDefault = resolveInvoiceCurrencyDefault(companyProfile.currency);

  const leadOptions: QuoteTargetOption[] = leads.map((lead) => ({ id: lead.id, label: formatLeadLabel(lead) }));
  const clientOptions: QuoteTargetOption[] = clients.map((client) => ({ id: client.id, label: client.name }));

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Add quote</h1>
        <Link href="/quotes" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>

      {leads.length === 0 && clients.length === 0 ? (
        <EmptyState
          title="You need a lead or a client first"
          description="Quotes go to a lead or a client. Add one before creating a quote."
          action={
            <div className="flex justify-center gap-3">
              <Link
                href="/leads/new"
                className="focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              >
                Add lead
              </Link>
              <Link
                href="/clients/new"
                className="focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              >
                Add client
              </Link>
            </div>
          }
        />
      ) : (
        <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
          <QuoteForm
            action={createQuoteAction}
            leads={leadOptions}
            clients={clientOptions}
            currencyOptions={getSupportedInvoiceCurrencies()}
            currencyFallbackNotice={
              currencyDefault.isFallback && currencyDefault.organizationCurrency
                ? `Your organization's currency (${currencyDefault.organizationCurrency}) isn't supported for quotes — defaulted to USD.`
                : undefined
            }
            defaultValues={{
              number: suggestedNumber,
              currency: currencyDefault.currency,
              issueDate: formatDateOnly(new Date()),
              discountType: "NONE",
              taxLabel: "TAX",
            }}
            submitLabel="Create quote"
            pendingLabel="Creating…"
            successToast="Quote created"
          />
        </div>
      )}
    </div>
  );
}
