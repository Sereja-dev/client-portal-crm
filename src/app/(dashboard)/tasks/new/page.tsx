import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { TaskForm } from "@/components/tasks/task-form";
import { EmptyState } from "@/components/ui/empty-state";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { parseSearchParam, type RawSearchParams } from "@/lib/list-params";
import { createTaskAction } from "./actions";

// Matches Button's own primary variant tokens — same constant used by
// the Clients/Invoices/Projects/Tasks list pages' own primary action.
const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;
  // Work Hub V1 — Project Hub's own Tasks tab links here with
  // `?projectId=` to prefill/scope the create form to the current
  // Project (read-only audit §8's own explicit requirement). Purely a
  // convenience default — the <select> still lists every one of this
  // org's own Projects, and createTaskAction still independently
  // re-verifies whatever projectId is actually submitted, exactly like
  // every other prefilled create form in this app.
  const projectId = parseSearchParam(resolvedSearchParams.projectId);
  const [projects, memberships] = await Promise.all([
    prisma.project.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, client: { select: { name: true } } },
    }),
    // Same-organization Staff members only — mirrors leads/new/page.tsx's
    // own Membership query exactly.
    prisma.membership.findMany({
      where: { organizationId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      include: { user: { select: { id: true, name: true } } },
    }),
  ]);
  const assignees = memberships.map((m) => ({ id: m.user.id, name: m.user.name }));

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">
          Add task
        </h1>
        <Link href="/tasks" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          title="You need a project first"
          description="Tasks must belong to a project. Add one before creating a task."
          action={
            <Link href="/projects/new" className={PRIMARY_LINK_CLASSES}>
              Add project
            </Link>
          }
        />
      ) : (
        <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
          <TaskForm
            action={createTaskAction}
            projects={projects.map((project) => ({
              id: project.id,
              label: `${project.name} — ${project.client.name}`,
            }))}
            assignees={assignees}
            defaultValues={projectId ? { projectId } : undefined}
          />
        </div>
      )}
    </div>
  );
}
