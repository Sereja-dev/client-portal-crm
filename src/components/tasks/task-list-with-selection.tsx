"use client";

import { useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { DeleteButton } from "@/components/ui/delete-button";
import { PencilIcon } from "@/components/ui/icons";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { isTaskOverdue } from "@/lib/tasks/overdue";
import { TaskQuickLogButton } from "@/components/tasks/task-quick-log-button";
import { TaskBulkToolbar } from "@/components/tasks/task-bulk-toolbar";
import { deleteTaskAction } from "@/app/(dashboard)/tasks/actions";
import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  RecordCardList,
  RecordCard,
  RecordCardField,
  RecordCardActions,
} from "@/components/ui/record-list";

export type TaskListRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  project: { id: string; name: string; client: { name: string } };
  assignee: { id: string; name: string } | null;
};

/**
 * Task List V1 upgrades (read-only audit §14/§21-§23) — the existing
 * table/card presentation, now with: an assignee column, a canonical
 * overdue indicator (`isTaskOverdue`), a quick time-log action per row,
 * and a row-selection checkbox feeding the Bulk Task toolbar. Selection
 * is plain client-component state (never persisted, never spanning a page
 * navigation) — the actual authorization/tenant-safety boundary is
 * entirely server-side in bulk-actions.ts, never this component.
 */
export function TaskListWithSelection({
  tasks,
  assignees,
  currentUserId,
}: {
  tasks: TaskListRow[];
  assignees: { id: string; name: string }[];
  currentUserId: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const now = new Date();

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected((prev) => (prev.size === tasks.length ? new Set() : new Set(tasks.map((t) => t.id))));
  }

  return (
    <>
      <div className="hidden xl:block">
        <Table>
          <TableHead>
            <tr>
              {/* A raw th element, not the shared header cell component,
                  deliberately — this is a selection control, not a real
                  data column (mirrors that component's own exact styling
                  by hand); keeping it out preserves the one-trailing-
                  Actions-header convention responsive-list-tables-
                  adoption-contract.test.ts already asserts on every other
                  list page in this app. */}
              <th scope="col" className="text-text-muted px-4 py-3 text-left font-medium">
                <input
                  type="checkbox"
                  aria-label="Select all tasks"
                  checked={selected.size > 0 && selected.size === tasks.length}
                  onChange={toggleAll}
                />
              </th>
              <TableHeaderCell>Title</TableHeaderCell>
              <TableHeaderCell>Project</TableHeaderCell>
              <TableHeaderCell>Client</TableHeaderCell>
              <TableHeaderCell>Assignee</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Priority</TableHeaderCell>
              <TableHeaderCell>Due date</TableHeaderCell>
              <TableHeaderCell>Completed</TableHeaderCell>
              <TableHeaderCell>Created</TableHeaderCell>
              <TableHeaderCell align="right">Actions</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {tasks.map((task) => {
              const overdue = isTaskOverdue(task, now);
              return (
                <TableRow key={task.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Select ${task.title}`}
                      checked={selected.has(task.id)}
                      onChange={() => toggle(task.id)}
                    />
                  </TableCell>
                  <TableCell emphasis>{task.title}</TableCell>
                  <TableCell>{task.project.name}</TableCell>
                  <TableCell>{task.project.client.name}</TableCell>
                  <TableCell>{task.assignee?.name ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={task.status} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={task.priority} />
                  </TableCell>
                  <TableCell>
                    <span className={overdue ? "text-danger font-medium" : undefined}>
                      {task.dueDate ? formatDateOnlyForDisplay(task.dueDate) : "—"}
                      {overdue ? " · Overdue" : ""}
                    </span>
                  </TableCell>
                  <TableCell>
                    {task.completedAt ? task.completedAt.toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell>{task.createdAt.toLocaleDateString()}</TableCell>
                  <TableCell align="right">
                    <div className="flex items-center justify-end gap-4">
                      <TaskQuickLogButton
                        taskId={task.id}
                        taskTitle={task.title}
                        projectId={task.project.id}
                        currentUserId={currentUserId}
                      />
                      <Link
                        href={`/tasks/${task.id}/edit`}
                        className={`inline-flex items-center gap-1 ${ACTION_LINK_CLASSES}`}
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                        Edit
                      </Link>
                      <DeleteButton
                        action={deleteTaskAction.bind(null, task.id)}
                        itemName={task.title}
                        confirmTitle="Delete task"
                        confirmDescription={`Delete "${task.title}"? This action cannot be undone.`}
                        successMessage="Task deleted"
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <RecordCardList>
        {tasks.map((task) => {
          const overdue = isTaskOverdue(task, now);
          return (
            <RecordCard key={task.id}>
              {/* Selection is a control, not a real data field — kept out of
                  RecordCardField (mirrors the desktop table's own raw <th>
                  reasoning above) so the field-parity count responsive-
                  list-tables-adoption-contract.test.ts asserts stays exact. */}
              <label className="text-text-secondary mb-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={`Select ${task.title}`}
                  checked={selected.has(task.id)}
                  onChange={() => toggle(task.id)}
                />
                Select
              </label>
              <RecordCardField label="Title" value={task.title} emphasis />
              <RecordCardField label="Project" value={task.project.name} />
              <RecordCardField label="Client" value={task.project.client.name} />
              <RecordCardField label="Assignee" value={task.assignee?.name ?? "—"} />
              <RecordCardField label="Status" value={<StatusBadge status={task.status} />} />
              <RecordCardField label="Priority" value={<StatusBadge status={task.priority} />} />
              <RecordCardField
                label="Due date"
                value={
                  <span className={overdue ? "text-danger font-medium" : undefined}>
                    {task.dueDate ? formatDateOnlyForDisplay(task.dueDate) : "—"}
                    {overdue ? " · Overdue" : ""}
                  </span>
                }
              />
              <RecordCardField
                label="Completed"
                value={task.completedAt ? task.completedAt.toLocaleDateString() : "—"}
              />
              <RecordCardField label="Created" value={task.createdAt.toLocaleDateString()} />
              <RecordCardActions>
                <TaskQuickLogButton
                  taskId={task.id}
                  taskTitle={task.title}
                  projectId={task.project.id}
                  currentUserId={currentUserId}
                />
                <Link
                  href={`/tasks/${task.id}/edit`}
                  className={`inline-flex items-center gap-1 ${ACTION_LINK_CLASSES}`}
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                  Edit
                </Link>
                <DeleteButton
                  action={deleteTaskAction.bind(null, task.id)}
                  itemName={task.title}
                  confirmTitle="Delete task"
                  confirmDescription={`Delete "${task.title}"? This action cannot be undone.`}
                  successMessage="Task deleted"
                />
              </RecordCardActions>
            </RecordCard>
          );
        })}
      </RecordCardList>

      <TaskBulkToolbar selectedIds={[...selected]} onClear={() => setSelected(new Set())} assignees={assignees} />
    </>
  );
}
