import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { DocumentsTabs } from "@/components/documents/documents-tabs";
import { prisma } from "@/lib/prisma";
import { listContracts } from "@/lib/contracts/queries";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { ContractStatusBadge } from "@/components/contracts/contract-status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { SearchFilterBar } from "@/components/list/search-filter-bar";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { RecordCardList, RecordCard, RecordCardField } from "@/components/ui/record-list";
import { isContractEditable } from "@/lib/contracts/status";
import { parseContractListParams, CONTRACT_STATUS_FILTER_VALUES } from "./query";
import type { RawSearchParams } from "@/lib/list-params";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

const STATUS_FILTER_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  TERMINATED: "Terminated",
};

/**
 * Contracts Phase 2 (Staff UI) — the Contracts list. Tenant-scoped via
 * getCurrentUserOrganization() (never a client-supplied organizationId),
 * open to every Staff role (no membership.role check anywhere on this
 * page — locked architecture §I). Uses src/lib/contracts/queries.ts's
 * own already-reviewed listContracts() directly rather than a second,
 * duplicated Prisma query (locked architecture §2).
 *
 * No pagination: listContracts() itself has none (Phase 1's own
 * deliberate "matches Quote Templates' identical bounded-scale
 * reasoning" choice, see that function's own doc comment) — adding one
 * here alone, without the underlying query supporting it, would just be
 * unused architecture (locked architecture §6).
 */
export default async function ContractsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;
  const listParams = parseContractListParams(resolvedSearchParams);

  const [clientCount, clients, contracts] = await Promise.all([
    prisma.client.count({ where: { organizationId } }),
    prisma.client.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    listContracts(organizationId, {
      includeArchived: listParams.archived,
      status: listParams.status,
      clientId: listParams.clientId,
      search: listParams.q || undefined,
    }),
  ]);

  // listContracts()'s own `includeArchived` returns active+archived
  // TOGETHER when true, not "archived only" (matches
  // getQuoteTemplateForManagement's own identical convention) — the
  // Archived filter/view is plain array filtering on already-fetched
  // data, never a second query implementing the same rule twice.
  const visibleContracts = listParams.archived ? contracts.filter((c) => c.archivedAt !== null) : contracts;

  const canCreate = clientCount > 0;
  const hasActiveParams = Boolean(listParams.q || listParams.status || listParams.clientId || listParams.archived);

  return (
    <div>
      <DocumentsTabs />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Contracts</h1>
          <p className="text-text-secondary mt-1 text-sm">
            {visibleContracts.length} {visibleContracts.length === 1 ? "contract" : "contracts"}
          </p>
        </div>
        {canCreate && (
          <Link href="/contracts/new" className={PRIMARY_LINK_CLASSES}>
            New contract
          </Link>
        )}
      </div>

      {canCreate && (
        <SearchFilterBar
          basePath="/contracts"
          searchValue={listParams.q}
          searchPlaceholder="Search by contract #, title, or client"
          filters={[
            {
              name: "status",
              label: "Status",
              value: listParams.status ?? "",
              options: [
                { value: "", label: "All statuses" },
                ...CONTRACT_STATUS_FILTER_VALUES.map((value) => ({ value, label: STATUS_FILTER_LABELS[value] })),
              ],
            },
            {
              name: "client",
              label: "Client",
              value: listParams.clientId ?? "",
              options: [{ value: "", label: "All clients" }, ...clients.map((c) => ({ value: c.id, label: c.name }))],
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
          hasActiveParams={hasActiveParams}
        />
      )}

      {visibleContracts.length === 0 ? (
        !canCreate ? (
          <EmptyState
            title="You need a client first"
            description="Contracts must belong to a client. Add one before creating a contract."
            action={
              <Link href="/clients/new" className={PRIMARY_LINK_CLASSES}>
                Add client
              </Link>
            }
          />
        ) : hasActiveParams ? (
          listParams.archived && !listParams.q && !listParams.status && !listParams.clientId ? (
            <EmptyState title="No archived contracts" description="Contracts you archive will appear here." />
          ) : (
            <EmptyState
              title="No matching contracts"
              description="Try a different search term or clear your filters."
              action={
                <Link href="/contracts" className={PRIMARY_LINK_CLASSES}>
                  Clear filters
                </Link>
              }
            />
          )
        ) : (
          <EmptyState
            title="No contracts yet"
            description="Create a contract for a client, send it, and track it through acceptance and termination."
            action={
              <Link href="/contracts/new" className={PRIMARY_LINK_CLASSES}>
                Create contract
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
                  <TableHeaderCell>Contract #</TableHeaderCell>
                  <TableHeaderCell>Title</TableHeaderCell>
                  <TableHeaderCell>Client</TableHeaderCell>
                  <TableHeaderCell className="hidden lg:table-cell">Project</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Issue date</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {visibleContracts.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell emphasis>{contract.contractNumber}</TableCell>
                    <TableCell>{contract.title}</TableCell>
                    <TableCell>
                      <Link href={`/clients/${contract.client.id}/edit`} className={ACTION_LINK_CLASSES}>
                        {contract.client.name}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{contract.project?.name ?? "—"}</TableCell>
                    <TableCell>
                      <ContractStatusBadge contract={contract} />
                      {contract.archivedAt !== null && (
                        <span className="text-text-muted ml-2 text-xs">Archived</span>
                      )}
                    </TableCell>
                    <TableCell>{formatDateOnlyForDisplay(contract.issueDate)}</TableCell>
                    <TableCell align="right">
                      <Link href={`/contracts/${contract.id}`} className={ACTION_LINK_CLASSES}>
                        View
                      </Link>
                      {isContractEditable(contract.status) && contract.archivedAt === null && (
                        <Link href={`/contracts/${contract.id}/edit`} className={`ml-3 ${ACTION_LINK_CLASSES}`}>
                          Edit
                        </Link>
                      )}
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
                    <Link href={`/clients/${contract.client.id}/edit`} className={ACTION_LINK_CLASSES}>
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
                <RecordCardField label="Issue date" value={formatDateOnlyForDisplay(contract.issueDate)} />
                <div className="mt-3">
                  <Link href={`/contracts/${contract.id}`} className={ACTION_LINK_CLASSES}>
                    View
                  </Link>
                  {isContractEditable(contract.status) && contract.archivedAt === null && (
                    <Link href={`/contracts/${contract.id}/edit`} className={`ml-3 ${ACTION_LINK_CLASSES}`}>
                      Edit
                    </Link>
                  )}
                </div>
              </RecordCard>
            ))}
          </RecordCardList>
        </>
      )}
    </div>
  );
}
