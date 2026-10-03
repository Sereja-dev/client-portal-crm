import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { InvoiceForm, type InvoiceFormDefaults } from "@/components/invoices/invoice-form";
import { InvoiceTemplatePicker } from "@/components/invoices/invoice-template-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { getCompanyProfile } from "@/lib/organization-setup/company-profile";
import { resolveInvoiceCurrencyDefault, getSupportedInvoiceCurrencies } from "@/lib/invoices/currencies";
import { formatDateOnly } from "@/lib/invoices/date-only";
import { listInvoiceTemplates } from "@/lib/invoice-templates/queries";
import { getInvoiceTemplateDefaults } from "@/lib/invoice-templates/apply";
import { resolveClientPrefill } from "@/lib/clients/resolve-prefill";
import { parseSearchParam, type RawSearchParams } from "@/lib/list-params";
import { createInvoiceAction } from "./actions";

/**
 * Invoice Templates V1 — `?templateId=<id>` prefill, layered onto the
 * existing, otherwise byte-identical blank-Invoice flow. Mirrors
 * src/app/(dashboard)/quotes/new/page.tsx's own identical `?template=`
 * integration exactly (see that file's own header comment for the full
 * reasoning this one reuses verbatim below).
 *
 * ONE authoritative `now` — a single `new Date()` call for the whole
 * request, reused for BOTH the blank issueDate default and
 * getInvoiceTemplateDefaults's own dueDate computation, so "issue date +
 * dueDateOffsetDays" always means exactly what it says with no possible
 * off-by-one from two separately-evaluated timestamps straddling a UTC
 * midnight rollover.
 *
 * getInvoiceTemplateDefaults already resolves {organizationId,
 * membership} itself from the session and already permits any Staff role
 * currently allowed to create an Invoice (canApplyInvoiceTemplates) — this
 * page never re-derives or narrows that check.
 *
 * A missing template param leaves every line below the `now` declaration
 * exactly as it was before this feature (`templateId` is `""`,
 * `templateResult` stays `null`, `templateDefaults` stays `undefined`) —
 * the blank-Invoice flow is unchanged.
 *
 * An archived / foreign-org / nonexistent / malformed template id are all
 * indistinguishable NOT_FOUND results from getInvoiceTemplateDefaults
 * itself — this page never learns, and therefore can never leak, which
 * one it was. All four render the exact same generic "Template
 * unavailable" notice plus an ordinary blank form — a stale template URL
 * never makes the whole page unusable.
 *
 * `?clientId=` layers on top of the exact same "additive, never breaks
 * the blank flow" discipline: an absent or invalid/foreign-org id resolves
 * to `prefillClient === null` and this page's behavior is completely
 * unchanged. Template defaults never set clientId/projectId (Product
 * Owner decision — InvoiceTemplate stores neither), so the two prefill
 * sources can never actually conflict; they compose.
 *
 * `mode: "itemized"` is forced whenever a template applies — an
 * InvoiceTemplate always stores items only (never a flat amount; see
 * InvoiceTemplate's own schema comment), so there is no "flat" default
 * to prefer here the way the blank flow's own `mode: "flat"` default
 * does.
 */
