import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { WorkTabs } from "@/components/work/work-tabs";
import { prisma } from "@/lib/prisma";
import { formatStatusLabel } from "@/lib/format";
import { PAGE_SIZE, getOffset, getTotalPages, type RawSearchParams } from "@/lib/list-params";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchFilterBar } from "@/components/list/search-filter-bar";
import { Pagination } from "@/components/list/pagination";
import { TASK_STATUSES, TASK_PRIORITIES } from "@/lib/validation/task";
import { parseTaskListParams, buildTaskWhere, buildTaskOrderBy, type TaskListParams } from "./query";
import { parseTaskView, parseBoardMobileStatus, buildTasksHref } from "./view-params";
import { fetchTaskBoardColumns } from "./board-query";
import { TaskListWithSelection, type TaskListRow } from "@/components/tasks/task-list-with-selection";
import { TaskBoard } from "@/components/tasks/task-board";

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

/**
 * Work Hub V1 — the four requested quick filters, as plain toggle links
 * preserving every other active param (buildTasksHref's own "omit falsy,
 * keep the rest" contract) — never a control that silently erases an
 * unrelated filter (read-only audit §15/§16's own explicit requirement).
 * "High priority" and the existing Priority dropdown both just set the
 * same `?priority=` param — two entry points into one piece of state,
 * never a second, competing filter.
 */
