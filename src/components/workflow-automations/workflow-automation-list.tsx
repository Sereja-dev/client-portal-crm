"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { EnableDisableButton } from "./enable-disable-button";
import { WorkflowAutomationArchiveButton } from "./archive-button";

const PRIMARY_LINK_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2";

export type WorkflowAutomationRow = {
  id: string;
  name: string;
  triggerLabel: string;
  conditionSummary: string;
  actionSummary: string;
  isEnabled: boolean;
  isArchived: boolean;
  updatedAt: string;
};

/**
 * Workflow Automations V1 — Staff Authoring UI list. Mirrors
 * LeadCaptureFormsList's own exact shape: one Table, one row component,
 * Enable/Disable + Archive wired to their own bound Server Actions.
 * Archived automations are shown read-only (no Edit/Enable-Disable/
 * Archive controls at all — V1 has no un-archive path, matching
 * RecurringInvoicesList's own identical "archived is terminal, nothing
 * left to do" treatment) rather than hidden outright, so a Staff member
 * can still see what an archived automation used to do.
 *
 * Deliberately no execution-history UI here — WorkflowAutomationRun
 * exists but is out of scope for this block (see this feature's own
 * spec).
 */
export function WorkflowAutomationList({
  automations,
  toggleEnabledAction,
  archiveAction,
}: {
  automations: WorkflowAutomationRow[];
  toggleEnabledAction: (automationId: string, isEnabled: boolean) => Promise<{ ok: boolean; reason?: string }>;
  archiveAction: (automationId: string) => Promise<{ ok: boolean; reason?: string }>;
}) {
  if (automations.length === 0) {
    return (
      <EmptyState
        title="No workflow automations yet"
        description="Automatically set a custom status or custom field when a Lead's status changes or a Client is created."
        action={
          <Link href="/settings/workflow-automations/new" className={PRIMARY_LINK_CLASSES}>
            New automation
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <div className="mt-6 flex items-center justify-end">
        <Link href="/settings/workflow-automations/new" className={PRIMARY_LINK_CLASSES}>
          New automation
        </Link>
      </div>

      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell>Name</TableHeaderCell>
            <TableHeaderCell>Trigger</TableHeaderCell>
            <TableHeaderCell className="hidden md:table-cell">Condition</TableHeaderCell>
            <TableHeaderCell className="hidden sm:table-cell">Action</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell align="right">Actions</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {automations.map((automation) => (
            <TableRow key={automation.id}>
              <TableCell emphasis>
                {automation.isArchived ? (
                  automation.name
                ) : (
                  <Link
                    href={`/settings/workflow-automations/${automation.id}`}
                    className="focus-visible:ring-focus-ring rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    {automation.name}
                  </Link>
                )}
              </TableCell>
              <TableCell>{automation.triggerLabel}</TableCell>
              <TableCell className="hidden md:table-cell">{automation.conditionSummary}</TableCell>
              <TableCell className="hidden sm:table-cell">{automation.actionSummary}</TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2">
                  {automation.isArchived ? (
                    <StatusBadge status="ARCHIVED" />
                  ) : (
                    <StatusBadge
                      status={automation.isEnabled ? "ENABLED" : "DISABLED"}
                      tone={automation.isEnabled ? "success" : "neutral"}
                      label={automation.isEnabled ? "Enabled" : "Disabled"}
                    />
                  )}
                </div>
              </TableCell>
              <TableCell align="right">
                {automation.isArchived ? (
                  <span className="text-text-muted text-xs">No actions available</span>
                ) : (
                  <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                    <Link href={`/settings/workflow-automations/${automation.id}`} className={ACTION_LINK_CLASSES}>
                      Edit
                    </Link>
                    <EnableDisableButton automationId={automation.id} isEnabled={automation.isEnabled} toggleAction={toggleEnabledAction} />
                    <WorkflowAutomationArchiveButton automationId={automation.id} archiveAction={archiveAction} />
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
