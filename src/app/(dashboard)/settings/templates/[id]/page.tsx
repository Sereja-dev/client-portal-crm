import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentMembership } from "@/lib/current-user";
import { canManageQuoteTemplates } from "@/lib/quote-templates/authorization";
import { getQuoteTemplateForManagement } from "@/lib/quote-templates/queries";
import { getSupportedInvoiceCurrencies } from "@/lib/invoices/currencies";
import { QuoteTemplateForm, type QuoteTemplateFormDefaults } from "@/components/quote-templates/quote-template-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { updateQuoteTemplateAction } from "../actions";

/**
 * Quote Templates Phase 2 — Settings UI, edit. Only ever renders for a
 * template owned by the current organization (getQuoteTemplateForManagement
 * itself re-scopes by organizationId AND isUuid()-guards the id before
 * ever reaching the database — see that function's own doc comment), so
 * a foreign-org id, a nonexistent id, and a malformed id are all
 * indistinguishable `notFound()` here.
 *
 * Chosen archived-edit rule (Section C, as the spec asks to document):
 * archived must be restored first, never edited directly — mirrors
 * Custom Fields' own precedent exactly (an archived CustomFieldDefinition
 * shows no rename/edit affordance in definitions-list.tsx, only
 * Unarchive) rather than Workflow Automations' stricter "no un-archive
 * path at all" version of the same redirect. The list page's own row
 * actions already never render an Edit link for an archived row (see
 * quote-template-list.tsx); this redirect is the defense-in-depth
 * enforcement for a stale Edit link or a hand-typed URL.
 */
export default async function EditQuoteTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId, membership } = await getCurrentMembership();
  if (!canManageQuoteTemplates(membership.role)) {
    redirect("/settings/templates");
  }

  const template = await getQuoteTemplateForManagement(organizationId, id);
  if (!template) {
    notFound();
  }
  if (template.archivedAt !== null) {
    redirect("/settings/templates?status=archived");
  }

  const defaultValues: QuoteTemplateFormDefaults = {
    name: template.name,
    title: template.title ?? undefined,
    notes: template.notes ?? undefined,
    currency: template.currency,
    validityDays: template.validityDays != null ? String(template.validityDays) : undefined,
    discountType: template.discountType,
    discountValue: template.discountValue?.toString(),
    taxRatePercent: template.taxRatePercent?.toString(),
    taxLabel: template.taxLabel,
    items: template.items.map((item) => ({
      description: item.description,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
    })),
  };

  const boundUpdateAction = updateQuoteTemplateAction.bind(null, template.id);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Edit quote template</h1>
        <Link href="/settings/templates" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <QuoteTemplateForm
          action={boundUpdateAction}
          currencyOptions={getSupportedInvoiceCurrencies()}
          defaultValues={defaultValues}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          successToast="Template updated"
        />
      </div>
    </div>
  );
}
