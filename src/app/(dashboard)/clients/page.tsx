import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { canExportData } from "@/lib/export/authorization";
import { canImportData } from "@/lib/import/authorization";
import { PAGE_SIZE, getOffset, getTotalPages, type RawSearchParams } from "@/lib/list-params";
import { listCustomStatusDefinitions } from "@/lib/custom-statuses/definitions";
import { listTags } from "@/lib/tags/definitions";
import { getTagsForEntities } from "@/lib/tags/list-query";
import { TagChipList } from "@/components/tags/tag-chip-list";
import { DeleteButton } from "@/components/ui/delete-button";
import { deleteClientAction } from "./actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolveStatusPresentation } from "@/lib/custom-statuses/presentation";
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
import {
  parseClientListParams,
  buildClientWhere,
  buildClientOrderBy,
} from "./query";

// Page-owned primary call-to-action link (navigates, so a real <Link> —
// not the shared <Button>, which renders a <button>). Matches Button's own
// primary variant tokens (bg-accent/hover:bg-accent-hover/focus-ring) so
// this reads as the same "primary action" identity everywhere else in the
// app already does.
const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

// CSV Import/Export Phase 1 — mirrors Button's own "secondary" variant
// tokens (src/components/ui/button.tsx) applied to a plain <a>, since
// this needs to be a real navigating link (a file download), not a
// button — matches invoice-read-only-view.tsx's own "Download PDF" link
// precedent, which is also a plain <a> for the same reason.
const SECONDARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring border-border-strong bg-surface text-text-primary rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

const SORT_OPTIONS = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "name:asc", label: "Name (A–Z)" },
  { value: "name:desc", label: "Name (Z–A)" },
];

