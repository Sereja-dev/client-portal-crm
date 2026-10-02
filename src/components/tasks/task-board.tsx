"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { TASK_STATUSES } from "@/lib/validation/task";
import { formatStatusLabel } from "@/lib/format";
import { updateTaskStatusAction } from "@/app/(dashboard)/tasks/board-actions";
import { buildTasksHref } from "@/app/(dashboard)/tasks/view-params";
import { TaskBoardCard, TaskBoardCardPreview } from "./task-board-card";
import { useToast } from "@/components/toast/toast-provider";
import type { TaskBoardColumn, TaskBoardCard as TaskBoardCardData } from "@/app/(dashboard)/tasks/board-query";

const GENERIC_ERROR = "Something went wrong. Please try again.";

type PreservedParams = Record<string, string | undefined>;

/**
 * Task Board V1 — mirrors Leads Pipeline's own proven DnD architecture
 * (read-only audit §7/§18): one shared `DndContext` for both the desktop
 * multi-column board and the mobile single-status switcher (so
 * `TaskBoardCard`'s own `useDraggable()` call — made unconditionally, per
 * React's Rules of Hooks — always has a real context ancestor;
 * `dndEnabled` is what actually turns dragging on/off). A real
 * `DragOverlay` (not a bare CSS transform on the card's own list slot) —
 * see LeadPipelineBoard's own doc comment for the exact runaway-
 * autoscroll-feedback-loop bug this avoids. No optimistic local state is
 * ever mutated on drop — the board only re-renders once the server
 * actually confirms a change via `router.refresh()`, so a failed or
 * no-op drop can never leave a card visually stranded in the wrong
 * column (identical discipline to LeadPipelineBoard's own handleDragEnd).
 *
 * There is no position/ordering field on Task — dropping a card into a
 * DIFFERENT column changes its status; dropping it back into its own
 * column, or an unrecognized target, is a plain no-op.
 */
export function TaskBoard({
  columns,
  preservedParams,
  currentUserId,
  mobileStatus,
}: {
  columns: TaskBoardColumn[];
  preservedParams: PreservedParams;
  currentUserId: string;
  mobileStatus: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [, startTransition] = useTransition();
  const [activeTask, setActiveTask] = useState<TaskBoardCardData | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragStart(event: DragStartEvent): void {
    const taskId = String(event.active.id);
    const task = columns.flatMap((column) => column.cards).find((c) => c.id === taskId);
    setActiveTask(task ?? null);
  }

  function handleDragEnd(event: DragEndEvent): void {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const targetStatus = String(over.id);
    if (!TASK_STATUSES.includes(targetStatus as (typeof TASK_STATUSES)[number])) return;

    startTransition(async () => {
      const result = await updateTaskStatusAction(taskId, targetStatus);
      if (result.ok) {
        showToast("Status updated");
      } else {
        showToast(GENERIC_ERROR, "error");
      }
      router.refresh();
    });
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveTask(null)}>
      <div className="hidden md:block">
        <div className="flex gap-4 overflow-x-auto pb-2">
          {columns.map((column) => (
            <BoardColumn
              key={column.status}
              column={column}
              dndEnabled
              currentUserId={currentUserId}
              preservedParams={preservedParams}
            />
          ))}
        </div>
      </div>

      <div className="md:hidden">
        <nav aria-label="Task status" className="flex gap-2 overflow-x-auto pb-2">
          {TASK_STATUSES.map((status) => (
            <Link
              key={status}
              href={buildTasksHref({ ...preservedParams, view: "board", boardStatus: status })}
              aria-current={status === mobileStatus ? "page" : undefined}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium ${
                status === mobileStatus ? "bg-accent text-white" : "bg-surface-recessed text-text-secondary"
              }`}
            >
              {formatStatusLabel(status)}
            </Link>
          ))}
        </nav>
        {columns
          .filter((column) => column.status === mobileStatus)
          .map((column) => (
            <BoardColumn
              key={column.status}
              column={column}
              dndEnabled={false}
              currentUserId={currentUserId}
              preservedParams={preservedParams}
            />
          ))}
      </div>

      <DragOverlay>{activeTask && <TaskBoardCardPreview task={activeTask} />}</DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  column,
  dndEnabled,
  currentUserId,
  preservedParams,
}: {
  column: TaskBoardColumn;
  dndEnabled: boolean;
  currentUserId: string;
  preservedParams: PreservedParams;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status, disabled: !dndEnabled });
  const headingId = `board-column-${column.status}`;

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={`border-border-default bg-surface-recessed w-72 min-w-0 shrink-0 rounded-lg border p-3 transition-colors md:w-72 ${
        isOver ? "ring-accent ring-2" : ""
      }`}
    >
      <h3 id={headingId} className="text-text-primary flex items-center justify-between text-sm font-semibold">
        {formatStatusLabel(column.status)}
        <span className="text-text-muted text-xs tabular-nums">{column.total}</span>
      </h3>

      <div className="mt-3 space-y-2">
        {column.cards.length === 0 ? (
          <p className="text-text-muted text-xs">No tasks</p>
        ) : (
          column.cards.map((task) => (
            <TaskBoardCard key={task.id} task={task} dndEnabled={dndEnabled} currentUserId={currentUserId} />
          ))
        )}
      </div>

      {column.truncated && (
        <p className="text-text-muted mt-2 text-xs">
          Showing {column.cards.length} of {column.total}.{" "}
          <Link
            href={buildTasksHref({ ...preservedParams, view: "list", status: column.status })}
            className="text-accent hover:underline"
          >
            See all
          </Link>
        </p>
      )}
    </section>
  );
}
