import "server-only";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import type { WorkflowTriggerDefinition } from "./triggers";
import {
  validateCustomStatusReference,
  validateCustomFieldReference,
  checkCustomFieldValueCompatibility,
} from "./custom-reference-validation";

/**
 * Workflow Automations Phase 1 — action configuration parsing/validation
 * only. No action defined here is ever executed anywhere in this phase;
 * createActivity() is not wired to evaluate or dispatch any of this (see
 * src/lib/activity/create-activity.ts's own header comment, untouched by
 * this phase).
 *
 * Explicit V1 action allowlist — exactly two types, both internal/
 * database-only, both backed by an existing, real, organization-scoped
 * domain function already in this codebase:
 *
 *   SET_CUSTOM_STATUS      — mirrors src/lib/custom-statuses/assignment.ts's
 *                             own assignClientStatus/assignLeadStatus (a
 *                             "dumb" status swap; never touches Portal/
 *                             billing behavior — see that module's own
 *                             header comment).
 *   SET_CUSTOM_FIELD_VALUE — mirrors src/lib/custom-fields/values.ts's own
 *                             upsertCustomFieldValue.
 *
 * Every other action the audit considered was deliberately omitted this
 * phase because no clearly-safe, already-existing, reusable domain
 * function was confirmed for it within this phase's own scope:
 *
 *   ADD_INTERNAL_NOTE — Invoice's own internalNotes editor
 *     (src/app/(dashboard)/invoices/[id]/internal-notes-actions.ts) is a
 *     Server Action, not an extracted domain function, and it *replaces*
 *     the entire field rather than appending — an automation silently
 *     overwriting a Staff-authored free-text field is a data-safety risk
 *     this phase does not attempt to resolve. No other entity in this
 *     trigger allowlist has an equivalent notes field at all.
 *   CREATE_TASK — Task's own required relation is to a Project, not to a
 *     Lead/Invoice/ClientRequest/Client directly; no existing domain
 *     function creates a Task generically "from" an arbitrary triggering
 *     entity. Needs real design, not a rushed Phase 1 guess.
 *   ASSIGN_OWNER / post an in-app Notification — no single existing
 *     domain function was confirmed reusable across every trigger entity
 *     within this phase's own inspection budget; deferred rather than
 *     built inconsistently per-entity.
 *
 * Explicitly, permanently forbidden for Workflow Automations (not just
 * "deferred") per this feature's own hard rules: invoice issuance/
 * finalization/numbering, PDF generation, outbound email, recurring
 * invoice generation, payments, Paddle actions, Resend actions, any
 * external API/webhook, destructive delete, destructive archive, any
 * Portal-visible mutation, arbitrary code, and automation chaining (one
 * automation triggering another). None of these has a code path in this
 * module, and none should ever be added without a dedicated readiness
 * review of its own.
 *
 * Deliberately not Zod — see conditions.ts's own header comment for the
 * full "this repo's real convention is hand-written parse functions"
 * reasoning, which applies identically here.
 */

export const WORKFLOW_ACTION_TYPES = ["SET_CUSTOM_STATUS", "SET_CUSTOM_FIELD_VALUE"] as const;
export type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number];

export type WorkflowAutomationAction =
  | { type: "SET_CUSTOM_STATUS"; customStatusDefinitionId: string }
  | { type: "SET_CUSTOM_FIELD_VALUE"; customFieldDefinitionId: string; value: string | number | boolean };

export type WorkflowActionsValidationResult =
  | { ok: true; values: WorkflowAutomationAction[] }
  | { ok: false; error: string };

