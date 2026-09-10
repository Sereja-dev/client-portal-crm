import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getActiveCustomFieldFormDefinitions, getCustomFieldFormValues } from "@/lib/custom-fields/entity-form";
import { LeadForm } from "@/components/leads/lead-form";
import { LeadActionsPanel } from "@/components/leads/lead-actions-panel";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { updateLeadFormAction } from "./actions";

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId } = await getCurrentUserOrganization();

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
          submitLabel="Save changes"
          pendingLabel="Saving…"
        />
        <LeadActionsPanel
          leadId={lead.id}
          stage={lead.stage}
          statusDefinition={lead.statusDefinition}
          archivedAt={lead.archivedAt ? lead.archivedAt.toISOString() : null}
          convertedClientId={lead.convertedClientId}
        />
      </div>
    </div>
  );
}
