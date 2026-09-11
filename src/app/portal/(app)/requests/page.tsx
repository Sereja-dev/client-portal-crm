import Link from "next/link";
import { getCurrentPortalUser } from "@/lib/current-portal-user";
import { listPortalClientRequests } from "@/lib/client-requests/portal";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { relativeTime } from "@/lib/notifications/relative-time";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";

// Same base+"primary" Button classes as a plain `<Link>` styled to
// match — Button itself renders a real `<button>` with no polymorphic/
// asChild support (see leads/page.tsx's own identical PRIMARY_LINK_CLASSES
// for this exact reasoning).
const PRIMARY_LINK_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2";

/**
 * Client Requests / Tickets Phase 2A — the Portal's own requests list.
 * Mirrors portal/quotes/page.tsx's own exact shape (plain heading +
 * description + Table, no extra card wrapper — the (app) layout's own
 * <main> already provides the page gutter). listPortalClientRequests
 * already excludes archived (Phase 1, unchanged) — no archive-visibility
 * toggle here, matching every other Portal list in this app.
 */
export default async function PortalRequestsPage() {
  const { clientId } = await getCurrentPortalUser();
  const requests = await listPortalClientRequests(clientId);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Requests</h1>
          <p className="text-text-muted mt-1 text-sm">
            {requests.length} {requests.length === 1 ? "request" : "requests"}
          </p>
        </div>
        <Link href="/portal/requests/new" className={PRIMARY_LINK_CLASSES}>
          New request
        </Link>
      </div>

      {requests.length === 0 ? (
        <EmptyState
          title="No requests yet"
          description="Need help with something? Submit a request and your team will get back to you."
          action={
            <Link href="/portal/requests/new" className={PRIMARY_LINK_CLASSES}>
              New request
            </Link>
          }
        />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Title</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Priority</TableHeaderCell>
              <TableHeaderCell className="hidden sm:table-cell">Project</TableHeaderCell>
              <TableHeaderCell align="right">Updated</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {requests.map((request) => (
              <TableRow key={request.id}>
                <TableCell emphasis>
                  <Link
                    href={`/portal/requests/${request.id}`}
                    className="focus-visible:ring-focus-ring rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    {request.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={request.status} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={request.priority} />
                </TableCell>
                <TableCell className="hidden sm:table-cell">{request.project?.name ?? "—"}</TableCell>
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
