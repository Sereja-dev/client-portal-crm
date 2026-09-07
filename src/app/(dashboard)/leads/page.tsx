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
import { parseLeadListParams, buildLeadWhere, buildLeadOrderBy } from "./query";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

const SORT_OPTIONS = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "name:asc", label: "Name (A–Z)" },
  { value: "name:desc", label: "Name (Z–A)" },
  { value: "value:desc", label: "Value (high–low)" },
];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;
  const listParams = parseLeadListParams(resolvedSearchParams);

  const where = buildLeadWhere(organizationId, listParams);
  const orderBy = buildLeadOrderBy(listParams);

  const [leads, total, memberships] = await prisma.$transaction([
    prisma.lead.findMany({
      where,
      orderBy,
      skip: getOffset(listParams.page),
      take: PAGE_SIZE,
      include: { assignedTo: { select: { id: true, name: true } } },
    }),
    prisma.lead.count({ where }),
    prisma.membership.findMany({
      where: { organizationId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      include: { user: { select: { id: true, name: true } } },
    }),
  ]);

  const assignees = memberships.map((m) => ({ id: m.user.id, name: m.user.name }));
  const totalPages = getTotalPages(total);
  const hasActiveParams = Boolean(
    listParams.q || listParams.stage || listParams.assignedToUserId || listParams.archived,
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-text-secondary mt-1 text-sm">
            {total} {total === 1 ? "lead" : "leads"}
          </p>
        </div>
        <Link href="/leads/new" className={PRIMARY_LINK_CLASSES}>
          Add lead
        </Link>
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
          {
            name: "assignedToUserId",
            label: "Assignee",
            value: listParams.assignedToUserId ?? "",
            options: [
              { value: "", label: "All assignees" },
              { value: "unassigned", label: "Unassigned" },
              ...assignees.map((a) => ({ value: a.id, label: a.name })),
            ],
          },
          {
            name: "archived",
            label: "Status",
            value: listParams.archived ? "1" : "",
            options: [
              { value: "", label: "Active" },
              { value: "1", label: "Archived" },
            ],
          },
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
                      <LeadStageBadge stage={lead.stage} />
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
                <RecordCardField label="Stage" value={<LeadStageBadge stage={lead.stage} />} />
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
