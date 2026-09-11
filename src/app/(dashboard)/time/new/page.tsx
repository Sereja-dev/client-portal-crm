import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { TimeEntryForm } from "@/components/time-entries/time-entry-form";
import { isPrivilegedRole } from "@/lib/time-entries/permissions";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { createTimeEntryAction } from "../actions";

/**
 * Time Tracking Phase 2A — "Log time". A MEMBER never sees a member
 * selector at all (TimeEntryForm's own canSelectMember=false path) —
 * the Server Action still independently re-verifies this regardless of
 * what's rendered.
 */
export default async function NewTimeEntryPage() {
  const { user, organizationId, membership } = await getCurrentMembership();
  const canSelectMember = isPrivilegedRole(membership.role);

  const [members, projects, tasks] = await Promise.all([
    canSelectMember
      ? prisma.membership
          .findMany({
            where: { organizationId },
            orderBy: [{ role: "asc" }, { createdAt: "asc" }],
            include: { user: { select: { id: true, name: true } } },
          })
          .then((rows) => rows.map((m) => ({ id: m.user.id, name: m.user.name })))
      : Promise.resolve([]),
    prisma.project.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.task.findMany({
      where: { organizationId },
      orderBy: { title: "asc" },
      select: { id: true, title: true, projectId: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Log time</h1>
        <Link href="/time" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <TimeEntryForm
          action={createTimeEntryAction}
          actorId={user.id}
          canSelectMember={canSelectMember}
          members={members}
          projects={projects}
          tasks={tasks}
          submitLabel="Log time"
          pendingLabel="Logging…"
        />
      </div>
    </div>
  );
}
