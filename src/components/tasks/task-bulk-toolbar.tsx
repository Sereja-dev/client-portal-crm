"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { TASK_STATUSES, TASK_PRIORITIES } from "@/lib/validation/task";
import { formatStatusLabel } from "@/lib/format";
import { bulkUpdateTaskStatusAction, bulkUpdateTaskAssigneeAction, bulkUpdateTaskPriorityAction } from "@/app/(dashboard)/tasks/bulk-actions";
import { TASK_BULK_MAX } from "@/lib/tasks/bulk-types";
import { useToast } from "@/components/toast/toast-provider";

/**
 * Bulk Task actions V1 — List view only (read-only audit §10/§21). Three
 * allowed actions: status, assignee, priority — never delete/archive/
 * due-date/project-move (deferred as destructive/ambiguous). Selection is
 * plain client component state, scoped to the current page's own rendered
 * rows — never persisted, never spanning a page navigation. The server
 * action itself independently re-verifies every id's own organization and
 * enforces `TASK_BULK_MAX` regardless of what this toolbar already limits
 * client-side (never trusted alone).
 */
export function TaskBulkToolbar({
  selectedIds,
  onClear,
  assignees,
}: {
  selectedIds: string[];
  onClear: () => void;
  assignees: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<"" | "status" | "assignee" | "priority">("");
  const [value, setValue] = useState("");

  if (selectedIds.length === 0) return null;

  function reportResult(result: { updatedCount: number; failedCount: number }): void {
    if (result.failedCount === 0) {
      showToast(`Updated ${result.updatedCount} task${result.updatedCount === 1 ? "" : "s"}`);
    } else {
      showToast(`Updated ${result.updatedCount}, ${result.failedCount} failed`, "error");
    }
    onClear();
    router.refresh();
  }

  function apply(): void {
    if (!action) return;
    startTransition(async () => {
      if (action === "status") {
        reportResult(await bulkUpdateTaskStatusAction(selectedIds, value));
      } else if (action === "priority") {
        reportResult(await bulkUpdateTaskPriorityAction(selectedIds, value));
      } else if (action === "assignee") {
        reportResult(await bulkUpdateTaskAssigneeAction(selectedIds, value || null));
      }
    });
  }

  return (
    <div className="border-border-default bg-surface sticky bottom-4 z-10 mt-4 flex flex-wrap items-center gap-3 rounded-lg border p-4 shadow-lg">
      <span className="text-text-primary text-sm font-medium">
        {selectedIds.length} selected
        {selectedIds.length >= TASK_BULK_MAX && ` (max ${TASK_BULK_MAX})`}
      </span>

      <Select
        aria-label="Bulk action"
        value={action}
        onChange={(event) => {
          setAction(event.target.value as typeof action);
          setValue("");
        }}
      >
        <option value="">Choose action…</option>
        <option value="status">Change status</option>
        <option value="assignee">Change assignee</option>
        <option value="priority">Change priority</option>
      </Select>

      {action === "status" && (
        <Select aria-label="New status" value={value} onChange={(event) => setValue(event.target.value)}>
          <option value="">Select status</option>
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {formatStatusLabel(status)}
            </option>
          ))}
        </Select>
      )}

      {action === "priority" && (
        <Select aria-label="New priority" value={value} onChange={(event) => setValue(event.target.value)}>
          <option value="">Select priority</option>
          {TASK_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {formatStatusLabel(priority)}
            </option>
          ))}
        </Select>
      )}

      {action === "assignee" && (
        <Select aria-label="New assignee" value={value} onChange={(event) => setValue(event.target.value)}>
          <option value="">Unassigned</option>
          {assignees.map((assignee) => (
            <option key={assignee.id} value={assignee.id}>
              {assignee.name}
            </option>
          ))}
        </Select>
      )}

      <button
        type="button"
        onClick={apply}
        disabled={!action || (action !== "assignee" && !value) || pending}
        className="focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {pending ? "Applying…" : "Apply"}
      </button>

      <button type="button" onClick={onClear} className="text-text-secondary text-sm hover:underline">
        Clear selection
      </button>
    </div>
  );
}
