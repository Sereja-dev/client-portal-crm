import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getActiveCustomFieldFormDefinitions, getCustomFieldFormValues } from "@/lib/custom-fields/entity-form";
import { getActiveTagFormOptions, getTagFormAssignments } from "@/lib/tags/entity-form";
import { buildStatusSelectOptions } from "@/lib/custom-statuses/entity-form";
import { resolveSystemStatusDefinition } from "@/lib/custom-statuses/resolution";
import { LeadForm } from "@/components/leads/lead-form";
import { LeadActionsPanel } from "@/components/leads/lead-actions-panel";
import { TimelineSection } from "@/components/timeline/timeline-section";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { updateLeadFormAction } from "./actions";
import {
  createLeadTimelineNoteAction,
  editLeadTimelineNoteAction,
  deleteLeadTimelineNoteAction,
} from "./timeline-actions";

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Communication Timeline Phase 2 — switched from getCurrentUserOrganization()
  // to its own strict superset (per that function's own doc comment) so
  // this page can also resolve the acting Staff member's own {id, name,
  // role} for the new TimelineSection below; every existing use of
  // organizationId here is completely unaffected.
  const { user, organizationId, membership } = await getCurrentMembership();

  // Scoped by id + organizationId together — a foreign org's lead id
  // simply doesn't match, indistinguishable from a nonexistent one,
  // matching every other entity edit route in this app exactly.
  const lead = await prisma.lead.findFirst({
    where: { id, organizationId },
    include: { statusDefinition: { select: { label: true, color: true } } },
  });

  if (!lead) {
    notFound();
  }

  const memberships = await prisma.membership.findMany({
    where: { organizationId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    include: { user: { select: { id: true, name: true } } },
  });
  const assignees = memberships.map((m) => ({ id: m.user.id, name: m.user.name }));

  const boundUpdateLeadFormAction = updateLeadFormAction.bind(null, lead.id);

  // Custom Fields Phase 2B (Section F) — see EditClientPage's own identical comment.
  const customFieldDefinitions = await getActiveCustomFieldFormDefinitions(organizationId, "LEAD");
  const customFieldValuesMap = await getCustomFieldFormValues(organizationId, "LEAD", lead.id, customFieldDefinitions);

  // Custom Statuses Phase 2B (Section M) — see EditClientPage's own
  // identical comment for the unbackfilled-fixture fallback; the LOST
  // exclusion itself happens inside LeadActionsPanel (Section M —
  // CRITICAL), not here.
  const currentStatusDefinitionId =
    lead.statusDefinitionId ??
    (await resolveSystemStatusDefinition(organizationId, "LEAD", lead.stage.toLowerCase()))?.id ??
    undefined;
  const statusOptions = await buildStatusSelectOptions(organizationId, "LEAD", currentStatusDefinitionId ?? null);

  // Tags V2 (Section 3) — every ACTIVE org tag, plus this Lead's own
  // current assignments split into the active picker's pre-checked set
  // and the archived, display-only set.
  const tagOptions = await getActiveTagFormOptions(organizationId);
  const tagAssignments = await getTagFormAssignments(organizationId, "LEAD", lead.id);

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Edit lead</h1>
        <Link href="/leads" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <LeadForm
          action={boundUpdateLeadFormAction}
          assignees={assignees}
          defaultValues={{
            name: lead.name,
            company: lead.company,
            email: lead.email,
            phone: lead.phone,
            source: lead.source,
            value: lead.value ? lead.value.toString() : null,
            notes: lead.notes,
            assignedToUserId: lead.assignedToUserId,
          }}
          customFieldDefinitions={customFieldDefinitions}
          customFieldValues={Object.fromEntries(customFieldValuesMap)}
          tagOptions={tagOptions}
          selectedTagIds={tagAssignments.activeTagIds}
          archivedAssignedTags={tagAssignments.archivedAssigned}
          submitLabel="Save changes"
          pendingLabel="Saving…"
        />
        <LeadActionsPanel
          leadId={lead.id}
          stage={lead.stage}
          statusDefinition={lead.statusDefinition}
          statusOptions={statusOptions}
          currentStatusDefinitionId={currentStatusDefinitionId}
          archivedAt={lead.archivedAt ? lead.archivedAt.toISOString() : null}
          convertedClientId={lead.convertedClientId}
        />
        {/* Communication Timeline Phase 2 — see EditClientPage's own identical placement comment; last on the page, after LeadActionsPanel. */}
        <TimelineSection
          entityType="LEAD"
          entityId={lead.id}
          organizationId={organizationId}
          actor={{ id: user.id, name: user.name, role: membership.role }}
          createAction={createLeadTimelineNoteAction.bind(null, lead.id)}
          makeEditAction={(noteId) => editLeadTimelineNoteAction.bind(null, lead.id, noteId)}
          makeDeleteAction={(noteId) => deleteLeadTimelineNoteAction.bind(null, lead.id, noteId)}
        />
      </div>
    </div>
  );
}
