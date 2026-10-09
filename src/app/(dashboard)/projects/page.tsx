import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { WorkTabs } from "@/components/work/work-tabs";
import { prisma } from "@/lib/prisma";
import { PAGE_SIZE, getOffset, getTotalPages, buildFilterOptionsWithUnavailableValue, type RawSearchParams } from "@/lib/list-params";
import { listCustomStatusDefinitions } from "@/lib/custom-statuses/definitions";
import { DeleteButton } from "@/components/ui/delete-button";
import { deleteProjectAction } from "./actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolveStatusPresentation } from "@/lib/custom-statuses/presentation";
import { EmptyState } from "@/components/ui/empty-state";
import { PencilIcon } from "@/components/ui/icons";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { SearchFilterBar } from "@/components/list/search-filter-bar";
import { Pagination } from "@/components/list/pagination";
import { TableHeaderCell, TableCell } from "@/components/ui/table";
import {
  RecordCardList,
  RecordCard,
  RecordCardField,
  RecordCardActions,
} from "@/components/ui/record-list";
import {
  parseProjectListParams,
  buildProjectWhere,
  buildProjectOrderBy,
} from "./query";
import { serializeProjectSavedViewParams } from "./saved-view";
import { ProjectSavedViews } from "@/components/projects/project-saved-views";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import {
  PROJECT_COLUMNS,
  PROJECT_COLUMNS_SURFACE,
  PROJECT_COLUMN_IDS,
  PROJECT_MANDATORY_COLUMN_IDS,
  type ProjectColumnId,
} from "./columns";
import { ColumnVisibilityProvider } from "@/components/list/column-visibility-context";
import { ColumnVisibilityControl } from "@/components/list/column-visibility-control";
import { ProjectDesktopTable, type ProjectTableRow } from "@/components/projects/project-desktop-table";

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

