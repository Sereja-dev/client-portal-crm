import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getActiveCustomFieldFormDefinitions, getCustomFieldFormValues } from "@/lib/custom-fields/entity-form";
import { buildStatusSelectOptions } from "@/lib/custom-statuses/entity-form";
import { resolveSystemStatusDefinition } from "@/lib/custom-statuses/resolution";
import { ProjectForm } from "@/components/projects/project-form";
import { updateProjectAction } from "./actions";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";

function toDateInputValue(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

/**
 * Project Hub V1 — this page is now Project field editing ONLY. Comments
 * and Attachments (relationship & history surfaces, not "current field
 * state") moved to the new canonical Project Hub route, `/projects/[id]`
 * (see that page's own header comment) — they are no longer duplicated
 * here. `getCurrentMembership()`'s own `membership`/`user` are no longer
 * read (no Comments section left here needs them); only
 * `organizationId` remains in use, mirroring EditClientPage's own
 * identical trim.
 */
export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await getCurrentUserOrganization();

  const [project, clients] = await Promise.all([
    prisma.project.findFirst({
      where: { id, organizationId },
    }),
    prisma.client.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!project) {
    notFound();
  }

  const boundUpdateProjectAction = updateProjectAction.bind(null, project.id);

  // Custom Fields Phase 2B (Section F) — see EditClientPage's own identical comment.
  const customFieldDefinitions = await getActiveCustomFieldFormDefinitions(organizationId, "PROJECT");
  const customFieldValuesMap = await getCustomFieldFormValues(
    organizationId,
    "PROJECT",
    project.id,
    customFieldDefinitions,
  );
  // Custom Statuses Phase 2B (Section O/D) — see EditClientPage's own identical comment.
  const currentStatusDefinitionId =
    project.statusDefinitionId ??
    (await resolveSystemStatusDefinition(organizationId, "PROJECT", project.status.toLowerCase()))?.id ??
    undefined;
  const statusOptions = await buildStatusSelectOptions(organizationId, "PROJECT", currentStatusDefinitionId ?? null);

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">
          Edit project
        </h1>
        <Link href={`/projects/${project.id}`} className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <ProjectForm
          action={boundUpdateProjectAction}
          clients={clients}
          defaultValues={{
            name: project.name,
            clientId: project.clientId,
            startDate: toDateInputValue(project.startDate),
            endDate: toDateInputValue(project.endDate),
          }}
          statusOptions={statusOptions}
          currentStatusDefinitionId={currentStatusDefinitionId}
          customFieldDefinitions={customFieldDefinitions}
          customFieldValues={Object.fromEntries(customFieldValuesMap)}
          submitLabel="Save changes"
          pendingLabel="Saving…"
        />
      </div>
    </div>
  );
}
