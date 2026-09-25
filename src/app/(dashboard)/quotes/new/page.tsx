import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { QuoteForm, type QuoteTargetOption, type QuoteFormDefaults } from "@/components/quotes/quote-form";
import { QuoteTemplatePicker } from "@/components/quotes/quote-template-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { getCompanyProfile } from "@/lib/organization-setup/company-profile";
import { resolveInvoiceCurrencyDefault, getSupportedInvoiceCurrencies } from "@/lib/invoices/currencies";
import { formatDateOnly } from "@/lib/invoices/date-only";
import { suggestNextQuoteNumber } from "@/lib/quotes/suggest-next-quote-number";
import { listQuoteTemplates } from "@/lib/quote-templates/queries";
import { getQuoteTemplateDefaults } from "@/lib/quote-templates/apply";
import { resolveClientPrefill } from "@/lib/clients/resolve-prefill";
import { parseSearchParam, type RawSearchParams } from "@/lib/list-params";
import { createQuoteAction } from "../actions";

/** "Jane Doe — Acme Inc (jane@acme.com)" — degrades gracefully when company/email are absent. */
function formatLeadLabel(lead: { name: string; company: string | null; email: string | null }): string {
  let label = lead.name;
  if (lead.company) label += ` — ${lead.company}`;
  if (lead.email) label += ` (${lead.email})`;
  return label;
}

/**
 * Quote Templates Phase 2 (Section F/G/N/S) — `?template=<id>` prefill,
 * layered onto the existing, otherwise byte-identical blank-Quote flow.
 *
 * ONE authoritative `now` (Section G, a specific Phase 1 review
 * requirement) — a single `new Date()` call for the whole request, reused
 * for BOTH the blank issueDate default and getQuoteTemplateDefaults's own
 * validUntil computation, so "issueDate + validityDays" always means
 * exactly what it says with no possible off-by-one from two separately-
 * evaluated timestamps straddling a UTC midnight rollover. See
 * test/unit/quotes-new-shared-now.test.ts for the deterministic proof.
 *
 * getQuoteTemplateDefaults already resolves {organizationId, membership}
 * itself from the session (never accepts organizationId as a parameter —
 * see apply.ts's own doc comment) and already permits any Staff role
 * currently allowed to create a Quote (canApplyQuoteTemplates), matching
 * createQuoteAction's own real "any role" permission exactly — this page
 * never re-derives or narrows that check.
 *
 * A missing template param leaves every line below the `now` declaration
 * exactly as it was before this feature (`templateId` is `""`,
 * `templateResult` stays `null`, `templateDefaults` stays `undefined`) —
 * the blank-Quote flow is unchanged.
 *
 * An archived / foreign-org / nonexistent / malformed template id are all
 * indistinguishable NOT_FOUND results from getQuoteTemplateDefaults
 * itself (Section H) — this page never learns, and therefore can never
 * leak, which one it was. All four render the exact same generic
 * "Template unavailable" notice plus an ordinary blank form (Section H's
 * own strong preference: a stale template URL never makes the whole page
 * unusable).
 *
 * Leads Pipeline V1 (Section 20) — `?clientId=<id>` layers on top of the
 * exact same "additive, never breaks the blank flow" discipline: an
 * absent or invalid/foreign-org id resolves to `prefillClient === null`
 * and this page's behavior is completely unchanged. When valid, it
 * deliberately selects the Client target (`targetType: "client"`,
 * `clientId`) — template defaults never set either of those two fields,
 * so the two prefill sources can never actually conflict; they compose.
 */
