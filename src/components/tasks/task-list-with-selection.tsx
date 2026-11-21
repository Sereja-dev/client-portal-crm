"use client";

import { useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { DeleteButton } from "@/components/ui/delete-button";
import { RowActionMenu, RowActionMenuItem } from "@/components/ui/row-action-menu";
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
                  list page in this app. Padding matches TableHeaderCell's
                  own `dense` below — see this table's own `dense` usage
                  comment on the first real column header. */}
              <th scope="col" className="text-text-muted px-3 py-3 text-left font-medium">
                <input
                  type="checkbox"
                  aria-label="Select all tasks"
                  checked={selected.size > 0 && selected.size === tasks.length}
                  onChange={toggleAll}
                />
              </th>
              {/* `dense` (px-4 → px-3) on every header/cell in this table only —
                  see TableHeaderCell/TableCell's own doc comments. The Tasks
                  table has grown to 11 header cells since this `xl`/1280px
                  breakpoint was sized, leaving close to zero real margin at
                  the default content width (see responsive-list-tables-
                  breakpoint.spec.ts's own header comment); this is the
                  narrowly-scoped, measured recovery of some of that margin,
                  not a density change applied to any other table. */}
              <TableHeaderCell dense>Title</TableHeaderCell>
              <TableHeaderCell dense>Project</TableHeaderCell>
              <TableHeaderCell dense>Client</TableHeaderCell>
              <TableHeaderCell dense>Assignee</TableHeaderCell>
              <TableHeaderCell dense>Status</TableHeaderCell>
              <TableHeaderCell dense>Priority</TableHeaderCell>
              <TableHeaderCell dense>Due date</TableHeaderCell>
              <TableHeaderCell dense>Completed</TableHeaderCell>
              <TableHeaderCell dense>Created</TableHeaderCell>
              <TableHeaderCell dense align="right">Actions</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {tasks.map((task) => {
              const overdue = isTaskOverdue(task, now);
              return (
                <TableRow key={task.id}>
                  <TableCell dense>
                    <input
                      type="checkbox"
                      aria-label={`Select ${task.title}`}
                      checked={selected.has(task.id)}
                      onChange={() => toggle(task.id)}
                    />
                  </TableCell>
                  <TableCell dense emphasis>{task.title}</TableCell>
                  <TableCell dense>{task.project.name}</TableCell>
                  <TableCell dense>{task.project.client.name}</TableCell>
                  <TableCell dense>{task.assignee?.name ?? "—"}</TableCell>
                  <TableCell dense>
                    <StatusBadge status={task.status} />
                  </TableCell>
                  <TableCell dense>
                    <StatusBadge status={task.priority} />
                  </TableCell>
                  <TableCell dense>
                    <span className={overdue ? "text-danger font-medium" : undefined}>
                      {task.dueDate ? formatDateOnlyForDisplay(task.dueDate) : "—"}
                      {overdue ? " · Overdue" : ""}
                    </span>
                  </TableCell>
                  <TableCell dense>
                    {task.completedAt ? task.completedAt.toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell dense>{task.createdAt.toLocaleDateString()}</TableCell>
                  <TableCell dense align="right">
                    {/* gap-4 → gap-3: matches this table's own `dense` padding
                        reduction above — a few px less space between the
                        three Actions controls, not a change to their own
                        size or labels. */}
                    <div className="flex items-center justify-end gap-3">
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
                      <RowActionMenu label={`More actions for task ${task.title}`}>
                        <RowActionMenuItem>
                          <DeleteButton
                            action={deleteTaskAction.bind(null, task.id)}
                            itemName={task.title}
                            confirmTitle="Delete task"
                            confirmDescription={`Delete "${task.title}"? This action cannot be undone.`}
                            successMessage="Task deleted"
                          />
                        </RowActionMenuItem>
                      </RowActionMenu>
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
                <RowActionMenu label={`More actions for task ${task.title}`}>
                  <RowActionMenuItem>
                    <DeleteButton
                      action={deleteTaskAction.bind(null, task.id)}
                      itemName={task.title}
                      confirmTitle="Delete task"
                      confirmDescription={`Delete "${task.title}"? This action cannot be undone.`}
                      successMessage="Task deleted"
                    />
                  </RowActionMenuItem>
                </RowActionMenu>
              </RecordCardActions>
            </RecordCard>
          );
        })}
      </RecordCardList>

      <TaskBulkToolbar selectedIds={[...selected]} onClear={() => setSelected(new Set())} assignees={assignees} />
    </>
  );
}
