import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentMembership } from "@/lib/current-user";
import { getWorkflowAutomation } from "@/lib/workflow-automations/automations";
import { listSupportedWorkflowTriggers, isExecutableWorkflowTrigger } from "@/lib/workflow-automations/triggers";
import {
  WorkflowAutomationForm,
  type WorkflowAutomationTriggerOption,
  type WorkflowAutomationEntityOptionsUI,
  type WorkflowAutomationFormDefaultValues,
  type ConditionOperator,
} from "@/components/workflow-automations/workflow-automation-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { loadWorkflowAutomationEntityOptions } from "../options";
import { updateWorkflowAutomationAction } from "../actions";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CONDITION_OPERATORS: readonly ConditionOperator[] = ["EQUALS", "NOT_EQUALS", "CHANGED_TO", "CHANGED_FROM", "EXISTS"];

/** First stored condition, or null — this UI never configures more than one (see WorkflowAutomationForm's own header comment). */
function toDefaultCondition(storedConditions: unknown): WorkflowAutomationFormDefaultValues["condition"] {
  if (!Array.isArray(storedConditions) || storedConditions.length === 0) return null;
  const first = storedConditions[0];
  if (
    !isPlainObject(first) ||
    typeof first.field !== "string" ||
    typeof first.operator !== "string" ||
    !CONDITION_OPERATORS.includes(first.operator as ConditionOperator)
  ) {
    return null;
  }
  return {
    field: first.field,
    operator: first.operator as ConditionOperator,
    value: typeof first.value === "string" ? first.value : undefined,
  };
}

function toDefaultAction(storedActions: unknown): WorkflowAutomationFormDefaultValues["action"] {
  if (!Array.isArray(storedActions) || storedActions.length === 0) return null;
  const first = storedActions[0];
  if (!isPlainObject(first)) return null;
  if (first.type === "SET_CUSTOM_STATUS" && typeof first.customStatusDefinitionId === "string") {
    return { type: "SET_CUSTOM_STATUS", customStatusDefinitionId: first.customStatusDefinitionId };
  }
  if (
    first.type === "SET_CUSTOM_FIELD_VALUE" &&
    typeof first.customFieldDefinitionId === "string" &&
    (typeof first.value === "string" || typeof first.value === "number" || typeof first.value === "boolean")
  ) {
    return { type: "SET_CUSTOM_FIELD_VALUE", customFieldDefinitionId: first.customFieldDefinitionId, value: first.value };
  }
  return null;
}

/**
 * Workflow Automations V1 — Staff Authoring UI, edit. Only ever renders
 * for an automation owned by the current organization (getWorkflowAutomation
 * itself re-scopes by organizationId — see that function's own doc
 * comment) and never for an archived one: V1 has no un-archive path, so
 * there is nothing a normal edit flow could safely do with one (matches
 * EditRecurringInvoicePage's own "archived has no Edit link anywhere in
 * this app" redirect precedent).
 */
export default async function EditWorkflowAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, organizationId, membership } = await getCurrentMembership();
  const actor = { id: user.id, name: user.name, role: membership.role };

  const result = await getWorkflowAutomation(organizationId, id, actor);
  if (!result.ok) {
    redirect("/settings/workflow-automations");
  }
  const automation = result.workflowAutomation;
  if (!automation) {
    notFound();
  }
  if (automation.archivedAt !== null) {
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

  const boundUpdateAction = updateWorkflowAutomationAction.bind(null, automation.id);

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Edit workflow automation</h1>
        <Link href="/settings/workflow-automations" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <WorkflowAutomationForm
          mode="edit"
          action={boundUpdateAction}
          triggers={triggers}
          entityOptionsByEntityType={entityOptionsByEntityType}
          defaultValues={{
            name: automation.name,
            triggerEntityType: automation.triggerEntityType as "LEAD" | "CLIENT",
            triggerAction: automation.triggerAction as "STATUS_CHANGED" | "CREATED",
            condition: toDefaultCondition(automation.conditions),
            action: toDefaultAction(automation.actions),
          }}
          submitLabel="Save changes"
          pendingLabel="Saving…"
        />
      </div>
    </div>
  );
}
