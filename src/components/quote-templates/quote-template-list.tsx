import Link from "next/link";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { RecordCardList, RecordCard, RecordCardField, RecordCardActions } from "@/components/ui/record-list";
import { ArchiveTemplateButton, RestoreTemplateButton, DuplicateTemplateButton } from "./quote-template-row-actions";
import type { RowActionResult, DuplicateQuoteTemplateActionResult } from "@/app/(dashboard)/settings/templates/actions";

export type QuoteTemplateRow = {
  id: string;
  name: string;
  title: string | null;
  currency: string;
  itemCount: number;
  validityDays: number | null;
  archived: boolean;
};

/**
 * Quote Templates Phase 2 (Section B/D) — the list itself. Same
 * "real `<table>` at `xl` and up, `RecordCardList` below it" responsive
 * pair every other list page in this app already uses (see
 * src/components/ui/record-list.tsx's own header comment for the
 * measured 1280px breakpoint reasoning) — the same data mapped twice in
 * JSX, never fetched or computed twice.
 *
 * Archived rows never show Edit (Section C's own chosen rule — see
 * page.tsx's own comment: archived must be restored before it can be
 * edited again, matching Custom Fields' identical precedent) — only
 * Duplicate and Restore. Active rows show Edit, Duplicate, and Archive.
 * Neither row ever shows a hard-delete control.
 */
export function QuoteTemplateList({
  templates,
  archiveAction,
  restoreAction,
  duplicateAction,
}: {
  templates: QuoteTemplateRow[];
  archiveAction: (templateId: string) => Promise<RowActionResult>;
  restoreAction: (templateId: string) => Promise<RowActionResult>;
  duplicateAction: (templateId: string) => Promise<DuplicateQuoteTemplateActionResult>;
}) {
  return (
    <>
      <div className="hidden xl:block">
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Quote title</TableHeaderCell>
              <TableHeaderCell>Currency</TableHeaderCell>
              <TableHeaderCell align="right">Items</TableHeaderCell>
              <TableHeaderCell>Validity</TableHeaderCell>
              <TableHeaderCell align="right">Actions</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {templates.map((template) => (
              <TableRow key={template.id}>
                <TableCell emphasis>{template.name}</TableCell>
                <TableCell>{template.title ?? "—"}</TableCell>
                <TableCell>{template.currency}</TableCell>
                <TableCell align="right">{template.itemCount}</TableCell>
                <TableCell>{template.validityDays != null ? `${template.validityDays} day${template.validityDays === 1 ? "" : "s"}` : "—"}</TableCell>
                <TableCell align="right">
                  <div className="flex items-center justify-end gap-4">
                    {!template.archived && (
                      <Link href={`/settings/templates/${template.id}`} className={ACTION_LINK_CLASSES}>
                        Edit
                      </Link>
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
            <RecordCardField label="Quote title" value={template.title ?? "—"} />
            <RecordCardField label="Currency" value={template.currency} />
            <RecordCardField label="Items" value={template.itemCount} />
            <RecordCardField
              label="Validity"
              value={template.validityDays != null ? `${template.validityDays} day${template.validityDays === 1 ? "" : "s"}` : "—"}
            />
            <RecordCardActions>
              {!template.archived && (
                <Link href={`/settings/templates/${template.id}`} className={ACTION_LINK_CLASSES}>
                  Edit
                </Link>
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
