import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolveStatusPresentation } from "@/lib/custom-statuses/presentation";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import type { CustomStatusColor } from "@/generated/prisma/enums";

export type ProfileProject = {
  id: string;
  name: string;
  status: string;
  statusDefinition: { label: string; color: CustomStatusColor | null } | null;
  startDate: Date | null;
  endDate: Date | null;
  client: { id: string; name: string };
  owner: { id: string; name: string };
};

/**
 * Project Hub V1 — compact header, mirroring Client Profile Hub's own
 * `ClientProfileHeader` exactly (same truthful-existing-data-only
 * discipline: missing optional fields are simply omitted, never rendered
 * as placeholder clutter). No Project-overdue semantics are invented
 * here — start/end dates are shown as plain dates, never flagged
 * "overdue" (that indicator is a Task-only concept per the read-only
 * audit's own §5 instruction).
 */
export function ProjectProfileHeader({
  project,
}: {
  project: ProfileProject;
}) {
  const presentation = resolveStatusPresentation(project.statusDefinition, project.status);

  return (
    <div className="border-border-default bg-surface rounded-lg border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-text-primary text-2xl font-semibold tracking-tight">{project.name}</h1>
            <StatusBadge status={project.status} label={presentation.label} tone={presentation.tone} />
          </div>
          <dl className="text-text-secondary mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="flex gap-1">
              <dt className="text-text-muted">Client:</dt>
              <dd>
                <Link href={`/clients/${project.client.id}`} className="text-accent hover:underline">
                  {project.client.name}
                </Link>
              </dd>
            </div>
            {project.startDate && (
              <div className="flex gap-1">
                <dt className="text-text-muted">Start:</dt>
                <dd>{formatDateOnlyForDisplay(project.startDate)}</dd>
              </div>
            )}
            {project.endDate && (
              <div className="flex gap-1">
                <dt className="text-text-muted">End:</dt>
                <dd>{formatDateOnlyForDisplay(project.endDate)}</dd>
              </div>
            )}
            <div className="flex gap-1">
              <dt className="text-text-muted">Owner:</dt>
              <dd>{project.owner.name}</dd>
            </div>
          </dl>
        </div>

        <Link href={`/projects/${project.id}/edit`} className={ACTION_LINK_CLASSES}>
          Edit project
        </Link>
      </div>
    </div>
  );
}
