import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMembership } from "@/lib/current-user";
import { canManageQuoteTemplates } from "@/lib/quote-templates/authorization";
import { getSupportedInvoiceCurrencies } from "@/lib/invoices/currencies";
import { QuoteTemplateForm } from "@/components/quote-templates/quote-template-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { createQuoteTemplateAction } from "../actions";

/**
 * Quote Templates Phase 2 — Settings UI, "New template". OWNER/ADMIN-only
 * — a MEMBER is redirected outright rather than shown a form that would
 * only ever fail server-side (createQuoteTemplateAction independently
 * re-verifies this regardless, via the Phase 1 service layer), matching
 * NewWorkflowAutomationPage's own identical "gate the page, not just the
 * action" discipline.
 */
export default async function NewQuoteTemplatePage() {
  const { membership } = await getCurrentMembership();
  if (!canManageQuoteTemplates(membership.role)) {
    redirect("/settings/templates");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">New quote template</h1>
        <Link href="/settings/templates" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <QuoteTemplateForm
          action={createQuoteTemplateAction}
          currencyOptions={getSupportedInvoiceCurrencies()}
          submitLabel="Create template"
          pendingLabel="Creating…"
          successToast="Template created"
        />
      </div>
    </div>
  );
}
