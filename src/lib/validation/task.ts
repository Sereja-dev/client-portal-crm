import type { TaskFormState } from "@/types";

export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"] as const;
export type TaskStatusValue = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskPriorityValue = (typeof TASK_PRIORITIES)[number];

export type ParsedTaskInput = {
  title: string;
  description: string | null;
  projectId: string;
  status: TaskStatusValue;
  priority: TaskPriorityValue;
  dueDate: Date | null;
  /**
   * Work Hub V1 — Task.assigneeId is now real, writable schema (it was
   * previously unused scaffolding — see task-metadata.ts's own updated
   * comment). `null` means unassigned, always a legal value; a non-empty
   * value is still just client-controlled input here — the caller
   * (createTaskAction/updateTaskAction/the bulk-assignee action)
   * re-verifies it against a real Membership in this same organizationId
   * server-side, exactly like `projectId` already is, before ever writing
   * it.
   */
  assigneeId: string | null;
};

function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseTaskForm(formData: FormData): {
  values: ParsedTaskInput;
  fieldErrors: NonNullable<TaskFormState["fieldErrors"]>;
} {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const status = String(formData.get("status") ?? "TODO");
  const priority = String(formData.get("priority") ?? "MEDIUM");
  const dueDateRaw = String(formData.get("dueDate") ?? "").trim();
  // Empty string (the <select>'s own "Unassigned" option) means null —
  // never a validation error; this field is always optional.
  const assigneeIdRaw = String(formData.get("assigneeId") ?? "").trim();

  const fieldErrors: NonNullable<TaskFormState["fieldErrors"]> = {};

  if (!title) {
    fieldErrors.title = "Title is required.";
  }

  if (!projectId) {
    fieldErrors.projectId = "Select a project.";
  }

  const isValidStatus = TASK_STATUSES.includes(status as TaskStatusValue);
  if (!isValidStatus) {
    fieldErrors.status = "Select a valid status.";
  }

  const isValidPriority = TASK_PRIORITIES.includes(
    priority as TaskPriorityValue,
  );
  if (!isValidPriority) {
    fieldErrors.priority = "Select a valid priority.";
  }

  if (dueDateRaw && !parseDate(dueDateRaw)) {
    fieldErrors.dueDate = "Enter a valid due date.";
  }

  return {
    values: {
      title,
      description: description || null,
      projectId,
      status: isValidStatus ? (status as TaskStatusValue) : "TODO",
      priority: isValidPriority ? (priority as TaskPriorityValue) : "MEDIUM",
      dueDate: parseDate(dueDateRaw),
      assigneeId: assigneeIdRaw || null,
    },
    fieldErrors,
  };
}

/**
 * Becoming DONE sets completedAt only if it isn't already set (so re-saving
 * an already-DONE task doesn't bump the timestamp). Moving away from DONE
 * always clears it.
 */
export function deriveCompletedAt(
  newStatus: TaskStatusValue,
  currentCompletedAt: Date | null,
): Date | null {
  if (newStatus === "DONE") {
    return currentCompletedAt ?? new Date();
  }
  return null;
}
