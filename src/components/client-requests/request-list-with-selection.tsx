"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { relativeTime } from "@/lib/notifications/relative-time";
import { formatStatusLabel } from "@/lib/format";
import { CLIENT_REQUEST_STATUSES } from "@/lib/validation/client-request";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { BulkActionBar } from "@/components/list/bulk-action-bar";
import { useBoundedSelection, BULK_SELECTION_MAX } from "@/components/list/use-bounded-selection";
import { useToast } from "@/components/toast/toast-provider";
import { bulkUpdateClientRequestStatusAction, bulkAssignClientRequestAction } from "@/app/(dashboard)/requests/bulk-actions";

export type RequestListRow = {
  id: string;
  title: string;
  client: { id: string; name: string };
  status: string;
  priority: string;
  assignedTo: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  updatedAt: Date;
};

/**
 * Tables Improvement Slice C — the Support Requests list table, now with
 * an optional selection checkbox column feeding a bulk status/assignment
 * BulkActionBar. Deliberately still the ONE shared `<Table>` at every
 * viewport (locked spec §7/§20: "do NOT convert Support Requests to
 * RecordCardList merely for bulk actions... preserve the existing
 * responsive table/CSS architecture") — unlike Contracts/Invoice/Tasks,
 * which already split desktop-table vs. mobile-RecordCardList, this
 * list's own existing responsive strategy is column-hiding
 * (`hidden md:table-cell`) on the SAME table, so the new checkbox column
 * is added to that same table rather than introducing a parallel mobile
 * representation.
 *
 * `canBulkSelect` is false on the Archived view — the detail page's own
 * StaffRequestControls already disables status/priority/assignee/
 * project editing once a request is archived, so bulk controls follow
 * that exact existing convention (locked spec §14) rather than
 * broadening archived mutability merely because this surface now
 * exists.
 */
export function RequestListWithSelection({
  requests,
  members,
  canBulkSelect,
}: {
  requests: RequestListRow[];
  members: { id: string; name: string }[];
  canBulkSelect: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<"" | "status" | "assignee">("");
  const [value, setValue] = useState("");
  const ids = requests.map((r) => r.id);
  const { selected, toggle, toggleAll, clear, canSelectAll, isAtCap } = useBoundedSelection(ids);

  function reportAndReset(result: { updatedCount: number; failedCount: number }): void {
    if (result.failedCount === 0) {
      showToast(`Updated ${result.updatedCount} request${result.updatedCount === 1 ? "" : "s"}`);
    } else {
      showToast(`Updated ${result.updatedCount}, ${result.failedCount} could not be updated`, "error");
    }
    clear();
    setAction("");
    setValue("");
    router.refresh();
  }

  function apply(): void {
    if (!action) return;
    startTransition(async () => {
      if (action === "status") {
        reportAndReset(await bulkUpdateClientRequestStatusAction([...selected], value));
      } else if (action === "assignee") {
        reportAndReset(await bulkAssignClientRequestAction([...selected], value || null));
      }
    });
  }

  return (
    <>
      <Table>
        <TableHead>
          <tr>
            {canBulkSelect && (
              // A raw <th>, not TableHeaderCell, deliberately — a
              // selection control, not a real data column (mirrors
              // TaskListWithSelection/ContractListWithSelection's own
              // identical reasoning).
              <th scope="col" className="text-text-muted px-4 py-3 text-left font-medium">
                <input
                  type="checkbox"
                  aria-label={
                    canSelectAll
                      ? "Select all visible requests"
                      : "Select all is unavailable — narrow filters to 50 or fewer requests to select all"
                  }
                  checked={selected.size > 0 && selected.size === requests.length}
                  disabled={!canSelectAll}
                  onChange={toggleAll}
                />
              </th>
            )}
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
          {requests.map((request) => {
            const isSelected = selected.has(request.id);
            return (
              <TableRow key={request.id}>
                {canBulkSelect && (
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Select request ${request.title}`}
                      checked={isSelected}
                      disabled={!isSelected && isAtCap}
                      onChange={() => toggle(request.id)}
                    />
                  </TableCell>
                )}
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
            );
          })}
        </TableBody>
      </Table>

      {canBulkSelect && (
        <BulkActionBar selectedCount={selected.size} maxSelectable={BULK_SELECTION_MAX} onClear={clear} clearDisabled={pending}>
          <Select
            aria-label="Bulk action"
            value={action}
            disabled={pending}
            onChange={(event) => {
              setAction(event.target.value as typeof action);
              setValue("");
            }}
            className="w-auto"
          >
            <option value="">Choose action…</option>
            <option value="status">Change status</option>
            <option value="assignee">Assign</option>
          </Select>

          {action === "status" && (
            <Select aria-label="New status" value={value} disabled={pending} onChange={(event) => setValue(event.target.value)} className="w-auto">
              <option value="">Select status</option>
              {CLIENT_REQUEST_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {formatStatusLabel(status)}
                </option>
              ))}
            </Select>
          )}

          {action === "assignee" && (
            <Select aria-label="New assignee" value={value} disabled={pending} onChange={(event) => setValue(event.target.value)} className="w-auto">
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          )}

          <button
            type="button"
            onClick={apply}
            disabled={!action || (action === "status" && !value) || pending}
            className="focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {pending ? "Applying…" : "Apply"}
          </button>
        </BulkActionBar>
      )}
    </>
  );
}
