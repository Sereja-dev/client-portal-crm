import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentPortalUser } from "@/lib/current-portal-user";
import { getPortalProject } from "@/lib/client-portal/queries";
import { getPortalProjectAttachments } from "@/lib/client-portal/attachments";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolveStatusPresentation } from "@/lib/custom-statuses/presentation";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { PortalAttachmentsList } from "@/components/client-portal/portal-attachments-list";

export default async function PortalProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { clientId } = await getCurrentPortalUser();

  // Scoped by id + clientId together, never a bare id lookup — a project
  // belonging to a different Client (same organization or a different
  // one) simply doesn't match, indistinguishable from a nonexistent id.
  const project = await getPortalProject(clientId, id);

  if (!project) {
    notFound();
  }

  // The Project lookup above is already scoped by id + clientId — this
  // only re-applies the entityType/entityId/organizationId boundary on
  // the Attachment table, it does not re-verify Project ownership.
  const attachments = await getPortalProjectAttachments(project);
  const presentation = resolveStatusPresentation(project.statusDefinition, project.status);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/portal/projects" className={ACTION_LINK_CLASSES}>
        ← Back to projects
      </Link>

      <div className={`mt-4 p-6 ${CARD_SURFACE_CLASSES}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-text-primary text-xl font-semibold tracking-tight">
            {project.name}
          </h1>
          <StatusBadge status={project.status} label={presentation.label} tone={presentation.tone} />
        </div>

        {project.description && (
          <p className="text-text-muted mt-4 text-sm">{project.description}</p>
        )}

        <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">
              Client
            </dt>
            <dd className="text-text-primary mt-1 text-sm">{project.clientName}</dd>
          </div>
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">
              Start date
            </dt>
            <dd className="text-text-primary mt-1 text-sm">
              {project.startDate ? project.startDate.toLocaleDateString() : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">
              End date
            </dt>
            <dd className="text-text-primary mt-1 text-sm">
              {project.endDate ? project.endDate.toLocaleDateString() : "—"}
            </dd>
          </div>
        </dl>

        <div className="border-border-default mt-8 border-t pt-6">
          <h2 className="text-text-primary text-sm font-semibold">Attachments</h2>
          <PortalAttachmentsList
            attachments={attachments}
            emptyDescription="Files shared for this project will appear here."
          />
        </div>
      </div>
    </div>
  );
}
