import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { DocumentsTabs } from "@/components/documents/documents-tabs";
import { prisma } from "@/lib/prisma";
import { listContracts } from "@/lib/contracts/queries";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchFilterBar } from "@/components/list/search-filter-bar";
import { QuickFilterChips } from "@/components/list/quick-filter-chips";
import { ContractListWithSelection, type ContractListRow } from "@/components/contracts/contract-list-with-selection";
import { isContractEditable } from "@/lib/contracts/status";
import {
  parseContractListParams,
  buildContractOrderBy,
  buildContractsHref,
  nextContractSortCombined,
  CONTRACT_STATUS_FILTER_VALUES,
  CONTRACT_QUICK_FILTERS,
  type ContractSortField,
} from "./query";
import type { RawSearchParams } from "@/lib/list-params";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

const STATUS_FILTER_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  TERMINATED: "Terminated",
};

const CONTRACT_SORT_OPTIONS = [
  { value: "", label: "Default order" },
  { value: "issueDate:asc", label: "Issue date (earliest)" },
  { value: "issueDate:desc", label: "Issue date (latest)" },
];

/**
 * Contracts Phase 2 (Staff UI), extended by Tables Improvement Slice B
 * — the Contracts list adopts the same workflow-oriented row hierarchy
 * Invoice's Slice A pilot already established:
 *  - Row action hierarchy: active DRAFT keeps a direct Edit; every other
 *    row (active non-DRAFT, or archived regardless of status) keeps a
 *    direct View. Archive/Restore (the existing, lifecycle-agnostic,
 *    org-scoped, idempotent archiveContractAction/restoreContractAction
 *    — never duplicated) move into the shared RowActionMenu overflow.
 *    Preview/Send/Accept/Terminate stay exclusively on the Contract
 *    detail page (ContractLifecycleControls) — never surfaced here.
 *  - A single sortable desktop column (Issue date — the only one of the
 *    locked spec's own four candidate date fields already rendered as
 *    its own visible column; see query.ts's own CONTRACT_SORT_FIELDS
 *    doc comment) alongside a kept Sort-by dropdown for mobile
 *    RecordCards, which have no headers at all. Both read the exact
 *    same `?sort=field:dir` URL state.
 *  - Quick-filter chips (Draft/Sent/Accepted only — Terminated stays
 *    dropdown-only, Expired is never a chip or a filter value at all;
 *    it remains purely a canonical getContractDisplayStatus() DISPLAY
 *    state, orthogonal to this persisted-status filter) are shortcuts
 *    for the SAME singular `?status=` the dropdown already uses.
 *  - The desktop table (xl: and up) gets the same browser-proven sticky
 *    header pattern Invoice's own pilot already established — kept
 *    entirely local to this page.
 *
 * Every other behavior (tenant scoping, Active/Archived semantics,
 * Client/Project linkage, pagination-less scale, permissions) is
 * byte-for-byte unchanged from before this slice.
 */
