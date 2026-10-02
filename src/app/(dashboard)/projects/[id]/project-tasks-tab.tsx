import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { PencilIcon } from "@/components/ui/icons";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { isTaskOverdue } from "@/lib/tasks/overdue";
import { TaskQuickLogButton } from "@/components/tasks/task-quick-log-button";
import type { ProjectTaskRow } from "./profile-query";
import { PROJECT_TAB_ROW_BOUND } from "./profile-query";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/**
 * Project Hub V1 — the Tasks tab. Reuses the exact same Task domain/
 * presentation this app already has everywhere else (StatusBadge, the
 * canonical `isTaskOverdue` rule, the shared quick-log dialog) — never a
 * second, parallel Task rendering implementation (read-only audit §8's
 * own explicit instruction). "Add task" prefills `?projectId=` so the
 * create form opens already scoped to this Project.
 */
export function ProjectTasksTab({
  projectId,
  tasks,
  currentUserId,
  now,
}: {
  projectId: string;
  tasks: ProjectTaskRow[];
  currentUserId: string;
  now: Date;
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link href={`/tasks/new?projectId=${projectId}`} className={PRIMARY_LINK_CLASSES}>
          Add task
        </Link>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          description="Break this project down into the specific work you need to track and complete."
          action={
            <Link href={`/tasks/new?projectId=${projectId}`} className={PRIMARY_LINK_CLASSES}>
              Add task
            </Link>
          }
        />
      ) : (
        <ul className="divide-border-subtle border-border-default divide-y rounded-lg border">
          {tasks.map((task) => {
            const overdue = isTaskOverdue(task, now);
            return (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-text-primary truncate text-sm font-medium">{task.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <StatusBadge status={task.status} />
                    <StatusBadge status={task.priority} />
                    {task.assignee && <span className="text-text-secondary">{task.assignee.name}</span>}
                    {task.dueDate && (
                      <span className={overdue ? "text-danger font-medium" : "text-text-secondary"}>
                        Due {formatDateOnlyForDisplay(task.dueDate)}
                        {overdue ? " · Overdue" : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <TaskQuickLogButton
                    taskId={task.id}
                    taskTitle={task.title}
                    projectId={projectId}
                    currentUserId={currentUserId}
                  />
                  <Link
                    href={`/tasks/${task.id}/edit`}
                    className={`inline-flex items-center gap-1 ${ACTION_LINK_CLASSES}`}
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                    Edit
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {tasks.length === PROJECT_TAB_ROW_BOUND && (
        <p className="text-text-muted text-xs">
          Showing the most recent {PROJECT_TAB_ROW_BOUND} tasks.{" "}
          <Link href={`/tasks?projectId=${projectId}`} className="text-accent hover:underline">
            See all tasks for this project
          </Link>
          .
        </p>
      )}
    </div>
  );
}