/** Same "small and deliberate" bound as MAX_WORKFLOW_CONDITIONS. */
export const MAX_WORKFLOW_ACTIONS = 5;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function parseOneAction(
  raw: unknown,
  index: number,
  organizationId: string,
  trigger: WorkflowTriggerDefinition,
  client: PrismaClientOrTx,
): Promise<{ ok: true; value: WorkflowAutomationAction } | { ok: false; error: string }> {
  if (!isPlainObject(raw)) {
    return { ok: false, error: `actions[${index}] must be an object.` };
  }

  const { type } = raw;
  if (typeof type !== "string" || !WORKFLOW_ACTION_TYPES.includes(type as WorkflowActionType)) {
    return { ok: false, error: `actions[${index}].type must be one of: ${WORKFLOW_ACTION_TYPES.join(", ")}.` };
  }

  // Both V1 action types reference a Custom Status/Custom Field
  // definition, which only exists for CLIENT/LEAD entities (see
  // WorkflowTriggerDefinition.customReferenceEntityType's own comment) —
  // an automation whose trigger entity has no such correspondence (today,
  // INVOICE and CLIENT_REQUEST) can carry conditions but no actions at
  // all in V1. This is intentional, narrow V1 scope, not an oversight.
  if (!trigger.customReferenceEntityType) {
    return {
      ok: false,
      error: `actions[${index}]: trigger "${trigger.entityType}.${trigger.action}" supports no action types in V1 (no Custom Status/Custom Field correspondence for this entity).`,
    };
  }
  const entityType = trigger.customReferenceEntityType;

  if (type === "SET_CUSTOM_STATUS") {
    const { customStatusDefinitionId } = raw;
    if (!isUuid(customStatusDefinitionId)) {
      return { ok: false, error: `actions[${index}].customStatusDefinitionId must be a UUID.` };
    }
    const result = await validateCustomStatusReference(organizationId, entityType, customStatusDefinitionId, client);
    if (!result.ok) {
      return {
        ok: false,
        error:
          result.reason === "NOT_FOUND"
            ? `actions[${index}].customStatusDefinitionId does not exist for this organization/entity type.`
            : `actions[${index}].customStatusDefinitionId refers to an archived definition, which cannot be newly selected.`,
      };
    }
    return { ok: true, value: { type: "SET_CUSTOM_STATUS", customStatusDefinitionId } };
  }

  // type === "SET_CUSTOM_FIELD_VALUE"
  const { customFieldDefinitionId, value } = raw;
  if (!isUuid(customFieldDefinitionId)) {
    return { ok: false, error: `actions[${index}].customFieldDefinitionId must be a UUID.` };
  }
  const definitionResult = await validateCustomFieldReference(organizationId, entityType, customFieldDefinitionId, client);
  if (!definitionResult.ok) {
    return {
      ok: false,
      error:
        definitionResult.reason === "NOT_FOUND"
          ? `actions[${index}].customFieldDefinitionId does not exist for this organization/entity type.`
          : `actions[${index}].customFieldDefinitionId refers to an archived definition, which cannot be newly selected.`,
    };
  }
  const compatibility = await checkCustomFieldValueCompatibility(definitionResult.definition, value, client);
  if (!compatibility.ok) {
    return { ok: false, error: `actions[${index}].value: ${compatibility.error}` };
  }
  return {
    ok: true,
    value: { type: "SET_CUSTOM_FIELD_VALUE", customFieldDefinitionId, value: compatibility.normalizedValue },
  };
}

/**
 * Validates a proposed `actions` JSON value against one specific
 * trigger's own action vocabulary, re-verifying every Custom Status/
 * Custom Field reference against the database under the given
 * organizationId — never trusted from the configuration itself.
 */
export async function parseWorkflowAutomationActions(
  raw: unknown,
  organizationId: string,
  trigger: WorkflowTriggerDefinition,
  client: PrismaClientOrTx = prisma,
): Promise<WorkflowActionsValidationResult> {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "actions must be an array." };
  }
  if (raw.length > MAX_WORKFLOW_ACTIONS) {
    return { ok: false, error: `actions must contain at most ${MAX_WORKFLOW_ACTIONS} entries.` };
  }

  const values: WorkflowAutomationAction[] = [];
  for (let i = 0; i < raw.length; i++) {
    const result = await parseOneAction(raw[i], i, organizationId, trigger, client);
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }
  return { ok: true, values };
}
