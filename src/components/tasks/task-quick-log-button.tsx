"use client";

import { useRef } from "react";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { TaskQuickLogDialog, type TaskQuickLogDialogHandle } from "./task-quick-log-dialog";

/**
 * Work Hub V1 — the small "Log time" trigger + its dialog, as one unit so
 * the Task List, a Task Board card, and the Project Hub's own Tasks tab
 * can each drop in a single component per row rather than re-wiring a
 * ref/handle themselves.
 */
export function TaskQuickLogButton({
  taskId,
  taskTitle,
  projectId,
  currentUserId,
}: {
  taskId: string;
  taskTitle: string;
  projectId: string;
  currentUserId: string;
}) {
  const dialogRef = useRef<TaskQuickLogDialogHandle>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.open()}
        className={ACTION_LINK_CLASSES}
      >
        Log time
      </button>
      <TaskQuickLogDialog
        ref={dialogRef}
        taskId={taskId}
        taskTitle={taskTitle}
        projectId={projectId}
        currentUserId={currentUserId}
      />
    </>
  );
}