function QuickFilterChip({ label, active, href }: { label: string; active: boolean; href: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active ? "bg-accent text-white" : "bg-surface-recessed text-text-secondary hover:bg-[var(--hover)]"
      }`}
    >
      {label}
    </Link>
  );
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { user, organizationId } = await getCurrentMembership();
  const resolvedSearchParams = await searchParams;
  const listParams = parseTaskListParams(resolvedSearchParams);
  const view = parseTaskView(resolvedSearchParams);
  const mobileStatus = parseBoardMobileStatus(resolvedSearchParams);
  const now = new Date();

  const preservedParams = {
    q: listParams.q || undefined,
    status: listParams.status,
    priority: listParams.priority,
    overdue: listParams.overdue ? "true" : undefined,
    mine: listParams.mine ? "true" : undefined,
    dueThisWeek: listParams.dueThisWeek ? "true" : undefined,
    sort: listParams.sortCombined,
  };

  const [projectCount, memberships] = await Promise.all([
    prisma.project.count({ where: { organizationId } }),
    prisma.membership.findMany({
      where: { organizationId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      include: { user: { select: { id: true, name: true } } },
    }),
  ]);
  const assignees = memberships.map((m) => ({ id: m.user.id, name: m.user.name }));

  const where = buildTaskWhere(organizationId, listParams, now, user.id);

  const hasActiveParams = Boolean(
    listParams.q || listParams.status || listParams.priority || listParams.overdue || listParams.mine || listParams.dueThisWeek,
  );

  // A single, cheap count decides the header text, the empty-state
  // branch, and whether List/Board even has anything to render — shared
  // by both views (Board is never a second, parallel filter
  // implementation; List's own pagination below re-derives its own count
  // inside its own established `$transaction([find, count])`, left
  // untouched — read-only audit §28's own explicit "do not 'fix' the
  // existing safe two-query pagination pattern").
  const total = await prisma.task.count({ where });

  return (
    <div>
      <WorkTabs />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-text-secondary mt-1 text-sm">
            {listParams.overdue ? `${total} overdue ${total === 1 ? "task" : "tasks"}` : `${total} ${total === 1 ? "task" : "tasks"}`}
          </p>
        </div>
        {projectCount > 0 && (
          <Link href="/tasks/new" className={PRIMARY_LINK_CLASSES}>
            Add task
          </Link>
        )}
      </div>

      {projectCount > 0 && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <QuickFilterChip
              label="My tasks"
              active={listParams.mine}
              href={buildTasksHref({ ...preservedParams, view, mine: listParams.mine ? undefined : "true" })}
            />
            <QuickFilterChip
              label="Overdue"
              active={listParams.overdue}
              href={buildTasksHref({ ...preservedParams, view, overdue: listParams.overdue ? undefined : "true" })}
            />
            <QuickFilterChip
              label="Due this week"
              active={listParams.dueThisWeek}
              href={buildTasksHref({ ...preservedParams, view, dueThisWeek: listParams.dueThisWeek ? undefined : "true" })}
            />
            <QuickFilterChip
              label="High priority"
              active={listParams.priority === "HIGH"}
              href={buildTasksHref({ ...preservedParams, view, priority: listParams.priority === "HIGH" ? undefined : "HIGH" })}
            />
          </div>

          <div className="mt-4 flex gap-2">
            <Link
              href={buildTasksHref({ ...preservedParams, view: "list" })}
              aria-current={view === "list" ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === "list" ? "bg-accent text-white" : "bg-surface-recessed text-text-secondary"}`}
            >
              List
            </Link>
            <Link
              href={buildTasksHref({ ...preservedParams, view: "board" })}
              aria-current={view === "board" ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === "board" ? "bg-accent text-white" : "bg-surface-recessed text-text-secondary"}`}
            >
              Board
            </Link>
          </div>

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
                  ...TASK_STATUSES.map((status) => ({ value: status, label: formatStatusLabel(status) })),
                ],
              },
              {
                name: "priority",
                label: "Priority",
                value: listParams.priority ?? "",
                options: [
                  { value: "", label: "All priorities" },
                  ...TASK_PRIORITIES.map((priority) => ({ value: priority, label: formatStatusLabel(priority) })),
                ],
              },
            ]}
            sort={view === "list" ? { value: listParams.sortCombined, options: SORT_OPTIONS } : undefined}
            hasActiveParams={hasActiveParams}
            hiddenFields={[
              ...(listParams.overdue ? [{ name: "overdue", value: "true" }] : []),
              ...(listParams.mine ? [{ name: "mine", value: "true" }] : []),
              ...(listParams.dueThisWeek ? [{ name: "dueThisWeek", value: "true" }] : []),
              ...(view !== "list" ? [{ name: "view", value: view }] : []),
            ]}
          />
        </>
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
      ) : view === "board" ? (
        <div className="mt-6">
          <TaskBoard
            columns={await fetchTaskBoardColumns(organizationId, listParams, now, user.id)}
            preservedParams={preservedParams}
            currentUserId={user.id}
            mobileStatus={mobileStatus}
          />
        </div>
      ) : (
        <TasksListSection
          organizationId={organizationId}
          listParams={listParams}
          currentUserId={user.id}
          assignees={assignees}
          preservedParams={preservedParams}
        />
      )}
    </div>
  );
}

async function TasksListSection({
  organizationId,
  listParams,
  currentUserId,
  assignees,
  preservedParams,
}: {
  organizationId: string;
  listParams: TaskListParams;
  currentUserId: string;
  assignees: { id: string; name: string }[];
  preservedParams: Record<string, string | undefined>;
}) {
  const now = new Date();
  const where = buildTaskWhere(organizationId, listParams, now, currentUserId);
  const orderBy = buildTaskOrderBy(listParams);

  // The existing, established, safe two-query pagination transaction —
  // left exactly as it always was (read-only audit §28's own explicit
  // instruction not to "fix" it).
  const [tasks, total] = await prisma.$transaction([
    prisma.task.findMany({
      where,
      orderBy,
      skip: getOffset(listParams.page),
      take: PAGE_SIZE,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        completedAt: true,
        createdAt: true,
        project: { select: { id: true, name: true, client: { select: { name: true } } } },
        assignee: { select: { id: true, name: true } },
      },
    }),
    prisma.task.count({ where }),
  ]);

  // Pagination's own params contract is a plain Record<string,string> —
  // strip the undefined-valued keys `preservedParams` otherwise carries
  // (buildTasksHref's own consumers are fine with undefined; this is the
  // one stricter consumer).
  const paginationParams = Object.fromEntries(
    Object.entries(preservedParams).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  return (
    <>
      <TaskListWithSelection tasks={tasks as TaskListRow[]} assignees={assignees} currentUserId={currentUserId} />
      <Pagination basePath="/tasks" params={paginationParams} page={listParams.page} totalPages={getTotalPages(total)} />
    </>
  );
}
