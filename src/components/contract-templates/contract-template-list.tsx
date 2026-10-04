import Link from "next/link";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { RecordCardList, RecordCard, RecordCardField, RecordCardActions } from "@/components/ui/record-list";
import { ArchiveTemplateButton, RestoreTemplateButton, DuplicateTemplateButton } from "./contract-template-row-actions";
import type { RowActionResult, DuplicateContractTemplateActionResult } from "@/app/(dashboard)/settings/contract-templates/actions";

export type ContractTemplateRow = {
  id: string;
  name: string;
  title: string;
  defaultExpiryOffsetDays: number | null;
  archived: boolean;
};

function formatExpiryOffset(days: number | null): string {
  if (days == null) return "—";
  return days === 0 ? "Same day as issue" : `${days} day${days === 1 ? "" : "s"} after issue`;
}

/**
 * Contract Templates V1 — the list itself. Same "real `<table>` at `xl`
 * and up, `RecordCardList` below it" responsive pair
 * src/components/invoice-templates/invoice-template-list.tsx's own
 * identical shape already uses — the same data mapped twice in JSX,
 * never fetched or computed twice.
 *
 * Archived rows never show Edit or "Use template" (an archived template
 * cannot be applied — getActiveContractTemplateForApply's own
 * enforcement point in apply.ts) — only Duplicate and Restore. Active
 * rows show Edit, "Use template", Duplicate, and Archive. Neither row
 * ever shows a hard-delete control.
 *
 * "Use template" links straight to `/contracts/new?templateId=<id>` —
 * the ordinary New Contract flow, which independently re-verifies the
 * template is active server-side (apply.ts's own
 * getActiveContractTemplateForApply) regardless of this link ever
 * rendering. No Client/Project/signatory column here at all — a
 * Contract Template is deliberately agnostic to all three (see
 * ContractTemplate's own schema comment).
 */
export function ContractTemplateList({
  templates,
  archiveAction,
  restoreAction,
  duplicateAction,
}: {
  templates: ContractTemplateRow[];
  archiveAction: (templateId: string) => Promise<RowActionResult>;
  restoreAction: (templateId: string) => Promise<RowActionResult>;
  duplicateAction: (templateId: string) => Promise<DuplicateContractTemplateActionResult>;
}) {
  return (
    <>
      <div className="hidden xl:block">
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Contract title</TableHeaderCell>
              <TableHeaderCell>Expiry</TableHeaderCell>
              <TableHeaderCell align="right">Actions</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {templates.map((template) => (
              <TableRow key={template.id}>
                <TableCell emphasis>{template.name}</TableCell>
                <TableCell>{template.title}</TableCell>
                <TableCell>{formatExpiryOffset(template.defaultExpiryOffsetDays)}</TableCell>
                <TableCell align="right">
                  <div className="flex items-center justify-end gap-4">
                    {!template.archived && (
                      <>
                        <Link href={`/settings/contract-templates/${template.id}`} className={ACTION_LINK_CLASSES}>
                          Edit
                        </Link>
                        <Link href={`/contracts/new?templateId=${template.id}`} className={ACTION_LINK_CLASSES}>
                          Use template
                        </Link>
                      </>
                    )}
                    <DuplicateTemplateButton templateId={template.id} name={template.name} action={duplicateAction} />
                    {template.archived ? (
                      <RestoreTemplateButton templateId={template.id} name={template.name} action={restoreAction} />
                    ) : (
                      <ArchiveTemplateButton templateId={template.id} name={template.name} action={archiveAction} />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <RecordCardList>
        {templates.map((template) => (
          <RecordCard key={template.id}>
            <RecordCardField label="Name" value={template.name} emphasis />
            <RecordCardField label="Contract title" value={template.title} />
            <RecordCardField label="Expiry" value={formatExpiryOffset(template.defaultExpiryOffsetDays)} />
            <RecordCardActions>
              {!template.archived && (
                <>
                  <Link href={`/settings/contract-templates/${template.id}`} className={ACTION_LINK_CLASSES}>
                    Edit
                  </Link>
                  <Link href={`/contracts/new?templateId=${template.id}`} className={ACTION_LINK_CLASSES}>
                    Use template
                  </Link>
                </>
              )}
              <DuplicateTemplateButton templateId={template.id} name={template.name} action={duplicateAction} />
              {template.archived ? (
                <RestoreTemplateButton templateId={template.id} name={template.name} action={restoreAction} />
              ) : (
                <ArchiveTemplateButton templateId={template.id} name={template.name} action={archiveAction} />
              )}
            </RecordCardActions>
          </RecordCard>
        ))}
      </RecordCardList>
    </>
  );
}
