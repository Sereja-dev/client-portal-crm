import "server-only";
import { parseWorkflowAutomationConditions, type WorkflowAutomationCondition } from "./conditions";
import type { WorkflowTriggerDefinition, WorkflowTriggerFieldDefinition } from "./triggers";

/**
 * Workflow Automations Phase 2 — runtime condition evaluation. Pure and
 * synchronous: no database access, no live entity re-fetch. Evaluates
 * strictly against the *original Activity metadata snapshot* passed in
 * by the caller (dispatch.ts) — the same {from, to}/{status, ...} shape
 * this trigger's own metadata builder wrote at the moment the business
 * mutation happened, never a fresh read of the entity's current state.
 * This is what makes CHANGED_TO/CHANGED_FROM meaningful: `from` is only
 * ever available in that snapshot, not in a live re-fetch (the entity
 * has already moved on by the time this runs).
 *
 * Re-validates the stored `conditions` JSON against the trigger's
 * current field/operator/value vocabulary before evaluating anything —
 * exactly the same parseWorkflowAutomationConditions Phase 1 already
 * uses at config-write time, called again here. This is what turns
 * "configuration became invalid after creation" (Phase 2 execution
 * audit §6) into a reportable INVALID_CONFIG outcome rather than either
 * a silent no-op or a thrown exception.
 */

export type WorkflowConditionEvaluation =
  | { status: "MATCHED" }
  | { status: "NOT_MATCHED" }
  | { status: "INVALID_CONFIG"; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the one value a condition's operator needs from the Activity metadata snapshot, per the field's own transition/snapshot kind (see WorkflowTriggerFieldDefinition's own comment). */
function readMetadataValue(
  metadata: unknown,
  field: string,
  fieldDef: WorkflowTriggerFieldDefinition,
  part: "current" | "from",
): string | undefined {
  const record = isPlainObject(metadata) ? metadata : {};
  if (fieldDef.kind === "transition") {
    const value = part === "from" ? record.from : record.to;
    return typeof value === "string" ? value : undefined;
  }
  // "snapshot" — no `from` exists at all; the field's own metadata key
  // holds the single current value (e.g. CLIENT.CREATED's `status`).
  if (part === "from") return undefined;
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}

function evaluateOneCondition(
  condition: WorkflowAutomationCondition,
  fieldDef: WorkflowTriggerFieldDefinition,
  metadata: unknown,
): boolean {
  if (condition.operator === "EXISTS") {
    return readMetadataValue(metadata, condition.field, fieldDef, "current") !== undefined;
  }

  const currentValue = readMetadataValue(metadata, condition.field, fieldDef, "current");

  switch (condition.operator) {
    case "EQUALS":
      return currentValue === condition.value;
    case "NOT_EQUALS":
      return currentValue !== condition.value;
    case "CHANGED_TO":
      // parseWorkflowAutomationConditions already refuses to store this
      // operator against a non-"transition" field (see conditions.ts) —
      // the kind check here is defense in depth, not the primary guard.
      return fieldDef.kind === "transition" && currentValue === condition.value;
    case "CHANGED_FROM":
      return fieldDef.kind === "transition" && readMetadataValue(metadata, condition.field, fieldDef, "from") === condition.value;
  }
}

/**
 * Empty conditions (`[]`) always match — the AND of zero clauses is
 * vacuously true, same convention dispatchNotificationsForActivity's own
 * "no rule = no-op" establishes at the opposite extreme (here: no
 * conditions = always fire, not never fire).
 */
export function evaluateWorkflowAutomationConditions(
  storedConditions: unknown,
  activityMetadata: unknown,
  trigger: WorkflowTriggerDefinition,
): WorkflowConditionEvaluation {
  const parsed = parseWorkflowAutomationConditions(storedConditions, trigger);
  if (!parsed.ok) {
    return { status: "INVALID_CONFIG", error: parsed.error };
  }

  for (const condition of parsed.values) {
    const fieldDef = trigger.fields[condition.field];
    if (!fieldDef) {
      // Unreachable in practice — parseWorkflowAutomationConditions just
      // confirmed condition.field is a real key of trigger.fields — but
      // never silently treated as a match if the impossible happens.
      return { status: "INVALID_CONFIG", error: `condition field "${condition.field}" is no longer valid for this trigger.` };
    }
    if (!evaluateOneCondition(condition, fieldDef, activityMetadata)) {
      return { status: "NOT_MATCHED" };
    }
  }

  return { status: "MATCHED" };
}