// Custom Statuses Phase 2A (Section C/P) — one shared render helper for
// both the table and mobile-card badge below, so the definition-first
// presentation resolution (resolveStatusPresentation) lives in exactly
// one place.
function ClientStatusBadge({ client }: { client: { status: string; statusDefinition: { label: string; color: import("@/generated/prisma/enums").CustomStatusColor | null } | null } }) {
  const presentation = resolveStatusPresentation(client.statusDefinition, client.status);
  return <StatusBadge status={client.status} label={presentation.label} tone={presentation.tone} />;
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { organizationId, membership } = await getCurrentMembership();
  const resolvedSearchParams = await searchParams;
  const listParams = parseClientListParams(resolvedSearchParams);
  const canImport = await canImportData(organizationId, membership.role);
  const canExport = await canExportData(organizationId, membership.role);

  const where = await buildClientWhere(organizationId, listParams);
  const orderBy = buildClientOrderBy(listParams);

  // Custom Statuses Phase 2B (Section P) — live filter options, not the
  // hardcoded CLIENT_STATUSES array: every active CLIENT definition
  // (system+custom, position order), plus the currently-selected one
  // again if it's since been archived (Section P: "archived status
  // remains selectable if currently in URL").
  const allStatusDefinitions = await listCustomStatusDefinitions(organizationId, "CLIENT", { includeArchived: true });
  const activeStatusDefinitions = allStatusDefinitions.filter((d) => d.archivedAt === null);
  const selectedArchivedDefinition = allStatusDefinitions.find(
    (d) => d.archivedAt !== null && d.key === listParams.status,
  );
  const statusFilterOptions = [
    { value: "", label: "All statuses" },
    ...activeStatusDefinitions.map((d) => ({ value: d.key, label: d.label })),
    ...(selectedArchivedDefinition
      ? [{ value: selectedArchivedDefinition.key, label: `${selectedArchivedDefinition.label} (archived)` }]
      : []),
  ];

  const [clients, total] = await prisma.$transaction([
    prisma.client.findMany({
      where,
      orderBy,
      skip: getOffset(listParams.page),
      take: PAGE_SIZE,
      include: { statusDefinition: { select: { label: true, color: true } } },
    }),
    prisma.client.count({ where }),
  ]);

  // Tags V2 (Section 4/5) — every active tag, for the filter's own option
  // list (archived tags are never offered — Section 5), plus this page's
  // own current tag assignments, bulk-fetched in one call.
  const allTags = await listTags(organizationId);
  const tagsByClientId = await getTagsForEntities(organizationId, "CLIENT", clients.map((c) => c.id));

  const totalPages = getTotalPages(total);
  const hasActiveParams = Boolean(listParams.q || listParams.status || listParams.tagId);

  // CSV Import/Export Phase 1 — the exact same filter params Pagination
  // (below) already builds, minus `page`: an export always covers every
  // matching row across every page, never just the one currently
  // visible (Section C/9 of the read-only audit).
  const listFilterParams = {
    ...(listParams.q ? { q: listParams.q } : {}),
    ...(listParams.status ? { status: listParams.status } : {}),
    ...(listParams.tagId ? { tag: listParams.tagId } : {}),
    sort: listParams.sortCombined,
  };
  const exportHref = `/api/clients/export?${new URLSearchParams(listFilterParams).toString()}`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">
            Clients
          </h1>
          <p className="text-text-secondary mt-1 text-sm">
            {total} {total === 1 ? "client" : "clients"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canImport && (
            <Link href="/clients/import" className={SECONDARY_LINK_CLASSES}>
              Import CSV
            </Link>
          )}
          {canExport && (
            <a href={exportHref} className={SECONDARY_LINK_CLASSES}>
              Export CSV
            </a>
          )}
          <Link
            href="/clients/new"
            className={PRIMARY_LINK_CLASSES}
          >
            Add client
          </Link>
        </div>
      </div>

      <SearchFilterBar
        basePath="/clients"
        searchValue={listParams.q}
        searchPlaceholder="Search by name, company, or email"
        filters={[
          {
            name: "status",
            label: "Status",
            value: listParams.status ?? "",
            options: statusFilterOptions,
          },
          {
            name: "tag",
            label: "Tag",
            value: listParams.tagId ?? "",
            options: [
              { value: "", label: "All tags" },
              ...allTags.map((tag) => ({ value: tag.id, label: tag.name })),
            ],
          },
        ]}
        sort={{ value: listParams.sortCombined, options: SORT_OPTIONS }}
        hasActiveParams={hasActiveParams}
      />

      {total === 0 ? (
        hasActiveParams ? (
          <EmptyState
            title="No matching clients"
            description="Try a different search term or clear your filters."
            action={
              <Link
                href="/clients"
                className={PRIMARY_LINK_CLASSES}
              >
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="No clients yet"
            description="Clients are the people and businesses you work with — add your first one to start creating projects, tracking tasks, and sending invoices."
            action={
              <Link
                href="/clients/new"
                className={PRIMARY_LINK_CLASSES}
              >
                Create your first client
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
                  <TableHeaderCell>Email</TableHeaderCell>
                  <TableHeaderCell>Phone</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Tags</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {clients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell emphasis>{client.name}</TableCell>
                    <TableCell>{client.company ?? "—"}</TableCell>
                    <TableCell>{client.email ?? "—"}</TableCell>
                    <TableCell>{client.phone ?? "—"}</TableCell>
                    <TableCell>
                      <ClientStatusBadge client={client} />
                    </TableCell>
                    <TableCell>
                      <TagChipList tags={tagsByClientId.get(client.id) ?? []} />
                    </TableCell>
                    <TableCell>{client.createdAt.toLocaleDateString()}</TableCell>
                    <TableCell align="right">
                      <div className="flex items-center justify-end gap-4">
                        <Link
                          href={`/clients/${client.id}/edit`}
                          className={`inline-flex items-center gap-1 ${ACTION_LINK_CLASSES}`}
                        >
                          <PencilIcon className="h-3.5 w-3.5" />
                          Edit
                        </Link>
                        <DeleteButton
                          action={deleteClientAction.bind(null, client.id)}
                          itemName={client.name}
                          confirmTitle="Delete client"
                          confirmDescription={`Delete ${client.name}? This action cannot be undone.`}
                          successMessage="Client deleted"
                          conflictMessage="This client can't be deleted because it has existing invoices."
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <RecordCardList>
            {clients.map((client) => (
              <RecordCard key={client.id}>
                <RecordCardField label="Name" value={client.name} emphasis />
                <RecordCardField label="Company" value={client.company ?? "—"} />
                <RecordCardField label="Email" value={client.email ?? "—"} />
                <RecordCardField label="Phone" value={client.phone ?? "—"} />
                <RecordCardField label="Status" value={<ClientStatusBadge client={client} />} />
                <RecordCardField label="Tags" value={<TagChipList tags={tagsByClientId.get(client.id) ?? []} />} />
                <RecordCardField label="Created" value={client.createdAt.toLocaleDateString()} />
                <RecordCardActions>
                  <Link
                    href={`/clients/${client.id}/edit`}
                    className={`inline-flex items-center gap-1 ${ACTION_LINK_CLASSES}`}
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                    Edit
                  </Link>
                  <DeleteButton
                    action={deleteClientAction.bind(null, client.id)}
                    itemName={client.name}
                    confirmTitle="Delete client"
                    confirmDescription={`Delete ${client.name}? This action cannot be undone.`}
                    successMessage="Client deleted"
                    conflictMessage="This client can't be deleted because it has existing invoices."
                  />
                </RecordCardActions>
              </RecordCard>
            ))}
          </RecordCardList>

          <Pagination
            basePath="/clients"
            params={listFilterParams}
            page={listParams.page}
            totalPages={totalPages}
          />
        </>
      )}
    </div>
  );
}
