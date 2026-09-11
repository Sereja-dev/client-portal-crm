import "server-only";
import type { WorkflowTriggerDefinition } from "./triggers";

/**
 * Workflow Automations Phase 1 — condition configuration parsing/
 * validation only. No runtime evaluation exists anywhere in this phase;
 * this module's only job is deciding whether a proposed `conditions`
 * JSON blob is a well-formed, strictly-typed list this trigger could
 * plausibly evaluate in a later phase.
 *
 * Deliberately not Zod: this codebase has no established Zod convention
 * (it isn't a direct dependency, and no module under src/lib/validation
 * uses it — see src/lib/validation/lead.ts's own plain hand-written
 * parse-function convention, which every domain module in this repo
 * follows instead). This module follows that same real convention: a
 * plain function returning a discriminated `{ ok, ... }` result, exactly
 * like parseLeadInput/parseRecurringInvoiceTemplateFields.
 *
 * Never a free-form expression language: exactly one field per V1
 * trigger ("status"), five fixed operators, a value that must already be
 * one of that trigger's own closed allowedValues.
 */

export const WORKFLOW_CONDITION_OPERATORS = ["EQUALS", "NOT_EQUALS", "CHANGED_TO", "CHANGED_FROM", "EXISTS"] as const;
export type WorkflowConditionOperator = (typeof WORKFLOW_CONDITION_OPERATORS)[number];

/** CHANGED_TO/CHANGED_FROM only make sense against a field that actually carries a {from,to} transition (see WorkflowTriggerFieldKind). */
const TRANSITION_ONLY_OPERATORS: readonly WorkflowConditionOperator[] = ["CHANGED_TO", "CHANGED_FROM"];

export type WorkflowAutomationCondition = {
  field: string;
  operator: WorkflowConditionOperator;
  /** Required for every operator except EXISTS, which never reads it. */
  value?: string;
};

export type WorkflowConditionsValidationResult =
  | { ok: true; values: WorkflowAutomationCondition[] }
  | { ok: false; error: string };

/** Bounded, same "small and deliberate, never unbounded" reasoning as every other list this codebase caps (e.g. RecurringInvoiceLineItem). */
export const MAX_WORKFLOW_CONDITIONS = 10;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOneCondition(
  raw: unknown,
  index: number,
  trigger: WorkflowTriggerDefinition,
): { ok: true; value: WorkflowAutomationCondition } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: `conditions[${index}] must be an object.` };
  }

  const { field, operator, value } = raw;

  if (typeof field !== "string" || !(field in trigger.fields)) {
    return { ok: false, error: `conditions[${index}].field must be one of: ${Object.keys(trigger.fields).join(", ")}.` };
  }
  const fieldDef = trigger.fields[field];

  if (typeof operator !== "string" || !WORKFLOW_CONDITION_OPERATORS.includes(operator as WorkflowConditionOperator)) {
    return { ok: false, error: `conditions[${index}].operator must be one of: ${WORKFLOW_CONDITION_OPERATORS.join(", ")}.` };
  }
  const parsedOperator = operator as WorkflowConditionOperator;

  if (TRANSITION_ONLY_OPERATORS.includes(parsedOperator) && fieldDef.kind !== "transition") {
    return {
      ok: false,
      error: `conditions[${index}].operator "${parsedOperator}" is only valid for a field with a real before/after transition; "${field}" on this trigger does not have one.`,
    };
  }

  if (parsedOperator === "EXISTS") {
    // EXISTS never reads `value` — a bare presence check. Every V1
    // trigger's own single field is always present in its Activity
    // metadata (it's the field the trigger itself fired on), so this
    // operator is accepted for schema-completeness/forward-compatibility
    // even though it is trivially always true against today's trigger set.
    if (value !== undefined) {
      return { ok: false, error: `conditions[${index}].value must be omitted for operator "EXISTS".` };
    }
    return { ok: true, value: { field, operator: parsedOperator } };
  }

  if (typeof value !== "string" || !fieldDef.allowedValues.includes(value)) {
    return {
      ok: false,
      error: `conditions[${index}].value must be one of: ${fieldDef.allowedValues.join(", ")}.`,
    };
  }

  return { ok: true, value: { field, operator: parsedOperator, value } };
}

/**
 * Validates a proposed `conditions` JSON value against one specific
 * trigger's own field/operator/value vocabulary. `raw` is `unknown` on
 * purpose — this is always the very first thing done to a caller-supplied
 * value, before any of it is trusted.
 */
export function parseWorkflowAutomationConditions(
  raw: unknown,
  trigger: WorkflowTriggerDefinition,
): WorkflowConditionsValidationResult {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "conditions must be an array." };
  }
  if (raw.length > MAX_WORKFLOW_CONDITIONS) {
    return { ok: false, error: `conditions must contain at most ${MAX_WORKFLOW_CONDITIONS} entries.` };
  }

  const values: WorkflowAutomationCondition[] = [];
  for (let i = 0; i < raw.length; i++) {
    const result = parseOneCondition(raw[i], i, trigger);
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }
  return { ok: true, values };
}
