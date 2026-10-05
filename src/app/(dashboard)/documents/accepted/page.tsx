import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { DocumentsTabs } from "@/components/documents/documents-tabs";
import { listContracts } from "@/lib/contracts/queries";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { ContractStatusBadge } from "@/components/contracts/contract-status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { RecordCardList, RecordCard, RecordCardField } from "@/components/ui/record-list";
import { parseAcceptedDocumentsListParams } from "./query";
import type { RawSearchParams } from "@/lib/list-params";

const TAB_CLASSES =
  "focus-visible:ring-focus-ring rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/**
 * Documents Slice D — Accepted documents (locked spec §12–§18). A
 * read-only discovery view over Contracts that have actually reached
 * persisted ACCEPTED state — never a separate artifact repository, never
 * a signed/e-signed/certified claim of any kind (Contract acceptance is
 * not certified e-signature; see this page's own helper copy below).
 *
 * Filters by persisted `status: "ACCEPTED"` only (via listContracts()'s
 * own already-reviewed `status` option — no new query function) — never
 * `status: "EXPIRED"`, which does not exist as a stored value at all
 * (src/lib/contracts/status.ts's own header comment: ACTIVE/EXPIRED are
 * both derived-only). The resulting rows are then rendered through
 * ContractStatusBadge, the exact same canonical presentational component
 * the Contracts list and detail page already use — so an accepted-but-
 * expired Contract still correctly reads "Expired" here, and a currently
 * accepted one reads "Accepted" or "Active" exactly as derived, with no
 * second, independently hand-rolled status-label mapping.
 *
 * DRAFT/SENT/TERMINATED Contracts can never appear here by construction
 * — not filtered out after the fact, excluded at the query itself via
 * the `status: "ACCEPTED"` constraint.
 *
 * Archived behavior mirrors Contracts' own identical convention exactly
 * (Active by default; `?archived=1` shows archived-and-accepted rows) —
 * no separate archive model invented.
 *
 * No mutation controls of any kind — "View" is the only action, linking
 * straight to the ordinary Contract detail page (locked spec §18); that
 * page remains the sole canonical action surface (Edit/Send/Terminate/
 * Archive, none of which belong on this index).
 */
export default async function AcceptedDocumentsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;
  const listParams = parseAcceptedDocumentsListParams(resolvedSearchParams);

  const contracts = await listContracts(organizationId, { status: "ACCEPTED", includeArchived: listParams.archived });
  // Mirrors ContractsPage's own identical convention: includeArchived
  // returns active+archived TOGETHER, not "archived only" — the
  // Archived view is plain array filtering on already-fetched data,
  // never a second query implementing the same rule twice.
  const visibleContracts = listParams.archived ? contracts.filter((c) => c.archivedAt !== null) : contracts;

  return (
    <div>
      <DocumentsTabs />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Accepted documents</h1>
          <p className="text-text-secondary mt-1 text-sm">
            Contracts that have been accepted by Staff or through the client portal.
          </p>
        </div>
      </div>

      <div role="group" aria-label="Accepted documents status" className="border-border-default bg-surface mt-6 flex gap-1 overflow-x-auto rounded-lg border p-1">
        <Link
          href="/documents/accepted"
          aria-current={!listParams.archived ? "page" : undefined}
          className={`${TAB_CLASSES} whitespace-nowrap ${!listParams.archived ? "bg-accent text-white" : "text-text-secondary hover:bg-[var(--hover)]"}`}
        >
          Active
        </Link>
        <Link
          href="/documents/accepted?archived=1"
          aria-current={listParams.archived ? "page" : undefined}
          className={`${TAB_CLASSES} whitespace-nowrap ${listParams.archived ? "bg-accent text-white" : "text-text-secondary hover:bg-[var(--hover)]"}`}
        >
          Archived
        </Link>
      </div>

      {visibleContracts.length === 0 ? (
        listParams.archived ? (
          <EmptyState title="No archived accepted documents" description="Accepted contracts you archive will appear here." />
        ) : (
          <EmptyState
            title="No accepted documents yet"
            description="Contracts appear here once they've been accepted by Staff or through the client portal."
          />
        )
      ) : (
        <>
          <div className="hidden xl:block">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Contract #</TableHeaderCell>
                  <TableHeaderCell>Title</TableHeaderCell>
                  <TableHeaderCell>Client</TableHeaderCell>
                  <TableHeaderCell className="hidden lg:table-cell">Project</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Accepted</TableHeaderCell>
                  <TableHeaderCell>Expiry</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {visibleContracts.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell emphasis>{contract.contractNumber}</TableCell>
                    <TableCell>{contract.title}</TableCell>
                    <TableCell>
                      <Link href={`/clients/${contract.client.id}`} className={ACTION_LINK_CLASSES}>
                        {contract.client.name}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{contract.project?.name ?? "—"}</TableCell>
                    <TableCell>
                      <ContractStatusBadge contract={contract} />
                      {contract.archivedAt !== null && <span className="text-text-muted ml-2 text-xs">Archived</span>}
                    </TableCell>
                    <TableCell>{contract.acceptedAt ? contract.acceptedAt.toLocaleDateString() : "—"}</TableCell>
                    <TableCell>{contract.expiresAt ? formatDateOnlyForDisplay(contract.expiresAt) : "No expiry set"}</TableCell>
                    <TableCell align="right">
                      <Link href={`/contracts/${contract.id}`} className={ACTION_LINK_CLASSES}>
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <RecordCardList>
            {visibleContracts.map((contract) => (
              <RecordCard key={contract.id}>
                <RecordCardField label="Contract #" value={contract.contractNumber} emphasis />
                <RecordCardField label="Title" value={contract.title} />
                <RecordCardField
                  label="Client"
                  value={
                    <Link href={`/clients/${contract.client.id}`} className={ACTION_LINK_CLASSES}>
                      {contract.client.name}
                    </Link>
                  }
                />
                {contract.project && <RecordCardField label="Project" value={contract.project.name} />}
                <RecordCardField
                  label="Status"
                  value={
                    <>
                      <ContractStatusBadge contract={contract} />
                      {contract.archivedAt !== null && <span className="text-text-muted ml-2 text-xs">Archived</span>}
                    </>
                  }
                />
                <RecordCardField label="Accepted" value={contract.acceptedAt ? contract.acceptedAt.toLocaleDateString() : "—"} />
                <RecordCardField
                  label="Expiry"
                  value={contract.expiresAt ? formatDateOnlyForDisplay(contract.expiresAt) : "No expiry set"}
                />
                <div className="mt-3">
                  <Link href={`/contracts/${contract.id}`} className={ACTION_LINK_CLASSES}>
                    View
                  </Link>
                </div>
              </RecordCard>
            ))}
          </RecordCardList>
        </>
      )}
    </div>
  );
}
