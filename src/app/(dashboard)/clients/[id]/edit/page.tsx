import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getActiveCustomFieldFormDefinitions, getCustomFieldFormValues } from "@/lib/custom-fields/entity-form";
import { getActiveTagFormOptions, getTagFormAssignments } from "@/lib/tags/entity-form";
import { buildStatusSelectOptions } from "@/lib/custom-statuses/entity-form";
import { resolveSystemStatusDefinition } from "@/lib/custom-statuses/resolution";
import { ClientForm } from "@/components/clients/client-form";
import { TimelineSection } from "@/components/timeline/timeline-section";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { updateClientAction } from "./actions";
import { ClientAttachmentsSection } from "./attachments-section";
import { ClientContactsSection } from "./contacts-section";
import { ClientPortalAccessSection } from "./portal-access-section";
import {
  createClientTimelineNoteAction,
  editClientTimelineNoteAction,
  deleteClientTimelineNoteAction,
} from "./timeline-actions";

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user, organizationId, membership } = await getCurrentMembership();

  const client = await prisma.client.findFirst({
    where: { id, organizationId },
  });

  if (!client) {
    notFound();
  }

  const boundUpdateClientAction = updateClientAction.bind(null, client.id);

  // Custom Fields Phase 2B (Section F) — active CLIENT definitions plus
  // this Client's own current values, prefilling the form. Converted to
  // a plain object at this Server Component -> Client Component boundary
  // (Object.fromEntries) since a Map isn't a serializable prop.
  const customFieldDefinitions = await getActiveCustomFieldFormDefinitions(organizationId, "CLIENT");
  const customFieldValuesMap = await getCustomFieldFormValues(
    organizationId,
    "CLIENT",
    client.id,
    customFieldDefinitions,
  );
  // Custom Statuses Phase 2B (Section L/D) — a real Production Client
  // always has a non-null statusDefinitionId (Phase 1's own backfill +
  // every create path since); this fallback only ever matters for a
  // historical/unbackfilled test fixture, so the edit form still
  // preselects the Client's own genuinely-current status (via its legacy
  // enum) rather than silently defaulting to the organization's default.
  const currentStatusDefinitionId =
    client.statusDefinitionId ?? (await resolveSystemStatusDefinition(organizationId, "CLIENT", client.status.toLowerCase()))?.id ?? undefined;
  const statusOptions = await buildStatusSelectOptions(organizationId, "CLIENT", currentStatusDefinitionId ?? null);

  // Tags V2 (Section 3) — every ACTIVE org tag, plus this Client's own
  // current assignments split into the active picker's pre-checked set
  // and the archived, display-only set.
  const tagOptions = await getActiveTagFormOptions(organizationId);
  const tagAssignments = await getTagFormAssignments(organizationId, "CLIENT", client.id);

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">
          Edit client
        </h1>
        <Link href="/clients" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <ClientForm
          action={boundUpdateClientAction}
          defaultValues={client}
          statusOptions={statusOptions}
          currentStatusDefinitionId={currentStatusDefinitionId}
          customFieldDefinitions={customFieldDefinitions}
          customFieldValues={Object.fromEntries(customFieldValuesMap)}
          tagOptions={tagOptions}
          selectedTagIds={tagAssignments.activeTagIds}
          archivedAssignedTags={tagAssignments.archivedAssigned}
          submitLabel="Save changes"
          pendingLabel="Saving…"
        />
        <ClientContactsSection clientId={client.id} organizationId={organizationId} />
        <ClientAttachmentsSection clientId={client.id} organizationId={organizationId} />
        <ClientPortalAccessSection clientId={client.id} role={membership.role} />
        {/*
          Communication Timeline Phase 2 — placed last, after every
          "current state" editing section: it is a running history of
          everything that already happened on this record (including
          Contacts/Attachments/Portal Access's own Activity events), so it
          reads naturally as the final "here's the history" section,
          matching Client Requests' own detail page precedent (its
          Conversation section is likewise the last thing on the page).
        */}
        <TimelineSection
          entityType="CLIENT"
          entityId={client.id}
          organizationId={organizationId}
          actor={{ id: user.id, name: user.name, role: membership.role }}
          createAction={createClientTimelineNoteAction.bind(null, client.id)}
          makeEditAction={(noteId) => editClientTimelineNoteAction.bind(null, client.id, noteId)}
          makeDeleteAction={(noteId) => deleteClientTimelineNoteAction.bind(null, client.id, noteId)}
        />
      </div>
    </div>
  );
}
