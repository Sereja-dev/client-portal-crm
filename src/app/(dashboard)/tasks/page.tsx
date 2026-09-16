import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { formatStatusLabel } from "@/lib/format";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { PAGE_SIZE, getOffset, getTotalPages, type RawSearchParams } from "@/lib/list-params";
import { DeleteButton } from "@/components/ui/delete-button";
import { deleteTaskAction } from "./actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PencilIcon } from "@/components/ui/icons";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { SearchFilterBar } from "@/components/list/search-filter-bar";
import { Pagination } from "@/components/list/pagination";
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
import { TASK_STATUSES, TASK_PRIORITIES } from "@/lib/validation/task";
import { parseTaskListParams, buildTaskWhere, buildTaskOrderBy } from "./query";

// Page-owned primary call-to-action link (navigates, so a real <Link> —
// not the shared <Button>, which renders a <button>). Matches Button's
// own primary variant tokens (bg-accent/hover:bg-accent-hover/focus-ring)
// — the same constant Batch 1/2 introduced for Clients'/Invoices'
// identical pattern.
const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

const SORT_OPTIONS = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "dueDate:asc", label: "Due date (soonest)" },
  { value: "dueDate:desc", label: "Due date (latest)" },
];

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;
  const listParams = parseTaskListParams(resolvedSearchParams);

  const where = buildTaskWhere(organizationId, listParams);
  const orderBy = buildTaskOrderBy(listParams);

  const [projectCount, [tasks, total]] = await Promise.all([
    prisma.project.count({ where: { organizationId } }),
    prisma.$transaction([
      prisma.task.findMany({
        where,
        orderBy,
        skip: getOffset(listParams.page),
        take: PAGE_SIZE,
        include: {
          project: { select: { name: true, client: { select: { name: true } } } },
        },
      }),
      prisma.task.count({ where }),
    ]),
  ]);

  const totalPages = getTotalPages(total);
  const hasActiveParams = Boolean(
    listParams.q || listParams.status || listParams.priority,
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">
            Tasks
          </h1>
          <p className="text-text-secondary mt-1 text-sm">
            {total} {total === 1 ? "task" : "tasks"}
          </p>
        </div>
        {projectCount > 0 && (
          <Link href="/tasks/new" className={PRIMARY_LINK_CLASSES}>
            Add task
          </Link>
        )}
      </div>

      {projectCount > 0 && (
        <SearchFilterBar
          basePath="/tasks"
          searchValue={listParams.q}
          searchPlaceholder="Search by title or project"
          filters={[
            {
              name: "status",
              label: "Status",
              value: listParams.status ?? "",
              options: [
                { value: "", label: "All statuses" },
                ...TASK_STATUSES.map((status) => ({
                  value: status,
                  label: formatStatusLabel(status),
                })),
              ],
            },
            {
              name: "priority",
              label: "Priority",
              value: listParams.priority ?? "",
              options: [
                { value: "", label: "All priorities" },
                ...TASK_PRIORITIES.map((priority) => ({
                  value: priority,
                  label: formatStatusLabel(priority),
                })),
              ],
            },
          ]}
          sort={{ value: listParams.sortCombined, options: SORT_OPTIONS }}
          hasActiveParams={hasActiveParams}
        />
      )}

      {total === 0 ? (
        projectCount === 0 ? (
          <EmptyState
            title="You need a project first"
            description="Tasks must belong to a project. Add one before creating a task."
            action={
              <Link href="/projects/new" className={PRIMARY_LINK_CLASSES}>
                Add project
              </Link>
            }
          />
        ) : hasActiveParams ? (
          <EmptyState
            title="No matching tasks"
            description="Try a different search term or clear your filters."
            action={
              <Link href="/tasks" className={PRIMARY_LINK_CLASSES}>
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="No tasks yet"
            description="Tasks break a project down into the specific work you need to track and complete."
            action={
              <Link href="/tasks/new" className={PRIMARY_LINK_CLASSES}>
                Create your first task
              </Link>
            }
          />
        )
      ) : (
        <>
          <div className="hidden xl:block">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Title</TableHeaderCell>
                  <TableHeaderCell>Project</TableHeaderCell>
                  <TableHeaderCell>Client</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Priority</TableHeaderCell>
                  <TableHeaderCell>Due date</TableHeaderCell>
                  <TableHeaderCell>Completed</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell emphasis>{task.title}</TableCell>
                    <TableCell>{task.project.name}</TableCell>
                    <TableCell>{task.project.client.name}</TableCell>
                    <TableCell>
                      <StatusBadge status={task.status} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={task.priority} />
                    </TableCell>
                    <TableCell>
                      {task.dueDate ? formatDateOnlyForDisplay(task.dueDate) : "—"}
                    </TableCell>
                    <TableCell>
                      {task.completedAt
                        ? task.completedAt.toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell>{task.createdAt.toLocaleDateString()}</TableCell>
                    <TableCell align="right">
                      <div className="flex items-center justify-end gap-4">
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
                ))}
              </TableBody>
            </Table>
          </div>

          <RecordCardList>
            {tasks.map((task) => (
              <RecordCard key={task.id}>
                <RecordCardField label="Title" value={task.title} emphasis />
                <RecordCardField label="Project" value={task.project.name} />
                <RecordCardField label="Client" value={task.project.client.name} />
                <RecordCardField label="Status" value={<StatusBadge status={task.status} />} />
                <RecordCardField label="Priority" value={<StatusBadge status={task.priority} />} />
                <RecordCardField
                  label="Due date"
                  value={task.dueDate ? formatDateOnlyForDisplay(task.dueDate) : "—"}
                />
                <RecordCardField
                  label="Completed"
                  value={task.completedAt ? task.completedAt.toLocaleDateString() : "—"}
                />
                <RecordCardField label="Created" value={task.createdAt.toLocaleDateString()} />
                <RecordCardActions>
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
            ))}
          </RecordCardList>

          <Pagination
            basePath="/tasks"
            params={{
              ...(listParams.q ? { q: listParams.q } : {}),
              ...(listParams.status ? { status: listParams.status } : {}),
              ...(listParams.priority ? { priority: listParams.priority } : {}),
              sort: listParams.sortCombined,
            }}
            page={listParams.page}
            totalPages={totalPages}
          />
        </>
      )}
    </div>
  );
}
