import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatStatusLabel } from "@/lib/format";
import { PAGE_SIZE, getOffset, getTotalPages, type RawSearchParams } from "@/lib/list-params";
import { EmptyState } from "@/components/ui/empty-state";
import { PencilIcon } from "@/components/ui/icons";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { SearchFilterBar } from "@/components/list/search-filter-bar";
import { Pagination } from "@/components/list/pagination";
import { LeadStageBadge } from "@/components/leads/lead-stage-badge";
import { LeadPipelineBoard } from "@/components/leads/lead-pipeline-board";
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
import { LEAD_STAGES } from "@/lib/leads/stages";
import { parseLeadListParams, buildLeadWhere, buildLeadOrderBy, type LeadListParams } from "./query";
import { fetchLeadPipelineColumns } from "./pipeline-query";
import { parseLeadView, parseLeadStageView, buildLeadsHref, type LeadView } from "./view-params";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

const VIEW_TOGGLE_CLASSES =
  "focus-visible:ring-focus-ring rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

const SORT_OPTIONS = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "name:asc", label: "Name (A–Z)" },
  { value: "name:desc", label: "Name (Z–A)" },
  { value: "value:desc", label: "Value (high–low)" },
];

/** The compatible cross-view params — everything a switch between List and Pipeline preserves. `stage`/`page` are List-only and `stageView` is Pipeline-only, so none of those three round-trip through this. */
function sharedParams(listParams: Pick<LeadListParams, "q" | "assignedToUserId" | "archived" | "sortCombined">) {
  return {
    q: listParams.q,
    assignedToUserId: listParams.assignedToUserId,
    archived: listParams.archived ? "1" : undefined,
    sort: listParams.sortCombined,
  };
}

