import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { TaskForm } from "@/components/tasks/task-form";
import { updateTaskAction } from "./actions";
import { CommentsSection } from "@/components/comments/comments-section";
import { createTaskCommentAction, editTaskCommentAction, deleteTaskCommentAction } from "./comment-actions";
import { parseSearchParam, type RawSearchParams } from "@/lib/list-params";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";

function toDateInputValue(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

export default async function EditTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const { user, organizationId, membership } = await getCurrentMembership();

  const [task, projects, memberships] = await Promise.all([
    prisma.task.findFirst({
      where: { id, project: { organizationId } },
    }),
    prisma.project.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, client: { select: { name: true } } },
    }),
    prisma.membership.findMany({
      where: { organizationId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      include: { user: { select: { id: true, name: true } } },
    }),
  ]);

  if (!task) {
    notFound();
  }
  const assignees = memberships.map((m) => ({ id: m.user.id, name: m.user.name }));

  const boundUpdateTaskAction = updateTaskAction.bind(null, task.id);
  const commentsCursor = parseSearchParam(resolvedSearchParams.commentsCursor) || undefined;
  const isModerator = membership.role === "OWNER" || membership.role === "ADMIN";

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">
          Edit task
        </h1>
        <Link href="/tasks" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <TaskForm
          action={boundUpdateTaskAction}
          projects={projects.map((project) => ({
            id: project.id,
            label: `${project.name} — ${project.client.name}`,
          }))}
          assignees={assignees}
          defaultValues={{
            title: task.title,
            description: task.description ?? "",
            projectId: task.projectId,
            status: task.status,
            priority: task.priority,
            dueDate: toDateInputValue(task.dueDate),
            assigneeId: task.assigneeId ?? "",
          }}
          submitLabel="Save changes"
          pendingLabel="Saving…"
        />
        <CommentsSection
          entityType="TASK"
          entityId={task.id}
          organizationId={organizationId}
          currentUserId={user.id}
          isModerator={isModerator}
          parentLabel="task"
          basePath={`/tasks/${task.id}/edit`}
          cursorParam="commentsCursor"
          cursor={commentsCursor}
          createAction={createTaskCommentAction.bind(null, task.id)}
          makeEditAction={(commentId) => editTaskCommentAction.bind(null, task.id, commentId)}
          makeDeleteAction={(commentId) => deleteTaskCommentAction.bind(null, task.id, commentId)}
        />
      </div>
    </div>
  );
}
