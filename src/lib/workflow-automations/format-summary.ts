import { resolveWorkflowTrigger } from "./triggers";
import type { ActivityAction, ActivityEntityType } from "@/generated/prisma/enums";
import type { WorkflowConditionOperator } from "./conditions";

/**
 * Workflow Automations V1 — Staff Authoring UI. Pure, presentation-only
 * summary text for the list page — never used for validation or
 * execution, both of which remain exclusively the domain layer's job
 * (evaluate-conditions.ts/execute-run.ts). Deliberately no "server-only"
 * import: safe to call from a Client Component too (the list's own
 * per-row summary is computed once, server-side, and passed down as a
 * plain string prop, but this function itself has no I/O).
 */

const OPERATOR_LABELS: Record<WorkflowConditionOperator, string> = {
  EQUALS: "is",
  NOT_EQUALS: "is not",
  CHANGED_TO: "changes to",
  CHANGED_FROM: "changes from",
  EXISTS: "is set",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Trigger's own human label (e.g. "Lead stage changed") — reuses triggers.ts's own WorkflowTriggerDefinition.label directly, never a second copy of that text. */
export function describeWorkflowAutomationTrigger(entityType: ActivityEntityType, action: ActivityAction): string {
  return resolveWorkflowTrigger(entityType, action)?.label ?? `${entityType} ${action}`;
}

/** e.g. "When status changes to LOST" / "Always runs" for an empty conditions array. */
export function describeWorkflowAutomationConditions(storedConditions: unknown): string {
  if (!Array.isArray(storedConditions) || storedConditions.length === 0) {
    return "Always runs";
  }
  const parts = storedConditions.map((condition) => {
    if (!isPlainObject(condition)) return "Unknown condition";
    const field = typeof condition.field === "string" ? condition.field : "field";
    const operator = typeof condition.operator === "string" ? (condition.operator as WorkflowConditionOperator) : undefined;
    const operatorLabel = operator ? (OPERATOR_LABELS[operator] ?? operator) : "matches";
    if (operator === "EXISTS") {
      return `${field} ${operatorLabel}`;
    }
    const value = typeof condition.value === "string" ? condition.value : "…";
    return `${field} ${operatorLabel} "${value}"`;
  });
  return `When ${parts.join(" and ")}`;
}

/** e.g. "Set custom status to Qualified" / "Set Priority Tier to High" — falls back to a generic label if the referenced definition can't be resolved (e.g. deleted out from under a stale map). */
export function describeWorkflowAutomationActions(
  storedActions: unknown,
  labelMaps: { customStatusLabelById: Record<string, string>; customFieldLabelById: Record<string, string> },
): string {
  if (!Array.isArray(storedActions) || storedActions.length === 0) {
    return "No action configured";
  }
  const parts = storedActions.map((action) => {
    if (!isPlainObject(action)) return "Unknown action";
    if (action.type === "SET_CUSTOM_STATUS" && typeof action.customStatusDefinitionId === "string") {
      const label = labelMaps.customStatusLabelById[action.customStatusDefinitionId] ?? "an unknown status";
      return `Set custom status to ${label}`;
    }
    if (action.type === "SET_CUSTOM_FIELD_VALUE" && typeof action.customFieldDefinitionId === "string") {
      const label = labelMaps.customFieldLabelById[action.customFieldDefinitionId] ?? "an unknown field";
      const value = "value" in action ? String(action.value) : "…";
      return `Set ${label} to ${value}`;
    }
    return "Unknown action";
  });
  return parts.join("; ");
}
