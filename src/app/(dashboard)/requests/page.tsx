import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { listOrganizationClientRequests } from "@/lib/client-requests/staff";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StaffRequestFilters } from "@/components/client-requests/staff-request-filters";
import { relativeTime } from "@/lib/notifications/relative-time";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import type { RawSearchParams } from "@/lib/list-params";
import { parseClientRequestStatusFilter, parseClientRequestPriorityFilter, parseClientRequestAssigneeFilter } from "./view-params";

/**
 * Client Requests / Tickets Phase 2A — the Staff requests list. Simple
 * `?status=&priority=&assignedTo=&archived=1` filters (URL is the only
 * source of truth — see StaffRequestFilters' own doc comment), no
 * free-text search/sort/pagination ("Do not build a complex search
 * engine in this phase"). `archived=1` fetches the archived view
 * instead of the default active one — two separate, simple fetches
 * rather than a client-side toggle over one combined fetch, so it
 * composes cleanly with the other server-driven filters above.
 */
export default async function ClientRequestsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;

  const status = parseClientRequestStatusFilter(resolvedSearchParams);
  const priority = parseClientRequestPriorityFilter(resolvedSearchParams);
  const assignedToId = parseClientRequestAssigneeFilter(resolvedSearchParams);
  const showArchived = resolvedSearchParams.archived === "1";

  const [requests, members] = await Promise.all([
    listOrganizationClientRequests(organizationId, { includeArchived: showArchived, status, priority, assignedToId }),
    prisma.membership.findMany({
      where: { organizationId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      include: { user: { select: { id: true, name: true } } },
    }),
  ]);

  const visibleRequests = showArchived ? requests.filter((r) => r.archivedAt !== null) : requests;
  const memberOptions = members.map((m) => ({ id: m.user.id, name: m.user.name }));

  const hasActiveFilters = status || priority || assignedToId;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Requests</h1>
        <Link
          href={showArchived ? "/requests" : "/requests?archived=1"}
          className="text-text-secondary hover:text-text-primary focus-visible:ring-focus-ring rounded text-sm font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          {showArchived ? "Show active" : "Show archived"}
        </Link>
      </div>
      <p className="text-text-secondary mt-1 text-sm">Client support requests submitted through the Client Portal.</p>

      <div className="mt-6">
        <StaffRequestFilters members={memberOptions} />
      </div>

      {visibleRequests.length === 0 ? (
        <EmptyState
          title={showArchived ? "No archived requests" : hasActiveFilters ? "No matching requests" : "No requests yet"}
          description={
            showArchived
              ? "Archived requests will appear here."
              : "Requests submitted by clients through the Client Portal will appear here."
          }
        />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Title</TableHeaderCell>
              <TableHeaderCell>Client</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Priority</TableHeaderCell>
              <TableHeaderCell className="hidden md:table-cell">Assignee</TableHeaderCell>
              <TableHeaderCell className="hidden md:table-cell">Project</TableHeaderCell>
              <TableHeaderCell align="right">Updated</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {visibleRequests.map((request) => (
              <TableRow key={request.id}>
                <TableCell emphasis>
                  <Link
                    href={`/requests/${request.id}`}
                    className="focus-visible:ring-focus-ring rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    {request.title}
                  </Link>
                </TableCell>
                <TableCell>{request.client.name}</TableCell>
                <TableCell>
                  <StatusBadge status={request.status} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={request.priority} />
                </TableCell>
                <TableCell className="hidden md:table-cell">{request.assignedTo?.name ?? "—"}</TableCell>
                <TableCell className="hidden md:table-cell">{request.project?.name ?? "—"}</TableCell>
                <TableCell align="right">
                  <time dateTime={request.updatedAt.toISOString()} title={request.updatedAt.toLocaleString()}>
                    {relativeTime(request.updatedAt)}
                  </time>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
