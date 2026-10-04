import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentMembership } from "@/lib/current-user";
import { canManageContractTemplates } from "@/lib/contract-templates/authorization";
import { getContractTemplateForManagement } from "@/lib/contract-templates/queries";
import { ContractTemplateForm, type ContractTemplateFormDefaults } from "@/components/contract-templates/contract-template-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { updateContractTemplateAction } from "../actions";

/**
 * Contract Templates V1 — Settings UI, edit. Only ever renders for a
 * template owned by the current organization
 * (getContractTemplateForManagement itself re-scopes by organizationId
 * AND isUuid()-guards the id before ever reaching the database), so a
 * foreign-org id, a nonexistent id, and a malformed id are all
 * indistinguishable `notFound()` here.
 *
 * Archived-edit rule: archived must be restored first, never edited
 * directly — mirrors EditInvoiceTemplatePage's own identical precedent.
 * The list page's own row actions already never render an Edit link for
 * an archived row (see contract-template-list.tsx); this redirect is the
 * defense-in-depth enforcement for a stale Edit link or a hand-typed URL.
 */
export default async function EditContractTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId, membership } = await getCurrentMembership();
  if (!(await canManageContractTemplates(organizationId, membership.role))) {
    redirect("/settings/contract-templates");
  }

  const template = await getContractTemplateForManagement(organizationId, id);
  if (!template) {
    notFound();
  }
  if (template.archivedAt !== null) {
    redirect("/settings/contract-templates?status=archived");
  }

  const defaultValues: ContractTemplateFormDefaults = {
    name: template.name,
    title: template.title,
    body: template.body,
    defaultExpiryOffsetDays: template.defaultExpiryOffsetDays != null ? String(template.defaultExpiryOffsetDays) : undefined,
    internalNotes: template.internalNotes ?? undefined,
  };

  const boundUpdateAction = updateContractTemplateAction.bind(null, template.id);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Edit contract template</h1>
        <Link href="/settings/contract-templates" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <ContractTemplateForm
          action={boundUpdateAction}
          defaultValues={defaultValues}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          successToast="Template updated"
        />
      </div>
    </div>
  );
}