export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  // Authentication resolved first, standalone — organizationId is never
  // referenced inside a Promise.all that is still awaiting this.
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;
  const templateId = parseSearchParam(resolvedSearchParams.templateId);

  const now = new Date();

  // Quotes / Estimates Phase 2.3 — Client REQUIRED, Project OPTIONAL
  // (Invoice / Project Coupling Audit). Every Client is a valid Invoice
  // target regardless of whether the org has any Projects at all — the
  // old "You need a project first" gate (which blocked Invoice creation
  // entirely whenever the org had zero Projects) is removed.
  //
  // Leads Pipeline V1 (Section 21) — an optional post-conversion
  // ?clientId= prefill, resolved the same tenant-scoped way as
  // /projects/new and /quotes/new (resolveClientPrefill). Absent, or an
  // invalid/foreign-org id, both leave this page's own existing
  // behavior completely unchanged.
  const [clients, projects, companyProfile, activeTemplates, templateResult, prefillClient] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.project.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, clientId: true },
    }),
    getCompanyProfile(organizationId),
    // Active only — never offered for selection here even though
    // getActiveInvoiceTemplateForApply would independently reject an
    // archived one anyway; this keeps the picker itself from ever
    // listing something it (or a forged URL) can't actually apply.
    listInvoiceTemplates(organizationId, { includeArchived: false }),
    templateId ? getInvoiceTemplateDefaults(templateId, now) : Promise.resolve(null),
    resolveClientPrefill(organizationId, parseSearchParam(resolvedSearchParams.clientId)),
  ]);

  const currencyDefault = resolveInvoiceCurrencyDefault(companyProfile.currency);

  // A template id was present in the URL but could not be applied
  // (archived / foreign-org / nonexistent / malformed — all
  // indistinguishable, see this file's own header comment). Never shown
  // when no template param was given at all.
  const templateUnavailable = Boolean(templateId) && templateResult?.ok !== true;
  const appliedTemplateId = templateResult?.ok ? templateId : null;

  // Merged into InvoiceForm's own defaultValues below — template content
  // (when present) takes priority over the organization's own currency
  // default, since it's the more specific, explicitly-chosen value. Only
  // the documented prefill fields are ever read here — no Client/Project,
  // invoice number, status, or recipient ever comes from a template.
  const templateDefaults: Partial<InvoiceFormDefaults> | undefined = templateResult?.ok
    ? {
        mode: "itemized",
        lineItems: templateResult.defaults.items,
        currency: templateResult.defaults.currency,
        dueDate: templateResult.defaults.dueDate ?? undefined,
        notes: templateResult.defaults.notes ?? undefined,
        internalNotes: templateResult.defaults.internalNotes ?? undefined,
        discountType: templateResult.defaults.discountType,
        discountValue: templateResult.defaults.discountValue ?? undefined,
        taxRatePercent: templateResult.defaults.taxRatePercent ?? undefined,
        taxLabel: templateResult.defaults.taxLabel,
      }
    : undefined;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">
          Add invoice
        </h1>
        <Link href="/invoices" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>

      {clients.length === 0 ? (
        <EmptyState
          title="You need a client first"
          description="Invoices must belong to a client. Add one before creating an invoice."
          action={
            <Link
              href="/clients/new"
              className="focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              Add client
            </Link>
          }
        />
      ) : (
        <>
          <InvoiceTemplatePicker
            templates={activeTemplates.map((template) => ({ id: template.id, name: template.name }))}
            selectedTemplateId={appliedTemplateId ?? undefined}
          />

          {templateUnavailable && (
            <div className="border-warning bg-warning-subtle text-warning mb-6 rounded-md border px-4 py-3 text-sm" role="status">
              This invoice template is unavailable. Starting with a blank invoice instead.
            </div>
          )}

          <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
            <InvoiceForm
              // Remounts whenever the applied template changes (including
              // to/from "no template") so InvoiceForm's own useState
              // initializers re-read the new defaultValues — React does
              // not otherwise re-run those initializers on a prop change
              // alone. See invoice-template-picker.tsx's own header
              // comment, and quote-template-picker.tsx's own identical
              // precedent.
              key={appliedTemplateId ?? "blank"}
              action={createInvoiceAction}
              clients={clients}
              projects={projects.map((project) => ({ id: project.id, label: project.name, clientId: project.clientId }))}
              currencyOptions={getSupportedInvoiceCurrencies()}
              companyDisplayName={companyProfile.displayName}
              currencyFallbackNotice={
                !templateDefaults && currencyDefault.isFallback && currencyDefault.organizationCurrency
                  ? `Your organization's currency (${currencyDefault.organizationCurrency}) isn't supported for invoices — defaulted to USD.`
                  : undefined
              }
              defaultValues={{
                mode: "flat",
                currency: currencyDefault.currency,
                issueDate: formatDateOnly(now),
                discountType: "NONE",
                taxLabel: "TAX",
                ...templateDefaults,
                ...(prefillClient ? { clientId: prefillClient.id } : {}),
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
