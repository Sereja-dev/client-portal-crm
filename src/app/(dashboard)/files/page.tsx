import { getCurrentUserOrganization } from "@/lib/current-user";
import { DocumentsTabs } from "@/components/documents/documents-tabs";
import { listGlobalAttachments, resolveFileEntityContexts, fileEntityContextKey } from "@/lib/files/queries";
import { formatFileSize } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { SearchFilterBar } from "@/components/list/search-filter-bar";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { RecordCardList, RecordCard, RecordCardField, RecordCardActions } from "@/components/ui/record-list";
import { parseFilesListParams } from "./query";
import type { RawSearchParams } from "@/lib/list-params";

const ENTITY_TYPE_FILTER_LABELS: Record<string, string> = {
  CLIENT: "Clients",
  PROJECT: "Projects",
  INVOICE: "Invoices",
};

/**
 * Documents Slice D — Global Files V1. A read-only, tenant-scoped index
 * over EXISTING attachments already uploaded through the Client/Project/
 * Invoice workflows (locked spec §5) — no new upload surface, no
 * CONTRACT entity type, no new Storage mechanism. Reuses the exact same
 * authorized download path every existing attachments-section.tsx
 * already uses (`/api/attachments/[id]/download`, unchanged) — this
 * page never creates a direct Storage URL or exposes a bucket/object
 * path itself.
 *
 * Entity context (which Client/Project/Invoice a file belongs to) is
 * resolved via one small, bounded batch lookup
 * (resolveFileEntityContexts) — never N+1 per-row queries, and never a
 * second interpretation of Attachment's own generic entityType/entityId
 * shape (it has no declared Prisma relation to follow). A foreign-org,
 * deleted, or otherwise-missing backing record renders as a neutral
 * "Unavailable" context — the row itself (and the rest of the page)
 * never fails or crashes, and this never distinguishes *why* a context
 * is missing (never leaks whether a foreign-org record with that id
 * exists).
 */
export default async function FilesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;
  const listParams = parseFilesListParams(resolvedSearchParams);

  const attachments = await listGlobalAttachments(organizationId, {
    entityType: listParams.entityType,
    search: listParams.q || undefined,
  });
  const contexts = await resolveFileEntityContexts(organizationId, attachments);

  const hasActiveParams = Boolean(listParams.q || listParams.entityType);

  return (
    <div>
      <DocumentsTabs />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Files</h1>
          <p className="text-text-secondary mt-1 text-sm">
            {attachments.length} {attachments.length === 1 ? "file" : "files"}
          </p>
        </div>
      </div>

      <SearchFilterBar
        basePath="/files"
        searchValue={listParams.q}
        searchPlaceholder="Search by file name"
        filters={[
          {
            name: "type",
            label: "Type",
            value: listParams.entityType ?? "",
            options: [
              { value: "", label: "All types" },
              ...Object.entries(ENTITY_TYPE_FILTER_LABELS).map(([value, label]) => ({ value, label })),
            ],
          },
        ]}
        hasActiveParams={hasActiveParams}
      />

      {attachments.length === 0 ? (
        hasActiveParams ? (
          <EmptyState
            title="No matching files"
            description="Try a different search term or clear your filters."
            action={
              <a href="/files" className={ACTION_LINK_CLASSES}>
                Clear filters
              </a>
            }
          />
        ) : (
          <EmptyState
            title="No files yet"
            description="Files uploaded to Clients, Projects, or Invoices appear here."
          />
        )
      ) : (
        <>
          <div className="hidden xl:block">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>File name</TableHeaderCell>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Related record</TableHeaderCell>
                  <TableHeaderCell>Uploaded</TableHeaderCell>
                  <TableHeaderCell align="right">Size</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {attachments.map((attachment) => {
                  const context = contexts.get(fileEntityContextKey(attachment.entityType, attachment.entityId));
                  return (
                    <TableRow key={attachment.id}>
                      <TableCell emphasis>
                        <span className="block max-w-xs truncate">{attachment.originalName}</span>
                      </TableCell>
                      <TableCell>{ENTITY_TYPE_FILTER_LABELS[attachment.entityType] ?? attachment.entityType}</TableCell>
                      <TableCell>
                        {context ? (
                          <a href={context.href} className={ACTION_LINK_CLASSES}>
                            {context.label}
                          </a>
                        ) : (
                          <span className="text-text-muted">Unavailable</span>
                        )}
                      </TableCell>
                      <TableCell>{attachment.createdAt.toLocaleDateString()}</TableCell>
                      <TableCell align="right">{formatFileSize(attachment.sizeBytes)}</TableCell>
                      <TableCell align="right">
                        <a href={`/api/attachments/${attachment.id}/download`} className={ACTION_LINK_CLASSES}>
                          Download
                        </a>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <RecordCardList>
            {attachments.map((attachment) => {
              const context = contexts.get(fileEntityContextKey(attachment.entityType, attachment.entityId));
              return (
                <RecordCard key={attachment.id}>
                  <RecordCardField label="File name" value={attachment.originalName} emphasis />
                  <RecordCardField label="Type" value={ENTITY_TYPE_FILTER_LABELS[attachment.entityType] ?? attachment.entityType} />
                  <RecordCardField
                    label="Related record"
                    value={
                      context ? (
                        <a href={context.href} className={ACTION_LINK_CLASSES}>
                          {context.label}
                        </a>
                      ) : (
                        <span className="text-text-muted">Unavailable</span>
                      )
                    }
                  />
                  <RecordCardField label="Uploaded" value={attachment.createdAt.toLocaleDateString()} />
                  <RecordCardField label="Size" value={formatFileSize(attachment.sizeBytes)} />
                  <RecordCardActions>
                    <a href={`/api/attachments/${attachment.id}/download`} className={ACTION_LINK_CLASSES}>
                      Download
                    </a>
                  </RecordCardActions>
                </RecordCard>
              );
            })}
          </RecordCardList>
        </>
      )}
    </div>
  );
}
