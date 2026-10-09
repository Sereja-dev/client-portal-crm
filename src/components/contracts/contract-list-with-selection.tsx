"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { ContractStatusBadge } from "@/components/contracts/contract-status-badge";
import { ContractArchiveRestoreAction } from "@/components/contracts/contract-archive-restore-action";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { RowActionMenu, RowActionMenuItem } from "@/components/ui/row-action-menu";
import { SortableHeader } from "@/components/ui/sortable-header";
import { TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { RecordCardList, RecordCard, RecordCardField, RecordCardActions } from "@/components/ui/record-list";
import { BulkActionBar } from "@/components/list/bulk-action-bar";
import { useBoundedSelection, BULK_SELECTION_MAX } from "@/components/list/use-bounded-selection";
import { useColumnVisibility } from "@/components/list/column-visibility-context";
import { useToast } from "@/components/toast/toast-provider";
import { bulkArchiveContractsAction } from "@/app/(dashboard)/contracts/bulk-actions";

export type ContractListRow = {
  id: string;
  contractNumber: string;
  title: string;
  client: { id: string; name: string };
  project: { id: string; name: string } | null;
  status: "DRAFT" | "SENT" | "ACCEPTED" | "TERMINATED";
  effectiveDate: Date | null;
  expiresAt: Date | null;
  archivedAt: Date | null;
  issueDate: Date;
  showEdit: boolean;
};

/**
 * Tables Improvement Slice C — the desktop table + mobile RecordCardList
 * for the Contracts list, now with an optional selection checkbox column
 * feeding a bulk-Archive BulkActionBar. Mirrors
 * TaskListWithSelection's own architecture (plain client `useState<Set>`
 * selection, never persisted, the real authorization/tenant-safety
 * boundary entirely server-side in bulk-actions.ts) with one addition:
 * Contracts has no pagination, so `useBoundedSelection` (not needed by
 * Tasks, whose own PAGE_SIZE already bounds "select all" under the cap)
 * is what keeps "select all" truthful here.
 *
 * `canBulkSelect` is false on the Archived view — no bulk Restore exists
 * in this slice (locked spec §12), so selection/BulkActionBar simply
 * never render there; every row still gets its own existing per-row
 * View + overflow Restore, byte-identical to before this slice.
 *
 * `selectionResetKey` is set by the server-rendered page itself to the
 * exact filter/sort/archive state currently in the URL — this whole
 * component is given that same value as its own React `key` at the call
 * site, so a filter/search/sort/archive change always mounts a fresh
 * instance with empty selection, never carrying a stale id forward that
 * no longer appears in the newly-rendered result set (locked spec §21).
 */
export function ContractListWithSelection({
  contracts,
  canBulkSelect,
  issueDateSortHref,
  issueDateDirection,
}: {
  contracts: ContractListRow[];
  canBulkSelect: boolean;
  issueDateSortHref: string;
  issueDateDirection: "asc" | "desc" | null;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const ids = contracts.map((c) => c.id);
  const { selected, toggle, toggleAll, clear, canSelectAll, isAtCap } = useBoundedSelection(ids);
  // Tables Improvement Slice E2 — Column Customization reuses the
  // shared hook/control/provider shipped in Slice E1 unmodified; this
  // component is the EXISTING client boundary (Slice C, no new one
  // introduced). `isVisible` only ever gates the four OPTIONAL desktop
  // columns below (Title/Client/Project/Issue date) — Contract #/
  // Status/Actions render unconditionally, and the bulk-selection
  // checkbox column (a raw `<th>`/`<td>`, gated by `canBulkSelect`
  // alone, a few lines below) is never consulted against this at all —
  // it is not a customizable column (locked spec §5/§11). Mobile
  // RecordCardList below is completely untouched by `isVisible`
  // (locked spec §10 — desktop-only).
  const { isVisible } = useColumnVisibility();

  function applyBulkArchive(): void {
    startTransition(async () => {
      const result = await bulkArchiveContractsAction([...selected]);
      if (result.failedCount === 0) {
        showToast(`Archived ${result.updatedCount} contract${result.updatedCount === 1 ? "" : "s"}`);
      } else {
        showToast(`Archived ${result.updatedCount}, ${result.failedCount} could not be archived`, "error");
      }
      clear();
      router.refresh();
    });
  }

  return (
    <>
      <div className="hidden xl:block">
        <div className={`mt-6 max-h-[70vh] overflow-x-auto overflow-y-auto ${CARD_SURFACE_CLASSES}`}>
          <table className="divide-border-default min-w-full divide-y text-sm">
            <TableHead className="sticky top-0 z-10">
              <tr>
                {canBulkSelect && (
                  // A raw <th>, not TableHeaderCell, deliberately — this is
                  // a selection control, not a real data column (mirrors
                  // TaskListWithSelection's own identical reasoning, which
                  // preserves the one-trailing-Actions-header convention
                  // responsive-list-tables-adoption-contract.test.ts asserts
                  // on every other list page).
                  <th scope="col" className="text-text-muted px-4 py-3 text-left font-medium">
                    <input
                      type="checkbox"
                      aria-label={
                        canSelectAll
                          ? "Select all visible contracts"
                          : `Select all is unavailable — narrow filters to 50 or fewer contracts to select all`
                      }
                      checked={selected.size > 0 && selected.size === contracts.length}
                      disabled={!canSelectAll}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                <TableHeaderCell>Contract #</TableHeaderCell>
                {isVisible("title") && <TableHeaderCell>Title</TableHeaderCell>}
                {isVisible("client") && <TableHeaderCell>Client</TableHeaderCell>}
                {isVisible("project") && <TableHeaderCell className="hidden lg:table-cell">Project</TableHeaderCell>}
                <TableHeaderCell>Status</TableHeaderCell>
                {isVisible("issueDate") && (
                  <SortableHeader label="Issue date" href={issueDateSortHref} direction={issueDateDirection} />
                )}
                <TableHeaderCell align="right">Actions</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {contracts.map((contract) => {
                const isArchived = contract.archivedAt !== null;
                const isSelected = selected.has(contract.id);
                return (
                  <TableRow key={contract.id}>
                    {canBulkSelect && (
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Select contract ${contract.contractNumber}`}
                          checked={isSelected}
                          disabled={!isSelected && isAtCap}
                          onChange={() => toggle(contract.id)}
                        />
                      </TableCell>
                    )}
                    <TableCell emphasis>{contract.contractNumber}</TableCell>
                    {isVisible("title") && <TableCell>{contract.title}</TableCell>}
                    {isVisible("client") && (
                      <TableCell>
                        <Link href={`/clients/${contract.client.id}`} className={ACTION_LINK_CLASSES}>
                          {contract.client.name}
                        </Link>
                      </TableCell>
                    )}
                    {isVisible("project") && (
                      <TableCell className="hidden lg:table-cell">{contract.project?.name ?? "—"}</TableCell>
                    )}
                    <TableCell>
                      <ContractStatusBadge contract={contract} />
                      {isArchived && <span className="text-text-muted ml-2 text-xs">Archived</span>}
                    </TableCell>
                    {isVisible("issueDate") && (
                      // Contracts hydration fix — ContractListWithSelection is
                      // a "use client" component that both server-renders and
                      // hydrates, so this formatting call runs once in each
                      // environment. formatDateOnlyForDisplay's own `locale`
                      // param defaults to the runtime's own default locale
                      // when omitted, which can genuinely differ between the
                      // Node SSR process and the visiting browser — pinning an
                      // explicit "en-US" here makes both renders produce
                      // byte-identical text, eliminating a real, reproducible
                      // React hydration mismatch (proven via a dedicated
                      // read-only audit: raw SSR output rendered "01.06.2026"
                      // while the browser's own first paint rendered
                      // "6/1/2026" for the identical date). Server-only
                      // callers (e.g. Invoice's own page.tsx, which formats
                      // dates inside the Server Component before handing
                      // already-rendered JSX to its own Client Component) are
                      // never affected by this class of bug at all and are
                      // deliberately left on the helper's own default. Column
                      // Customization (Slice E2) only gates whether this cell
                      // renders at all — it never touches the locale pin.
                      <TableCell>{formatDateOnlyForDisplay(contract.issueDate, "en-US")}</TableCell>
                    )}
                    <TableCell align="right">
                      <div className="flex items-center justify-end gap-3">
                        {contract.showEdit ? (
                          <Link href={`/contracts/${contract.id}/edit`} className={ACTION_LINK_CLASSES}>
                            Edit
                          </Link>
                        ) : (
                          <Link href={`/contracts/${contract.id}`} className={ACTION_LINK_CLASSES}>
                            View
                          </Link>
                        )}
                        <RowActionMenu label={`More actions for contract ${contract.contractNumber}`}>
                          <RowActionMenuItem>
                            <ContractArchiveRestoreAction contractId={contract.id} isArchived={isArchived} />
                          </RowActionMenuItem>
                        </RowActionMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </table>
        </div>
      </div>

      <RecordCardList>
        {contracts.map((contract) => {
          const isArchived = contract.archivedAt !== null;
          const isSelected = selected.has(contract.id);
          return (
            <RecordCard key={contract.id}>
              {canBulkSelect && (
                <label className="text-text-secondary mb-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`Select contract ${contract.contractNumber}`}
                    checked={isSelected}
                    disabled={!isSelected && isAtCap}
                    onChange={() => toggle(contract.id)}
                  />
                  Select
                </label>
              )}
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
                    {isArchived && <span className="text-text-muted ml-2 text-xs">Archived</span>}
                  </>
                }
              />
              {/* Contracts hydration fix — see the desktop TableCell's own identical comment above for the full "why". */}
              <RecordCardField label="Issue date" value={formatDateOnlyForDisplay(contract.issueDate, "en-US")} />
              <RecordCardActions>
                {contract.showEdit ? (
                  <Link href={`/contracts/${contract.id}/edit`} className={ACTION_LINK_CLASSES}>
                    Edit
                  </Link>
                ) : (
                  <Link href={`/contracts/${contract.id}`} className={ACTION_LINK_CLASSES}>
                    View
                  </Link>
                )}
                <RowActionMenu label={`More actions for contract ${contract.contractNumber}`}>
                  <RowActionMenuItem>
                    <ContractArchiveRestoreAction contractId={contract.id} isArchived={isArchived} />
                  </RowActionMenuItem>
                </RowActionMenu>
              </RecordCardActions>
            </RecordCard>
          );
        })}
      </RecordCardList>

      {canBulkSelect && (
        <BulkActionBar selectedCount={selected.size} maxSelectable={BULK_SELECTION_MAX} onClear={clear} clearDisabled={pending}>
          <span className="text-text-secondary text-sm">Action: Archive</span>
          <button
            type="button"
            onClick={applyBulkArchive}
            disabled={pending}
            className="focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {pending ? "Archiving…" : "Apply"}
          </button>
        </BulkActionBar>
      )}
    </>
  );
}
