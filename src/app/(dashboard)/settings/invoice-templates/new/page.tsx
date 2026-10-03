import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMembership } from "@/lib/current-user";
import { canManageInvoiceTemplates } from "@/lib/invoice-templates/authorization";
import { getSupportedInvoiceCurrencies } from "@/lib/invoices/currencies";
import { InvoiceTemplateForm } from "@/components/invoice-templates/invoice-template-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { createInvoiceTemplateAction } from "../actions";

/**
 * Invoice Templates V1 — Settings UI, "New template". OWNER/ADMIN-only —
 * a MEMBER is redirected outright rather than shown a form that would
 * only ever fail server-side (createInvoiceTemplateAction independently
 * re-verifies this regardless), matching NewQuoteTemplatePage's own
 * identical "gate the page, not just the action" discipline.
 */
export default async function NewInvoiceTemplatePage() {
  const { organizationId, membership } = await getCurrentMembership();
  if (!(await canManageInvoiceTemplates(organizationId, membership.role))) {
    redirect("/settings/invoice-templates");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">New invoice template</h1>
        <Link href="/settings/invoice-templates" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <InvoiceTemplateForm
          action={createInvoiceTemplateAction}
          currencyOptions={getSupportedInvoiceCurrencies()}
          submitLabel="Create template"
          pendingLabel="Creating…"
          successToast="Template created"
        />
      </div>
    </div>
  );
}
