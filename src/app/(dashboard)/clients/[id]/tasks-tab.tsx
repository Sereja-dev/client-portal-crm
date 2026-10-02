import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { RecordCardList, RecordCard, RecordCardField } from "@/components/ui/record-list";
import type { ClientTaskRow } from "./profile-query";

function formatDate(date: Date | null): string {
  return date ? date.toLocaleDateString() : "—";
}

/**
 * Task has no direct Task detail route in this app — each row links to
 * the owning Project's own Hub route instead (Work Hub V1 — was
 * `/projects/${id}/edit` before the Project Hub existed; updated to the
 * new canonical `/projects/${id}` View/Open destination), the same "no
 * route to invent, link to the existing context" choice
 * invoice-read-only-view.tsx's own Project link already makes.
 */
export function ClientTasksTab({ tasks }: { tasks: ClientTaskRow[] }) {
  if (tasks.length === 0) {
    return <EmptyState title="No tasks yet" description="Tasks from this client's projects will appear here." />;
  }

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Task</TableHeaderCell>
              <TableHeaderCell>Project</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Due</TableHeaderCell>
              <TableHeaderCell>Assignee</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell emphasis>{task.title}</TableCell>
                <TableCell>
                  <Link href={`/projects/${task.project.id}`} className={ACTION_LINK_CLASSES}>
                    {task.project.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={task.status} />
                </TableCell>
                <TableCell>{formatDate(task.dueDate)}</TableCell>
                <TableCell>{task.assignee?.name ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <RecordCardList>
        {tasks.map((task) => (
          <RecordCard key={task.id}>
            <RecordCardField label="Task" value={task.title} emphasis />
            <RecordCardField
              label="Project"
              value={
                <Link href={`/projects/${task.project.id}`} className={ACTION_LINK_CLASSES}>
                  {task.project.name}
                </Link>
              }
            />
            <RecordCardField label="Status" value={<StatusBadge status={task.status} />} />
            <RecordCardField label="Due" value={formatDate(task.dueDate)} />
            <RecordCardField label="Assignee" value={task.assignee?.name ?? "—"} />
          </RecordCard>
        ))}
      </RecordCardList>
    </>
  );
}
