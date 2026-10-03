import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentMembership } from "@/lib/current-user";
import { canManageInvoiceTemplates } from "@/lib/invoice-templates/authorization";
import { getInvoiceTemplateForManagement } from "@/lib/invoice-templates/queries";
import { getSupportedInvoiceCurrencies } from "@/lib/invoices/currencies";
import { InvoiceTemplateForm, type InvoiceTemplateFormDefaults } from "@/components/invoice-templates/invoice-template-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { updateInvoiceTemplateAction } from "../actions";

/**
 * Invoice Templates V1 — Settings UI, edit. Only ever renders for a
 * template owned by the current organization
 * (getInvoiceTemplateForManagement itself re-scopes by organizationId
 * AND isUuid()-guards the id before ever reaching the database), so a
 * foreign-org id, a nonexistent id, and a malformed id are all
 * indistinguishable `notFound()` here.
 *
 * Archived-edit rule: archived must be restored first, never edited
 * directly — mirrors EditQuoteTemplatePage's own identical precedent.
 * The list page's own row actions already never render an Edit link for
 * an archived row (see invoice-template-list.tsx); this redirect is the
 * defense-in-depth enforcement for a stale Edit link or a hand-typed URL.
 */
export default async function EditInvoiceTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId, membership } = await getCurrentMembership();
  if (!(await canManageInvoiceTemplates(organizationId, membership.role))) {
    redirect("/settings/invoice-templates");
  }

  const template = await getInvoiceTemplateForManagement(organizationId, id);
  if (!template) {
    notFound();
  }
  if (template.archivedAt !== null) {
    redirect("/settings/invoice-templates?status=archived");
  }

  const defaultValues: InvoiceTemplateFormDefaults = {
    name: template.name,
    notes: template.notes ?? undefined,
    internalNotes: template.internalNotes ?? undefined,
    currency: template.currency,
    dueDateOffsetDays: template.dueDateOffsetDays != null ? String(template.dueDateOffsetDays) : undefined,
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

  const boundUpdateAction = updateInvoiceTemplateAction.bind(null, template.id);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Edit invoice template</h1>
        <Link href="/settings/invoice-templates" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <InvoiceTemplateForm
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
