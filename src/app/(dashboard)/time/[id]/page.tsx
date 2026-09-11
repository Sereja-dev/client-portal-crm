import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getTimeEntry } from "@/lib/time-entries/entries";
import { formatDurationMinutes, splitDurationMinutes } from "@/lib/time-entries/duration";
import { canManageTimeEntry, isPrivilegedRole } from "@/lib/time-entries/permissions";
import { formatDateOnly, formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { TimeEntryForm } from "@/components/time-entries/time-entry-form";
import { ArchiveToggleButton } from "@/components/time-entries/archive-toggle-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { updateTimeEntryAction, archiveTimeEntryAction, unarchiveTimeEntryAction } from "../actions";

/**
 * Time Tracking Phase 2A — detail/edit. Scoped by id + organizationId
 * together via getTimeEntry — a foreign org's entry id simply doesn't
 * match, indistinguishable from a nonexistent one, matching every other
 * entity detail route in this app.
 *
 * `canManage` mirrors the Phase 1 domain layer's own rule exactly
 * (entry.userId === actor.id, or actor role OWNER/ADMIN) — this is a UI
 * convenience only; updateTimeEntryAction/archiveTimeEntryAction/
 * unarchiveTimeEntryAction each independently re-verify it via the
 * unchanged Phase 1 domain functions regardless of what this page
 * renders. An archived entry never shows the editable form (§"EDIT /
 * DETAIL PAGE": "do not permit normal edits while archived") — only a
 * read-only summary plus Unarchive, when authorized.
 */
export default async function TimeEntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, organizationId, membership } = await getCurrentMembership();

  const entry = await getTimeEntry(organizationId, id);
  if (!entry) {
    notFound();
  }

  const isPrivileged = isPrivilegedRole(membership.role);
  const canManage = canManageTimeEntry(entry.userId, user.id, membership.role);
  const isArchived = entry.archivedAt !== null;
  const showEditForm = canManage && !isArchived;

  const [members, projects, tasks] = await Promise.all([
    showEditForm && isPrivileged
      ? prisma.membership
          .findMany({
            where: { organizationId },
            orderBy: [{ role: "asc" }, { createdAt: "asc" }],
            include: { user: { select: { id: true, name: true } } },
          })
          .then((rows) => rows.map((m) => ({ id: m.user.id, name: m.user.name })))
      : Promise.resolve([]),
    showEditForm ? prisma.project.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    showEditForm
      ? prisma.task.findMany({ where: { organizationId }, orderBy: { title: "asc" }, select: { id: true, title: true, projectId: true } })
      : Promise.resolve([]),
  ]);

  const boundUpdateAction = updateTimeEntryAction.bind(null, entry.id);
  const { hours, minutes } = splitDurationMinutes(entry.durationMinutes);

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">
          {formatDateOnlyForDisplay(entry.workDate)}
        </h1>
        <Link href="/time" className={`${ACTION_LINK_CLASSES} shrink-0`}>
          Back to time
        </Link>
      </div>

      {isArchived && (
        <p className="border-border-strong bg-surface-recessed text-text-secondary mb-4 rounded-md border border-dashed px-4 py-3 text-sm">
          This time entry is archived.
        </p>
      )}

      {showEditForm ? (
        <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
          <TimeEntryForm
            action={boundUpdateAction}
            actorId={user.id}
            canSelectMember={isPrivileged}
            members={members}
            projects={projects}
            tasks={tasks}
            defaultValues={{
              userId: entry.userId ?? user.id,
              projectId: entry.projectId ?? "",
              taskId: entry.taskId,
              workDate: formatDateOnly(entry.workDate),
              hours,
              minutes,
              description: entry.description,
              billable: entry.billable,
            }}
            submitLabel="Save changes"
            pendingLabel="Saving…"
          />
        </div>
      ) : (
        <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Member</dt>
              <dd className="text-text-primary mt-0.5">{entry.user?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Project</dt>
              <dd className="text-text-primary mt-0.5">{entry.project?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Task</dt>
              <dd className="text-text-primary mt-0.5">{entry.task?.title ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Duration</dt>
              <dd className="text-text-primary mt-0.5">{formatDurationMinutes(entry.durationMinutes)}</dd>
            </div>
            <div>
              <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Billable</dt>
              <dd className="text-text-primary mt-0.5">{entry.billable ? "Billable" : "Non-billable"}</dd>
            </div>
            {isArchived && (
              <div>
                <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Status</dt>
                <dd className="mt-0.5">
                  <StatusBadge status="ARCHIVED" />
                </dd>
              </div>
            )}
          </dl>
          {entry.description && <p className="text-text-primary mt-4 text-sm whitespace-pre-wrap">{entry.description}</p>}
          {!canManage && (
            <p className="text-text-muted mt-4 text-xs">
              You can view this time entry, but only {entry.user?.name ?? "its owner"} or an organization owner/admin can manage it.
            </p>
          )}
        </div>
      )}

      {canManage && (
        <div className="mt-4 flex justify-end">
          <ArchiveToggleButton
            entryId={entry.id}
            isArchived={isArchived}
            archiveAction={archiveTimeEntryAction}
            unarchiveAction={unarchiveTimeEntryAction}
          />
        </div>
      )}
    </div>
  );
}
