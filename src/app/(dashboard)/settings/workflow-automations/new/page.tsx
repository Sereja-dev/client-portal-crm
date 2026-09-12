import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMembership } from "@/lib/current-user";
import { listSupportedWorkflowTriggers, isExecutableWorkflowTrigger } from "@/lib/workflow-automations/triggers";
import { WorkflowAutomationForm, type WorkflowAutomationTriggerOption, type WorkflowAutomationEntityOptionsUI } from "@/components/workflow-automations/workflow-automation-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { loadWorkflowAutomationEntityOptions } from "../options";
import { createWorkflowAutomationAction } from "../actions";

/**
 * Workflow Automations V1 — Staff Authoring UI, "New automation".
 * OWNER/ADMIN-only — a MEMBER is redirected outright rather than shown a
 * form that would only ever fail server-side (createWorkflowAutomationAction
 * independently re-verifies this regardless), matching NewRecurringInvoicePage's
 * own identical "gate the page, not just the action" discipline.
 *
 * Only the Phase 2 executable trigger allowlist (LEAD.STATUS_CHANGED,
 * CLIENT.CREATED) is ever offered — never INVOICE.STATUS_CHANGED/
 * CLIENT_REQUEST.STATUS_CHANGED, which have no executable V1 action yet
 * (see triggers.ts's own isExecutableWorkflowTrigger comment). Both
 * functions here are the exact, unchanged Phase 1/2 exports — this page
 * composes them, it does not re-derive the allowlist itself.
 */
export default async function NewWorkflowAutomationPage() {
  const { organizationId, membership } = await getCurrentMembership();
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    redirect("/settings/workflow-automations");
  }

  const executableTriggers = listSupportedWorkflowTriggers().filter((trigger) =>
    isExecutableWorkflowTrigger(trigger.entityType, trigger.action),
  );

  const triggers: WorkflowAutomationTriggerOption[] = executableTriggers.map((trigger) => ({
    entityType: trigger.entityType as "LEAD" | "CLIENT",
    action: trigger.action as "STATUS_CHANGED" | "CREATED",
    label: trigger.label,
    fields: Object.entries(trigger.fields).map(([name, field]) => ({
      name,
      kind: field.kind,
      allowedValues: [...field.allowedValues],
    })),
    // Every currently-executable trigger has one (see triggers.ts's own
    // comment: only LEAD/CLIENT carry a Custom Status/Field
    // correspondence) — falling back to the trigger's own entityType is
    // defensive only, never actually reachable for this allowlist.
    customReferenceEntityType: (trigger.customReferenceEntityType ?? trigger.entityType) as "LEAD" | "CLIENT",
  }));

  const [leadOptions, clientOptions] = await Promise.all([
    loadWorkflowAutomationEntityOptions(organizationId, "LEAD"),
    loadWorkflowAutomationEntityOptions(organizationId, "CLIENT"),
  ]);
  const entityOptionsByEntityType: Record<"LEAD" | "CLIENT", WorkflowAutomationEntityOptionsUI> = {
    LEAD: leadOptions,
    CLIENT: clientOptions,
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">New workflow automation</h1>
        <Link href="/settings/workflow-automations" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <WorkflowAutomationForm
          mode="create"
          action={createWorkflowAutomationAction}
          triggers={triggers}
          entityOptionsByEntityType={entityOptionsByEntityType}
          submitLabel="Create automation"
          pendingLabel="Creating…"
        />
      </div>
    </div>
  );
}
