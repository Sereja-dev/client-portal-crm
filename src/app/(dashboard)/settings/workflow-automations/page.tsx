import { getCurrentMembership } from "@/lib/current-user";
import { listWorkflowAutomations } from "@/lib/workflow-automations/automations";
import { describeWorkflowAutomationTrigger, describeWorkflowAutomationConditions, describeWorkflowAutomationActions } from "@/lib/workflow-automations/format-summary";
import { loadWorkflowAutomationLabelMaps } from "./options";
import { WorkflowAutomationList, type WorkflowAutomationRow } from "@/components/workflow-automations/workflow-automation-list";
import { EmptyState } from "@/components/ui/empty-state";
import { setWorkflowAutomationEnabledAction, archiveWorkflowAutomationAction } from "./actions";

/**
 * Workflow Automations V1 — Staff Authoring UI list. OWNER/ADMIN-only,
 * exactly mirroring the Phase 1 domain layer's own gate: listWorkflowAutomations()
 * itself returns FORBIDDEN for a MEMBER, treated identically to
 * RecurringInvoicesPage's own "not available" render — never a redirect,
 * never a 404, the same discipline every other privileged-only page in
 * this app already uses.
 *
 * Shows active (non-archived) automations only — matches
 * listWorkflowAutomations' own includeArchived: false default. No
 * execution-history UI here (WorkflowAutomationRun exists but is out of
 * scope for this block — see this feature's own spec).
 */
export default async function WorkflowAutomationsSettingsPage() {
  const { user, organizationId, membership } = await getCurrentMembership();
  const actor = { id: user.id, name: user.name, role: membership.role };

  const [listResult, labelMaps] = await Promise.all([
    listWorkflowAutomations(organizationId, actor),
    loadWorkflowAutomationLabelMaps(organizationId),
  ]);

  if (!listResult.ok) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState title="Not available" description="You don't have permission to view workflow automations." />
      </div>
    );
  }

  const rows: WorkflowAutomationRow[] = listResult.workflowAutomations.map((automation) => ({
    id: automation.id,
    name: automation.name,
    triggerLabel: describeWorkflowAutomationTrigger(automation.triggerEntityType, automation.triggerAction),
    conditionSummary: describeWorkflowAutomationConditions(automation.conditions),
    actionSummary: describeWorkflowAutomationActions(automation.actions, labelMaps),
    isEnabled: automation.isEnabled,
    isArchived: automation.archivedAt !== null,
    updatedAt: automation.updatedAt.toISOString(),
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Workflow automations</h1>
      <p className="text-text-secondary mt-1 text-sm">
        Automatically set a custom status or custom field when a Lead&rsquo;s status changes or a Client is created.
      </p>

      <WorkflowAutomationList
        automations={rows}
        toggleEnabledAction={setWorkflowAutomationEnabledAction}
        archiveAction={archiveWorkflowAutomationAction}
      />
    </div>
  );
}