export default async function NewQuotePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;
  const templateId = parseSearchParam(resolvedSearchParams.template);
  const clientIdParam = parseSearchParam(resolvedSearchParams.clientId);

  const now = new Date();

  const [leads, clients, companyProfile, suggestedNumber, activeTemplates, templateResult, prefillClient] = await Promise.all([
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
    // Active only (Section S) — never offered for selection here even
    // though getActiveQuoteTemplateForApply would independently reject
    // an archived one anyway; this keeps the picker itself from ever
    // listing something it (or a forged URL) can't actually apply.
    listQuoteTemplates(organizationId, { includeArchived: false }),
    templateId ? getQuoteTemplateDefaults(templateId, now) : Promise.resolve(null),
    resolveClientPrefill(organizationId, clientIdParam),
  ]);

  const currencyDefault = resolveInvoiceCurrencyDefault(companyProfile.currency);

  const leadOptions: QuoteTargetOption[] = leads.map((lead) => ({ id: lead.id, label: formatLeadLabel(lead) }));
  const clientOptions: QuoteTargetOption[] = clients.map((client) => ({ id: client.id, label: client.name }));

  // A template id was present in the URL but could not be applied
  // (archived / foreign-org / nonexistent / malformed — all
  // indistinguishable, see this file's own header comment). Never shown
  // when no template param was given at all.
  const templateUnavailable = Boolean(templateId) && templateResult?.ok !== true;
  const appliedTemplateId = templateResult?.ok ? templateId : null;

  // Merged into QuoteForm's own defaultValues below — template content
  // (when present) takes priority over the organization's own currency
  // default, since it's the more specific, explicitly-chosen value
  // (Section G: never hidden behind an org default). Only the documented
  // prefill fields are ever read here (Section K) — no Client/Lead,
  // Quote number, status, or recipient ever comes from a template.
  const templateDefaults: Partial<QuoteFormDefaults> | undefined = templateResult?.ok
    ? {
        title: templateResult.defaults.title ?? undefined,
        notes: templateResult.defaults.notes ?? undefined,
        currency: templateResult.defaults.currency,
        discountType: templateResult.defaults.discountType,
        discountValue: templateResult.defaults.discountValue ?? undefined,
        taxRatePercent: templateResult.defaults.taxRatePercent ?? undefined,
        taxLabel: templateResult.defaults.taxLabel,
        items: templateResult.defaults.items,
        validUntil: templateResult.defaults.validUntil ?? undefined,
      }
    : undefined;

  // Leads Pipeline V1 (Section 20) — deliberately selects the Client
  // target only, never leaving a conflicting Lead selection populated.
  const clientPrefillDefaults: Partial<QuoteFormDefaults> | undefined = prefillClient
    ? { targetType: "client", clientId: prefillClient.id }
    : undefined;

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
        <>
          <QuoteTemplatePicker
            templates={activeTemplates.map((template) => ({ id: template.id, name: template.name }))}
            selectedTemplateId={appliedTemplateId ?? undefined}
          />

          {templateUnavailable && (
            <div className="border-warning bg-warning-subtle text-warning mb-6 rounded-md border px-4 py-3 text-sm" role="status">
              This quote template is unavailable. Starting with a blank quote instead.
            </div>
          )}

          <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
            <QuoteForm
              // Remounts whenever the applied template changes (including
              // to/from "no template") so QuoteForm's own useState
              // initializers re-read the new defaultValues — React does
              // not otherwise re-run those initializers on a prop change
              // alone. See quote-template-picker.tsx's own header comment.
              key={appliedTemplateId ?? "blank"}
              action={createQuoteAction}
              leads={leadOptions}
              clients={clientOptions}
              currencyOptions={getSupportedInvoiceCurrencies()}
              currencyFallbackNotice={
                !templateDefaults && currencyDefault.isFallback && currencyDefault.organizationCurrency
                  ? `Your organization's currency (${currencyDefault.organizationCurrency}) isn't supported for quotes — defaulted to USD.`
                  : undefined
              }
              defaultValues={{
                number: suggestedNumber,
                currency: currencyDefault.currency,
                issueDate: formatDateOnly(now),
                discountType: "NONE",
                taxLabel: "TAX",
                ...templateDefaults,
                ...clientPrefillDefaults,
              }}
              submitLabel="Create quote"
              pendingLabel="Creating…"
              successToast="Quote created"
            />
          </div>
        </>
      )}
    </div>
  );
}