function ViewToggle({ view, listParams }: { view: LeadView; listParams: LeadListParams }) {
  const shared = sharedParams(listParams);
  const listHref = buildLeadsHref({ ...shared, stage: listParams.stage });
  const pipelineHref = buildLeadsHref({ ...shared, view: "pipeline" });

  return (
    <div role="group" aria-label="Leads view" className="border-border-default bg-surface flex gap-1 rounded-lg border p-1">
      <Link
        href={listHref}
        aria-current={view === "list" ? "page" : undefined}
        className={`${VIEW_TOGGLE_CLASSES} ${view === "list" ? "bg-accent text-white" : "text-text-secondary hover:bg-[var(--hover)]"}`}
      >
        List
      </Link>
      <Link
        href={pipelineHref}
        aria-current={view === "pipeline" ? "page" : undefined}
        className={`${VIEW_TOGGLE_CLASSES} ${view === "pipeline" ? "bg-accent text-white" : "text-text-secondary hover:bg-[var(--hover)]"}`}
      >
        Pipeline
      </Link>
    </div>
  );
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;
  const listParams = parseLeadListParams(resolvedSearchParams);
  const view = parseLeadView(resolvedSearchParams);

  const memberships = await prisma.membership.findMany({
    where: { organizationId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    include: { user: { select: { id: true, name: true } } },
  });
  const assignees = memberships.map((m) => ({ id: m.user.id, name: m.user.name }));

  const assigneeFilter = {
    name: "assignedToUserId",
    label: "Assignee",
    value: listParams.assignedToUserId ?? "",
    options: [
      { value: "", label: "All assignees" },
      { value: "unassigned", label: "Unassigned" },
      ...assignees.map((a) => ({ value: a.id, label: a.name })),
    ],
  };
  const archivedFilter = {
    name: "archived",
    label: "Status",
    value: listParams.archived ? "1" : "",
    options: [
      { value: "", label: "Active" },
      { value: "1", label: "Archived" },
    ],
  };

  if (view === "pipeline") {
    const columns = await fetchLeadPipelineColumns(organizationId, listParams);
    const stageView = parseLeadStageView(resolvedSearchParams);
    const grandTotal = columns.reduce((sum, c) => sum + c.total, 0);
    const hasActiveParams = Boolean(listParams.q || listParams.assignedToUserId || listParams.archived);
    const shared = sharedParams(listParams);

    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Leads</h1>
            <p className="text-text-secondary mt-1 text-sm">
              {grandTotal} {grandTotal === 1 ? "lead" : "leads"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ViewToggle view={view} listParams={listParams} />
            <Link href="/leads/new" className={PRIMARY_LINK_CLASSES}>
              Add lead
            </Link>
          </div>
        </div>

        <SearchFilterBar
          basePath="/leads"
          searchValue={listParams.q}
          searchPlaceholder="Search by name, company, or email"
          // No stage filter here — every stage is already its own column
          // in Pipeline view, so a redundant stage filter would just let
          // a user collapse the board down to one column for no real
          // benefit over simply looking at that column.
          filters={[assigneeFilter, archivedFilter]}
          sort={{ value: listParams.sortCombined, options: SORT_OPTIONS }}
          hasActiveParams={hasActiveParams}
          hiddenFields={[{ name: "view", value: "pipeline" }]}
          clearHref={buildLeadsHref({ view: "pipeline" })}
        />

        {grandTotal === 0 && !hasActiveParams ? (
          <EmptyState
            title="No leads yet"
            description="Leads are prospects working their way toward becoming a client — add your first one to start tracking your pipeline."
            action={
              <Link href="/leads/new" className={PRIMARY_LINK_CLASSES}>
                Add your first lead
              </Link>
            }
          />
        ) : (
          <LeadPipelineBoard columns={columns} stageView={stageView} preservedParams={shared} />
        )}
      </div>
    );
  }

  const where = await buildLeadWhere(organizationId, listParams);
  const orderBy = buildLeadOrderBy(listParams);

  const [leads, total] = await prisma.$transaction([
    prisma.lead.findMany({
      where,
      orderBy,
      skip: getOffset(listParams.page),
      take: PAGE_SIZE,
      include: {
        assignedTo: { select: { id: true, name: true } },
        statusDefinition: { select: { label: true, color: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  const totalPages = getTotalPages(total);
  const hasActiveParams = Boolean(
    listParams.q || listParams.stage || listParams.assignedToUserId || listParams.archived,
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-text-secondary mt-1 text-sm">
            {total} {total === 1 ? "lead" : "leads"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle view={view} listParams={listParams} />
          <Link href="/leads/new" className={PRIMARY_LINK_CLASSES}>
            Add lead
          </Link>
        </div>
      </div>

      <SearchFilterBar
        basePath="/leads"
        searchValue={listParams.q}
        searchPlaceholder="Search by name, company, or email"
        filters={[
          {
            name: "stage",
            label: "Stage",
            value: listParams.stage ?? "",
            options: [
              { value: "", label: "All stages" },
              ...LEAD_STAGES.map((s) => ({ value: s.value, label: s.label })),
            ],
          },
          assigneeFilter,
          archivedFilter,
        ]}
        sort={{ value: listParams.sortCombined, options: SORT_OPTIONS }}
        hasActiveParams={hasActiveParams}
      />

      {total === 0 ? (
        hasActiveParams ? (
          <EmptyState
            title="No leads match your filters"
            description="Try a different search term or clear your filters."
            action={
              <Link href="/leads" className={PRIMARY_LINK_CLASSES}>
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="No leads yet"
            description="Leads are prospects working their way toward becoming a client — add your first one to start tracking your pipeline."
            action={
              <Link href="/leads/new" className={PRIMARY_LINK_CLASSES}>
                Add your first lead
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
                  <TableHeaderCell>Company</TableHeaderCell>
                  <TableHeaderCell>Stage</TableHeaderCell>
                  <TableHeaderCell>Source</TableHeaderCell>
                  <TableHeaderCell>Value</TableHeaderCell>
                  <TableHeaderCell>Assignee</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell emphasis>{lead.name}</TableCell>
                    <TableCell>{lead.company ?? "—"}</TableCell>
                    <TableCell>
                      <LeadStageBadge stage={lead.stage} definition={lead.statusDefinition} />
                    </TableCell>
                    <TableCell>{lead.source ? formatStatusLabel(lead.source) : "—"}</TableCell>
                    <TableCell>{lead.value ? formatCurrency(Number(lead.value)) : "—"}</TableCell>
                    <TableCell>{lead.assignedTo?.name ?? "Unassigned"}</TableCell>
                    <TableCell>{lead.createdAt.toLocaleDateString()}</TableCell>
                    <TableCell align="right">
                      <Link
                        href={`/leads/${lead.id}/edit`}
                        className={`inline-flex items-center gap-1 ${ACTION_LINK_CLASSES}`}
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                        Edit
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <RecordCardList>
            {leads.map((lead) => (
              <RecordCard key={lead.id}>
                <RecordCardField label="Name" value={lead.name} emphasis />
                <RecordCardField label="Company" value={lead.company ?? "—"} />
                <RecordCardField label="Stage" value={<LeadStageBadge stage={lead.stage} definition={lead.statusDefinition} />} />
                <RecordCardField label="Source" value={lead.source ? formatStatusLabel(lead.source) : "—"} />
                <RecordCardField label="Value" value={lead.value ? formatCurrency(Number(lead.value)) : "—"} />
                <RecordCardField label="Assignee" value={lead.assignedTo?.name ?? "Unassigned"} />
                <RecordCardField label="Created" value={lead.createdAt.toLocaleDateString()} />
                <RecordCardActions>
                  <Link
                    href={`/leads/${lead.id}/edit`}
                    className={`inline-flex items-center gap-1 ${ACTION_LINK_CLASSES}`}
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                    Edit
                  </Link>
                </RecordCardActions>
              </RecordCard>
            ))}
          </RecordCardList>

          <Pagination
            basePath="/leads"
            params={{
              ...(listParams.q ? { q: listParams.q } : {}),
              ...(listParams.stage ? { stage: listParams.stage } : {}),
              ...(listParams.assignedToUserId ? { assignedToUserId: listParams.assignedToUserId } : {}),
              ...(listParams.archived ? { archived: "1" } : {}),
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