// Custom Statuses Phase 2A (Section C/P) — see clients/page.tsx's own
// identical ClientStatusBadge helper.
function ProjectStatusBadge({ project }: { project: { status: string; statusDefinition: { label: string; color: import("@/generated/prisma/enums").CustomStatusColor | null } | null } }) {
  const presentation = resolveStatusPresentation(project.statusDefinition, project.status);
  return <StatusBadge status={project.status} label={presentation.label} tone={presentation.tone} />;
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { user, organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;
  const listParams = parseProjectListParams(resolvedSearchParams);

  const where = await buildProjectWhere(organizationId, listParams);
  const orderBy = buildProjectOrderBy(listParams);

  // Custom Statuses Phase 2B (Section P) — see clients/page.tsx's own
  // identical comment.
  const allStatusDefinitions = await listCustomStatusDefinitions(organizationId, "PROJECT", { includeArchived: true });
  const activeStatusDefinitions = allStatusDefinitions.filter((d) => d.archivedAt === null);
  const selectedArchivedDefinition = allStatusDefinitions.find(
    (d) => d.archivedAt !== null && d.key === listParams.status,
  );
  // Stale custom-status filter hardening — see clients/page.tsx's own
  // identical comment.
  const statusFilterOptions = buildFilterOptionsWithUnavailableValue(
    [
      { value: "", label: "All statuses" },
      ...activeStatusDefinitions.map((d) => ({ value: d.key, label: d.label })),
      ...(selectedArchivedDefinition
        ? [{ value: selectedArchivedDefinition.key, label: `${selectedArchivedDefinition.label} (archived)` }]
        : []),
    ],
    listParams.status,
    "Unavailable status",
  );

  const [clientCount, [projects, total]] = await Promise.all([
    prisma.client.count({ where: { organizationId } }),
    prisma.$transaction([
      prisma.project.findMany({
        where,
        orderBy,
        skip: getOffset(listParams.page),
        take: PAGE_SIZE,
        include: {
          client: { select: { name: true } },
          statusDefinition: { select: { label: true, color: true } },
        },
      }),
      prisma.project.count({ where }),
    ]),
  ]);

  const totalPages = getTotalPages(total);
  const hasActiveParams = Boolean(listParams.q || listParams.status);

  // Tables Improvement Slice E3C — these are the EXACT SAME header/cell
  // JSX calls (TableHeaderCell/TableCell, with the exact same Link/
  // ProjectStatusBadge/formatDateOnlyForDisplay/toLocaleDateString/
  // DeleteButton calls) that rendered this table before this slice,
  // just built into per-column slots instead of a flat `<tr>`/
  // `<TableRow>` sequence. No formatting/business logic is
  // reimplemented — `ProjectDesktopTable` (a Client Component) only
  // decides which of these already-built slots to include, based on
  // live column-visibility state; every value here is computed
  // server-side exactly as before (E3C readiness audit §O). Keyed by
  // the same `ProjectColumnId`s `./columns.ts` owns.
  const headerCells: Record<ProjectColumnId, ReactNode> = {
    name: <TableHeaderCell>Name</TableHeaderCell>,
    client: <TableHeaderCell>Client</TableHeaderCell>,
    status: <TableHeaderCell>Status</TableHeaderCell>,
    startDate: <TableHeaderCell>Start date</TableHeaderCell>,
    endDate: <TableHeaderCell>End date</TableHeaderCell>,
    createdAt: <TableHeaderCell>Created</TableHeaderCell>,
    actions: <TableHeaderCell align="right">Actions</TableHeaderCell>,
  };

  const projectTableRows: ProjectTableRow[] = projects.map((project) => ({
    id: project.id,
    cells: {
      name: (
        <TableCell emphasis>
          <Link href={`/projects/${project.id}`} className="text-accent hover:underline">
            {project.name}
          </Link>
        </TableCell>
      ),
      client: <TableCell>{project.client.name}</TableCell>,
      status: (
        <TableCell>
          <ProjectStatusBadge project={project} />
        </TableCell>
      ),
      startDate: (
        <TableCell>{project.startDate ? formatDateOnlyForDisplay(project.startDate) : "—"}</TableCell>
      ),
      endDate: <TableCell>{project.endDate ? formatDateOnlyForDisplay(project.endDate) : "—"}</TableCell>,
      createdAt: <TableCell>{project.createdAt.toLocaleDateString()}</TableCell>,
      actions: (
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
      ),
    },
  }));

  return (
    <ColumnVisibilityProvider
      organizationId={organizationId}
      userId={user.id}
      surface={PROJECT_COLUMNS_SURFACE}
      knownColumnIds={PROJECT_COLUMN_IDS}
      mandatoryColumnIds={PROJECT_MANDATORY_COLUMN_IDS}
    >
    <div>
      <WorkTabs />
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
        <>
          {/*
            Tables Improvement Slice D2B — same placement contract as
            Invoices/Contracts/Quotes/Clients (D1 locked spec §25):
            below the page header/primary action, above SearchFilterBar.
            `currentParams` is built from the already-parsed canonical
            `listParams` server-side — never a raw query-string
            re-parse — and is plain, serializable data, safe to pass
            straight into this Client Component from the Server
            Component page.
          */}
          <div className="flex flex-wrap items-end justify-between gap-2">
            <ProjectSavedViews
              organizationId={organizationId}
              userId={user.id}
              currentParams={serializeProjectSavedViewParams(listParams)}
            />

            {/*
              Tables Improvement Slice E3C — same controls-band placement
              contract as Saved Views and as Invoice/Contract/Quote/
              Client's own Columns control: never inside SearchFilterBar,
              never in the page header/primary-action row. Desktop-only
              (the component's own wrapper carries `hidden
              xl:inline-block`) — Column Customization has zero effect on
              the fixed mobile RecordCardList (readiness audit §M/§15),
              so showing a "Columns" trigger on mobile would only ever
              open a popover that changes nothing a mobile user can see.
            */}
            <ColumnVisibilityControl columns={PROJECT_COLUMNS} />
          </div>

          <SearchFilterBar
            // Tables Improvement Slice D2B — same remount-key contract
            // as Invoices/Contracts/Quotes/Clients (see those pages'
            // own identical comment): Saved Views' own "Apply" link is
            // the first Link-based navigation on this page able to
            // change q/status/sort independently of `page`, so the
            // uncontrolled (defaultValue-based) Search/Status/Sort
            // controls need a forced remount whenever any of those
            // change. `page` is deliberately excluded, matching every
            // other surface's identical convention.
            key={`${listParams.q}:${listParams.status ?? ""}:${listParams.sortCombined}`}
            basePath="/projects"
            searchValue={listParams.q}
            searchPlaceholder="Search by name or client"
            filters={[
              {
                name: "status",
                label: "Status",
                value: listParams.status ?? "",
                options: statusFilterOptions,
              },
            ]}
            sort={{ value: listParams.sortCombined, options: SORT_OPTIONS }}
            hasActiveParams={hasActiveParams}
          />
        </>
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
          {/*
            Tables Improvement Slice E3C — only WHICH columns render is
            now a client-side decision, fed by the already-server-built
            `headerCells`/`projectTableRows` slots above; the `<table>`
            markup itself (no sticky header — readiness audit §Q) is
            unchanged from before this slice, now living inside
            `ProjectDesktopTable`.
          */}
          <ProjectDesktopTable headerCells={headerCells} rows={projectTableRows} />

          <RecordCardList>
            {projects.map((project) => (
              <RecordCard key={project.id}>
                <RecordCardField
                  label="Name"
                  value={
                    <Link href={`/projects/${project.id}`} className="text-accent hover:underline">
                      {project.name}
                    </Link>
                  }
                  emphasis
                />
                <RecordCardField label="Client" value={project.client.name} />
                <RecordCardField label="Status" value={<ProjectStatusBadge project={project} />} />
                <RecordCardField
                  label="Start date"
                  value={project.startDate ? formatDateOnlyForDisplay(project.startDate) : "—"}
                />
                <RecordCardField
                  label="End date"
                  value={project.endDate ? formatDateOnlyForDisplay(project.endDate) : "—"}
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
    </ColumnVisibilityProvider>
  );
}
