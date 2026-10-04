import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMembership } from "@/lib/current-user";
import { canManageContractTemplates } from "@/lib/contract-templates/authorization";
import { ContractTemplateForm } from "@/components/contract-templates/contract-template-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { createContractTemplateAction } from "../actions";

/**
 * Contract Templates V1 — Settings UI, "New template". OWNER/ADMIN-only —
 * a MEMBER is redirected outright rather than shown a form that would
 * only ever fail server-side (createContractTemplateAction independently
 * re-verifies this regardless), matching NewInvoiceTemplatePage's own
 * identical "gate the page, not just the action" discipline.
 */
export default async function NewContractTemplatePage() {
  const { organizationId, membership } = await getCurrentMembership();
  if (!(await canManageContractTemplates(organizationId, membership.role))) {
    redirect("/settings/contract-templates");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">New contract template</h1>
        <Link href="/settings/contract-templates" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <ContractTemplateForm
          action={createContractTemplateAction}
          submitLabel="Create template"
          pendingLabel="Creating…"
          successToast="Template created"
        />
      </div>
    </div>
  );
}
