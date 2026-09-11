import { getCurrentUserOrganization } from "@/lib/current-user";
import { listLeadCaptureForms } from "@/lib/lead-capture-forms/forms";
import { LeadCaptureFormsList, type LeadCaptureFormRow } from "@/components/lead-capture-forms/forms-list";
import { archiveLeadCaptureFormAction, unarchiveLeadCaptureFormAction, setLeadCaptureFormActiveAction } from "./actions";

/**
 * Public Lead Capture Forms Phase 2A (Staff UI) — the organization's own
 * forms list. Reachable at /settings/lead-capture-forms, alongside the
 * app's other Settings pages via SettingsNav. Any OWNER/ADMIN/MEMBER of
 * the organization may view/manage — matches this app's existing
 * Client-management permission model, the same tier Custom Fields/Custom
 * Statuses already established.
 *
 * Data is fetched fresh here (no caching layer): every form for this
 * organization, active + archived, so the archived toggle can flip
 * between them client-side with no extra round trip — mirrors
 * CustomStatusesSettingsPage/CustomFieldsSettingsPage's own identical
 * shape. Every per-row mutation is bound to its own id right here, before
 * ever reaching a Client Component (organizationId is never trusted from
 * client input — see actions.ts's own header comment).
 */
export default async function LeadCaptureFormsSettingsPage() {
  const { organizationId } = await getCurrentUserOrganization();

  const forms = await listLeadCaptureForms(organizationId, { includeArchived: true });

  const rows: LeadCaptureFormRow[] = forms.map((form) => ({
    id: form.id,
    name: form.name,
    title: form.title,
    isActive: form.isActive,
    archivedAt: form.archivedAt,
    publicToken: form.publicToken,
    archiveAction: archiveLeadCaptureFormAction.bind(null, form.id),
    unarchiveAction: unarchiveLeadCaptureFormAction.bind(null, form.id),
    toggleActiveAction: setLeadCaptureFormActiveAction.bind(null, form.id, !form.isActive),
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Lead capture forms</h1>
      <p className="text-text-secondary mt-1 text-sm">
        Create public forms that turn website visitors into leads. Each form gets its own link
        you can share or embed — submissions land directly in your Leads pipeline.
      </p>

      <LeadCaptureFormsList forms={rows} />
    </div>
  );
}
