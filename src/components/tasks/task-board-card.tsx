"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
import { StatusBadge } from "@/components/ui/status-badge";
import { Select } from "@/components/ui/select";
import { GripVerticalIcon, PencilIcon } from "@/components/ui/icons";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { formatStatusLabel } from "@/lib/format";
import { isTaskOverdue } from "@/lib/tasks/overdue";
import { TaskQuickLogButton } from "@/components/tasks/task-quick-log-button";
import { updateTaskStatusAction } from "@/app/(dashboard)/tasks/board-actions";
import { TASK_STATUSES } from "@/lib/validation/task";
import { useToast } from "@/components/toast/toast-provider";
import type { TaskBoardCard as TaskBoardCardData } from "@/app/(dashboard)/tasks/board-query";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * One Task Board card. Drag is layered on top of, never a replacement
 * for, the real accessible status `<select>` every card still renders —
 * that select remains the complete, fully functional fallback for
 * keyboard/touch/assistive-technology users, and for anyone who simply
 * prefers it (mirrors LeadPipelineCard's own identical discipline).
 * `dndEnabled` (false on the mobile single-column view) is what actually
 * turns dragging on or off, via useDraggable's own `disabled` option.
 */
export function TaskBoardCard({
  task,
  dndEnabled,
  currentUserId,
}: {
  task: TaskBoardCardData;
  dndEnabled: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [, startTransition] = useTransition();
  const overdue = isTaskOverdue({ status: task.status, dueDate: task.dueDate }, new Date());

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: dndEnabled ? task.id : `mobile-${task.id}`,
    disabled: !dndEnabled,
  });

  function handleSelectChange(newStatus: string): void {
    startTransition(async () => {
      const result = await updateTaskStatusAction(task.id, newStatus);
      if (result.ok) {
        showToast("Status updated");
      } else {
        showToast(GENERIC_ERROR, "error");
      }
      router.refresh();
    });
  }

  return (
    <div
      ref={setNodeRef}
      className={`border-border-default bg-surface rounded-md border p-3 ${isDragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-start gap-2">
        {dndEnabled && (
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            type="button"
            aria-label={`Drag ${task.title}`}
            className="text-text-muted mt-0.5 cursor-grab touch-none"
          >
            <GripVerticalIcon className="h-4 w-4" />
          </button>
        )}
        <p className="text-text-primary min-w-0 flex-1 truncate text-sm font-medium">{task.title}</p>
      </div>

      <p className="text-text-secondary mt-1 truncate text-xs">{task.project.name}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={task.priority} />
        {task.assignee && <span className="text-text-secondary text-xs">{task.assignee.name}</span>}
      </div>

      {task.dueDate && (
        <p className={`mt-1 text-xs ${overdue ? "text-danger font-medium" : "text-text-secondary"}`}>
          Due {formatDateOnlyForDisplay(task.dueDate)}
          {overdue ? " · Overdue" : ""}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <label className="sr-only" htmlFor={`board-status-${task.id}`}>
          Status for {task.title}
        </label>
        <Select
          id={`board-status-${task.id}`}
          className="text-xs"
          defaultValue=""
          onChange={(event) => {
            if (event.target.value) handleSelectChange(event.target.value);
          }}
        >
          <option value="">Move to…</option>
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {formatStatusLabel(status)}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-3">
          <TaskQuickLogButton
            taskId={task.id}
            taskTitle={task.title}
            projectId={task.project.id}
            currentUserId={currentUserId}
          />
          <Link href={`/tasks/${task.id}/edit`} className={`inline-flex items-center gap-1 ${ACTION_LINK_CLASSES}`}>
            <PencilIcon className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * The floating copy `DragOverlay` renders in a portal outside the
 * scrollable column row — mirrors `LeadPipelineCardPreview`'s own
 * identical role. Static/non-interactive (no drag handlers, no status
 * select) since it only exists for the instant of a drag; the real card
 * stays in its own column's flow the whole time, only dimmed.
 */
export function TaskBoardCardPreview({ task }: { task: TaskBoardCardData }) {
  return (
    <div className="border-border-default bg-surface w-64 rounded-md border p-3 shadow-lg">
      <p className="text-text-primary truncate text-sm font-medium">{task.title}</p>
      <p className="text-text-secondary mt-1 truncate text-xs">{task.project.name}</p>
    </div>
  );
}