export default async function ContractsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;
  const listParams = parseContractListParams(resolvedSearchParams);

  const [clientCount, clients, projects, contracts] = await Promise.all([
    prisma.client.count({ where: { organizationId } }),
    prisma.client.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    // Documents Slice A — same unfiltered "every org-scoped Project" shape
    // the Client filter immediately above already uses (no archived/status
    // exclusion), matching resolveContractTarget()'s own identical "any
    // in-org Project is a valid target" convention (src/lib/contracts/
    // target.ts) rather than inventing a narrower selection rule here.
    prisma.project.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    listContracts(organizationId, {
      includeArchived: listParams.archived,
      status: listParams.status,
      clientId: listParams.clientId,
      projectId: listParams.projectId,
      search: listParams.q || undefined,
      orderBy: buildContractOrderBy(listParams),
    }),
  ]);

  // listContracts()'s own `includeArchived` returns active+archived
  // TOGETHER when true, not "archived only" (matches
  // getQuoteTemplateForManagement's own identical convention) — the
  // Archived filter/view is plain array filtering on already-fetched
  // data, never a second query implementing the same rule twice.
  const visibleContracts = listParams.archived ? contracts.filter((c) => c.archivedAt !== null) : contracts;

  const canCreate = clientCount > 0;
  const hasActiveParams = Boolean(
    listParams.q || listParams.status || listParams.clientId || listParams.projectId || listParams.archived,
  );

  // Tables Improvement Slice B — the one shared base every quick-filter
  // chip and the sortable header builds its own href from, so no
  // existing filter (q/client/project/archived) is ever accidentally
  // dropped by one navigation and not another.
  const hrefBase = {
    q: listParams.q || undefined,
    client: listParams.clientId,
    project: listParams.projectId,
    archived: listParams.archived ? "1" : undefined,
  };

  const quickFilterChips = CONTRACT_QUICK_FILTERS.map((filter) => ({
    label: filter.label,
    active: listParams.status === filter.status,
    href: buildContractsHref({
      ...hrefBase,
      status: listParams.status === filter.status ? undefined : filter.status,
      sort: listParams.sortCombined,
    }),
  }));

  function sortHrefFor(field: ContractSortField): string {
    return buildContractsHref({
      ...hrefBase,
      status: listParams.status,
      sort: nextContractSortCombined(listParams, field),
    });
  }
  function directionFor(field: ContractSortField): "asc" | "desc" | null {
    return listParams.hasSort && listParams.sortField === field ? listParams.sortDir : null;
  }

  // Tables Improvement Slice C — `showEdit` pre-computed server-side
  // once per row (unchanged DRAFT-and-not-archived rule), rather than
  // re-derived inside the client selection component, which never
  // imports isContractEditable itself.
  const rows: ContractListRow[] = visibleContracts.map((contract) => ({
    id: contract.id,
    contractNumber: contract.contractNumber,
    title: contract.title,
    client: contract.client,
    project: contract.project,
    status: contract.status,
    effectiveDate: contract.effectiveDate,
    expiresAt: contract.expiresAt,
    archivedAt: contract.archivedAt,
    issueDate: contract.issueDate,
    showEdit: contract.archivedAt === null && isContractEditable(contract.status),
  }));

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
        <>
          <QuickFilterChips label="Contract quick filters" chips={quickFilterChips} />

          <SearchFilterBar
            // Tables Improvement Slice B — the quick-filter chips and the
            // sortable header are the first things on this page to change
            // `?status=`/`?sort=` via a plain client-side <Link> navigation
            // rather than a real form submission. Without a key, the
            // Status/Sort <select>s (both uncontrolled, via `defaultValue`)
            // would silently keep their stale value across such a
            // navigation — the exact issue found and fixed in Invoice's
            // own Slice A pilot (see invoices/page.tsx's own identical
            // comment). Keying on the exact state the chips/header can
            // change forces a fresh mount whenever either changes.
            key={`${listParams.status ?? "all"}:${listParams.sortCombined}`}
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
                name: "project",
                label: "Project",
                value: listParams.projectId ?? "",
                options: [{ value: "", label: "All projects" }, ...projects.map((p) => ({ value: p.id, label: p.name }))],
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
            sort={{ value: listParams.sortCombined, options: CONTRACT_SORT_OPTIONS }}
            hasActiveParams={hasActiveParams}
          />
        </>
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
          listParams.archived && !listParams.q && !listParams.status && !listParams.clientId && !listParams.projectId ? (
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
        <ContractListWithSelection
          // Tables Improvement Slice C — resets selection to empty
          // whenever the rendered result-identity set could change
          // (filters/search/status/archive/sort), rather than letting a
          // stale selected id silently remain attached to a row that may
          // no longer be rendered (locked spec §21).
          key={`${listParams.q}:${listParams.status ?? ""}:${listParams.clientId ?? ""}:${listParams.projectId ?? ""}:${listParams.archived}:${listParams.sortCombined}`}
          contracts={rows}
          canBulkSelect={!listParams.archived}
          issueDateSortHref={sortHrefFor("issueDate")}
          issueDateDirection={directionFor("issueDate")}
        />
      )}
    </div>
  );
}
