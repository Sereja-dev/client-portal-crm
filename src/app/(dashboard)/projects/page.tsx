import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { formatStatusLabel } from "@/lib/format";
import { PAGE_SIZE, getOffset, getTotalPages, type RawSearchParams } from "@/lib/list-params";
import { DeleteButton } from "@/components/ui/delete-button";
import { deleteProjectAction } from "./actions";
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
import { PROJECT_STATUSES } from "@/lib/validation/project";
import {
  parseProjectListParams,
  buildProjectWhere,
  buildProjectOrderBy,
} from "./query";

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
  { value: "name:asc", label: "Name (A–Z)" },
  { value: "name:desc", label: "Name (Z–A)" },
];

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;
  const listParams = parseProjectListParams(resolvedSearchParams);

  const where = buildProjectWhere(organizationId, listParams);
  const orderBy = buildProjectOrderBy(listParams);

  const [clientCount, [projects, total]] = await Promise.all([
    prisma.client.count({ where: { organizationId } }),
    prisma.$transaction([
      prisma.project.findMany({
        where,
        orderBy,
        skip: getOffset(listParams.page),
        take: PAGE_SIZE,
        include: { client: { select: { name: true } } },
      }),
      prisma.project.count({ where }),
    ]),
  ]);

  const totalPages = getTotalPages(total);
  const hasActiveParams = Boolean(listParams.q || listParams.status);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">
            Projects
          </h1>
          <p className="text-text-secondary mt-1 text-sm">
            {total} {total === 1 ? "project" : "projects"}
          </p>
        </div>
        {clientCount > 0 && (
          <Link href="/projects/new" className={PRIMARY_LINK_CLASSES}>
            Add project
          </Link>
        )}
      </div>

      {clientCount > 0 && (
        <SearchFilterBar
          basePath="/projects"
          searchValue={listParams.q}
          searchPlaceholder="Search by name or client"
          filters={[
            {
              name: "status",
              label: "Status",
              value: listParams.status ?? "",
              options: [
                { value: "", label: "All statuses" },
                ...PROJECT_STATUSES.map((status) => ({
                  value: status,
                  label: formatStatusLabel(status),
                })),
              ],
            },
          ]}
          sort={{ value: listParams.sortCombined, options: SORT_OPTIONS }}
          hasActiveParams={hasActiveParams}
        />
      )}

      {total === 0 ? (
        clientCount === 0 ? (
          <EmptyState
            title="You need a client first"
            description="Projects must belong to a client. Add one before creating a project."
            action={
              <Link href="/clients/new" className={PRIMARY_LINK_CLASSES}>
                Add client
              </Link>
            }
          />
        ) : hasActiveParams ? (
          <EmptyState
            title="No matching projects"
            description="Try a different search term or clear your filters."
            action={
              <Link href="/projects" className={PRIMARY_LINK_CLASSES}>
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="No projects yet"
            description="Projects organize your work for a client — group related tasks together and track progress from start to finish."
            action={
              <Link href="/projects/new" className={PRIMARY_LINK_CLASSES}>
                Create your first project
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
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Client</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Start date</TableHeaderCell>
                  <TableHeaderCell>End date</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell emphasis>{project.name}</TableCell>
                    <TableCell>{project.client.name}</TableCell>
                    <TableCell>
                      <StatusBadge status={project.status} />
                    </TableCell>
                    <TableCell>
                      {project.startDate
                        ? project.startDate.toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {project.endDate
                        ? project.endDate.toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell>{project.createdAt.toLocaleDateString()}</TableCell>
                    <TableCell align="right">
                      <div className="flex items-center justify-end gap-4">
                        <Link
                          href={`/projects/${project.id}/edit`}
                          className={`inline-flex items-center gap-1 ${ACTION_LINK_CLASSES}`}
                        >
                          <PencilIcon className="h-3.5 w-3.5" />
                          Edit
                        </Link>
                        <DeleteButton
                          action={deleteProjectAction.bind(null, project.id)}
                          itemName={project.name}
                          confirmTitle="Delete project"
                          confirmDescription={`Delete ${project.name}? This action cannot be undone.`}
                          successMessage="Project deleted"
                          conflictMessage="This project can't be deleted because it has existing invoices."
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <RecordCardList>
            {projects.map((project) => (
              <RecordCard key={project.id}>
                <RecordCardField label="Name" value={project.name} emphasis />
                <RecordCardField label="Client" value={project.client.name} />
                <RecordCardField label="Status" value={<StatusBadge status={project.status} />} />
                <RecordCardField
                  label="Start date"
                  value={project.startDate ? project.startDate.toLocaleDateString() : "—"}
                />
                <RecordCardField
                  label="End date"
                  value={project.endDate ? project.endDate.toLocaleDateString() : "—"}
                />
                <RecordCardField label="Created" value={project.createdAt.toLocaleDateString()} />
                <RecordCardActions>
                  <Link
                    href={`/projects/${project.id}/edit`}
                    className={`inline-flex items-center gap-1 ${ACTION_LINK_CLASSES}`}
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                    Edit
                  </Link>
                  <DeleteButton
                    action={deleteProjectAction.bind(null, project.id)}
                    itemName={project.name}
                    confirmTitle="Delete project"
                    confirmDescription={`Delete ${project.name}? This action cannot be undone.`}
                    successMessage="Project deleted"
                    conflictMessage="This project can't be deleted because it has existing invoices."
                  />
                </RecordCardActions>
              </RecordCard>
            ))}
          </RecordCardList>

          <Pagination
            basePath="/projects"
            params={{
              ...(listParams.q ? { q: listParams.q } : {}),
              ...(listParams.status ? { status: listParams.status } : {}),
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
