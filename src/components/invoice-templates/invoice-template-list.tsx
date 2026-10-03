import Link from "next/link";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { RecordCardList, RecordCard, RecordCardField, RecordCardActions } from "@/components/ui/record-list";
import { ArchiveTemplateButton, RestoreTemplateButton, DuplicateTemplateButton } from "./invoice-template-row-actions";
import type { RowActionResult, DuplicateInvoiceTemplateActionResult } from "@/app/(dashboard)/settings/invoice-templates/actions";

export type InvoiceTemplateRow = {
  id: string;
  name: string;
  currency: string;
  itemCount: number;
  dueDateOffsetDays: number | null;
  archived: boolean;
};

/**
 * Invoice Templates V1 — the list itself. Same "real `<table>` at `xl`
 * and up, `RecordCardList` below it" responsive pair
 * src/components/quote-templates/quote-template-list.tsx's own identical
 * shape already uses — the same data mapped twice in JSX, never fetched
 * or computed twice.
 *
 * Archived rows never show Edit or "Use template" (an archived template
 * cannot be applied — getActiveInvoiceTemplateForApply's own enforcement
 * point in apply.ts) — only Duplicate and Restore. Active rows show Edit,
 * "Use template", Duplicate, and Archive. Neither row ever shows a
 * hard-delete control.
 *
 * "Use template" links straight to `/invoices/new?templateId=<id>` — the
 * ordinary New Invoice flow, which independently re-verifies the
 * template is active server-side (apply.ts's own
 * getActiveInvoiceTemplateForApply) regardless of this link ever
 * rendering.
 */
export function InvoiceTemplateList({
  templates,
  archiveAction,
  restoreAction,
  duplicateAction,
}: {
  templates: InvoiceTemplateRow[];
  archiveAction: (templateId: string) => Promise<RowActionResult>;
  restoreAction: (templateId: string) => Promise<RowActionResult>;
  duplicateAction: (templateId: string) => Promise<DuplicateInvoiceTemplateActionResult>;
}) {
  return (
    <>
      <div className="hidden xl:block">
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Currency</TableHeaderCell>
              <TableHeaderCell align="right">Items</TableHeaderCell>
              <TableHeaderCell>Due</TableHeaderCell>
              <TableHeaderCell align="right">Actions</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {templates.map((template) => (
              <TableRow key={template.id}>
                <TableCell emphasis>{template.name}</TableCell>
                <TableCell>{template.currency}</TableCell>
                <TableCell align="right">{template.itemCount}</TableCell>
                <TableCell>
                  {template.dueDateOffsetDays != null
                    ? template.dueDateOffsetDays === 0
                      ? "Due on receipt"
                      : `${template.dueDateOffsetDays} day${template.dueDateOffsetDays === 1 ? "" : "s"}`
                    : "—"}
                </TableCell>
                <TableCell align="right">
                  <div className="flex items-center justify-end gap-4">
                    {!template.archived && (
                      <>
                        <Link href={`/settings/invoice-templates/${template.id}`} className={ACTION_LINK_CLASSES}>
                          Edit
                        </Link>
                        <Link href={`/invoices/new?templateId=${template.id}`} className={ACTION_LINK_CLASSES}>
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
            <RecordCardField label="Currency" value={template.currency} />
            <RecordCardField label="Items" value={template.itemCount} />
            <RecordCardField
              label="Due"
              value={
                template.dueDateOffsetDays != null
                  ? template.dueDateOffsetDays === 0
                    ? "Due on receipt"
                    : `${template.dueDateOffsetDays} day${template.dueDateOffsetDays === 1 ? "" : "s"}`
                  : "—"
              }
            />
            <RecordCardActions>
              {!template.archived && (
                <>
                  <Link href={`/settings/invoice-templates/${template.id}`} className={ACTION_LINK_CLASSES}>
                    Edit
                  </Link>
                  <Link href={`/invoices/new?templateId=${template.id}`} className={ACTION_LINK_CLASSES}>
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
