import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { getLeadCaptureForm } from "@/lib/lead-capture-forms/forms";
import { resolveLeadCaptureFormFieldsConfig, type LeadCaptureFormFieldsConfig } from "@/lib/lead-capture-forms/fields";
import { LeadCaptureFormEditor } from "@/components/lead-capture-forms/lead-capture-form-editor";
import { CopyPublicLinkButton } from "@/components/lead-capture-forms/form-row-actions";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { updateLeadCaptureFormAction } from "../actions";

export default async function EditLeadCaptureFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId } = await getCurrentUserOrganization();

  // Scoped by id + organizationId together — a foreign org's form id
  // simply doesn't match, indistinguishable from a nonexistent one,
  // matching every other entity edit route in this app exactly (see
  // getLeadCaptureForm's own doc comment).
  const form = await getLeadCaptureForm(organizationId, id);

  if (!form) {
    notFound();
  }

  const boundUpdateAction = updateLeadCaptureFormAction.bind(null, form.id);
  const isLive = form.isActive && form.archivedAt === null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Edit lead capture form</h1>
        <Link href="/settings/lead-capture-forms" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>

      {form.archivedAt !== null && (
        <p className="border-border-strong bg-surface-recessed text-text-secondary mb-4 rounded-md border border-dashed px-4 py-3 text-sm">
          This form is archived. Unarchive it from the list page before it can accept
          submissions again.
        </p>
      )}

      {isLive && (
        <div className="border-border-default bg-surface mb-4 flex items-center justify-between gap-3 rounded-md border px-4 py-3">
          <p className="text-text-secondary min-w-0 truncate text-sm">
            Public link: <code className="text-text-primary">/forms/{form.publicToken}</code>
          </p>
          <CopyPublicLinkButton publicToken={form.publicToken} />
        </div>
      )}

      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <LeadCaptureFormEditor
          action={boundUpdateAction}
          defaultValues={{
            name: form.name,
            title: form.title,
            description: form.description,
            successMessage: form.successMessage,
            isActive: form.isActive,
            fieldsConfig: resolveLeadCaptureFormFieldsConfig(form.fieldsConfig as LeadCaptureFormFieldsConfig),
          }}
          submitLabel="Save changes"
          pendingLabel="Saving…"
        />
      </div>
    </div>
  );
}
