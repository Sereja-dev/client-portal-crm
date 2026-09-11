import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { WorkflowAutomation } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { CreatedActivity } from "@/lib/notifications/notification-rules";
import type { WorkflowTriggerDefinition } from "./triggers";
import type { WorkflowAutomationAction } from "./actions";
import { validateCustomStatusReference, validateCustomFieldReference, checkCustomFieldValueCompatibility } from "./custom-reference-validation";
import { assignClientStatus, assignLeadStatus } from "@/lib/custom-statuses/assignment";
import { upsertCustomFieldValue } from "@/lib/custom-fields/values";

/**
 * Workflow Automations Phase 2 — the atomic per-automation execution
 * engine. Never imports or calls dispatch.ts — that omission is the
 * entire recursion-prevention story for V1 (Phase 2 execution audit §4):
 * even if a future action type someday writes its own Activity row,
 * nothing in this file re-enters the dispatcher, so there is no path
 * back into workflow automation evaluation from here, structurally, not
 * by convention.
 *
 * Every reference persisted inside `automation.actions` is re-verified
 * here against the live database, under the triggering Activity's own
 * organizationId — never trusted just because it was already valid when
 * the automation was created or last edited (Phase 1's own
 * createWorkflowAutomation/updateWorkflowAutomation validate at
 * config-write time; this module re-validates at execution time,
 * reusing the exact same helpers from custom-reference-validation.ts so
 * there is only one place either check is actually implemented).
 *
 * Atomicity (Phase 2 execution audit §7/§8): every action in one run
 * executes in a single transaction, together with the row that records
 * the run's own final SUCCEEDED state — there is no PENDING state, so
 * that row IS the concurrency "claim," not a separate step (see
 * WorkflowAutomationRun's own schema doc comment). If any action fails,
 * the whole transaction — the successful actions before it included —
 * rolls back, and the FAILED outcome is recorded afterward in a
 * separate, best-effort transaction (the original P2002-after-rollback
 * problem: a transaction that failed can never durably record its own
 * failure from inside itself).
 */

export type WorkflowRunFailureReason =
  | "invalid_condition_config"
  | "invalid_action_config"
  | "custom_status_not_found"
  | "custom_status_archived"
  | "custom_field_not_found"
  | "custom_field_archived"
  | "custom_field_value_incompatible"
  | "custom_field_option_invalid"
  | "custom_field_option_archived"
  | "entity_not_found"
  | "unexpected_error";

class WorkflowActionExecutionError extends Error {
  constructor(
    public readonly failureReason: WorkflowRunFailureReason,
    public readonly failedActionIndex: number,
  ) {
    super(failureReason);
    this.name = "WorkflowActionExecutionError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A minimal structural re-check of the shape Phase 1's own
 * parseWorkflowAutomationActions already guarantees on every write —
 * this module only ever re-validates the semantic/live parts
 * (existence, archival, compatibility) below, not the structural shape
 * a second time, since nothing in this codebase writes to
 * WorkflowAutomation.actions except that already-tested validation
 * path. Returns null only if the stored JSON has somehow drifted from
 * that guaranteed shape — defensive, expected to be unreachable.
 */
function parseStoredActions(raw: unknown): WorkflowAutomationAction[] | null {
  if (!Array.isArray(raw)) return null;
  const actions: WorkflowAutomationAction[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) return null;
    if (entry.type === "SET_CUSTOM_STATUS" && typeof entry.customStatusDefinitionId === "string") {
      actions.push({ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: entry.customStatusDefinitionId });
      continue;
    }
    if (
      entry.type === "SET_CUSTOM_FIELD_VALUE" &&
      typeof entry.customFieldDefinitionId === "string" &&
      (typeof entry.value === "string" || typeof entry.value === "number" || typeof entry.value === "boolean")
    ) {
      actions.push({ type: "SET_CUSTOM_FIELD_VALUE", customFieldDefinitionId: entry.customFieldDefinitionId, value: entry.value });
      continue;
    }
    return null;
  }
  return actions;
}

function mapCustomFieldValueMutationFailure(reason: string): WorkflowRunFailureReason {
  switch (reason) {
    case "DEFINITION_NOT_FOUND":
      return "custom_field_not_found";
    case "ENTITY_NOT_FOUND":
      return "entity_not_found";
    case "OPTION_NOT_FOUND":
      return "custom_field_option_invalid";
    case "ARCHIVED_OPTION":
      return "custom_field_option_archived";
    default:
      // "INVALID_VALUE" and anything else — a value that was compatible
      // a moment ago in checkCustomFieldValueCompatibility but this
      // domain function itself still rejects (defensive; the two are
      // meant to agree exactly).
      return "custom_field_value_incompatible";
  }
}

/** Executes exactly one already-shape-validated action, re-verifying its reference under `organizationId` first. Throws WorkflowActionExecutionError on any failure — never returns a failure value, so a caller can't accidentally ignore one. */
async function executeOneAction(
  action: WorkflowAutomationAction,
  index: number,
  organizationId: string,
  entityType: "CLIENT" | "LEAD",
  entityId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (action.type === "SET_CUSTOM_STATUS") {
    const ref = await validateCustomStatusReference(organizationId, entityType, action.customStatusDefinitionId, tx);
    if (!ref.ok) {
      throw new WorkflowActionExecutionError(ref.reason === "NOT_FOUND" ? "custom_status_not_found" : "custom_status_archived", index);
    }
    const assign = entityType === "CLIENT" ? assignClientStatus : assignLeadStatus;
    const result = await assign(organizationId, entityId, action.customStatusDefinitionId, tx);
    if (!result.ok) {
      const failureReason: WorkflowRunFailureReason =
        result.reason === "ENTITY_NOT_FOUND"
          ? "entity_not_found"
          : result.reason === "ARCHIVED_DEFINITION"
            ? "custom_status_archived"
            : "custom_status_not_found";
      throw new WorkflowActionExecutionError(failureReason, index);
    }
    return;
  }

  // action.type === "SET_CUSTOM_FIELD_VALUE"
  const ref = await validateCustomFieldReference(organizationId, entityType, action.customFieldDefinitionId, tx);
  if (!ref.ok) {
    throw new WorkflowActionExecutionError(ref.reason === "NOT_FOUND" ? "custom_field_not_found" : "custom_field_archived", index);
  }
  // Re-normalizes the already-stored value (SELECT re-checks the option
  // still belongs to this definition and isn't archived; every other
  // type re-runs its own pure normalizer, idempotent on an already-
  // normalized value — see checkCustomFieldValueCompatibility's own
  // DATE handling for the one type that needed a round-trippable stored
  // format for exactly this reason).
  const compatibility = await checkCustomFieldValueCompatibility(ref.definition, action.value, tx);
  if (!compatibility.ok) {
    throw new WorkflowActionExecutionError("custom_field_value_incompatible", index);
  }
  const result = await upsertCustomFieldValue(organizationId, entityType, entityId, action.customFieldDefinitionId, compatibility.normalizedValue, tx);
  if (!result.ok) {
    throw new WorkflowActionExecutionError(mapCustomFieldValueMutationFailure(result.reason), index);
  }
}

function isRunUniqueConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Best-effort FAILED-row writer, used both for a run that never reached
 * action execution at all (invalid stored condition/action config) and
 * for one whose own attempt transaction rolled back (see
 * runWorkflowAutomation below). A P2002 here means a concurrent
 * execution already produced *some* row for this exact
 * (workflowAutomationId, activityId) pair — per the Phase 2 execution
 * audit §8, that is a duplicate/idempotency outcome, not an error: never
 * overwrites, never surfaces, never retried.
 */
export async function recordWorkflowAutomationFailure(
  workflowAutomationId: string,
  activityId: string,
  failureReason: WorkflowRunFailureReason,
  failedActionIndex: number | null,
): Promise<void> {
  try {
    await prisma.workflowAutomationRun.create({
      data: { workflowAutomationId, activityId, status: "FAILED", failureReason, failedActionIndex },
    });
  } catch (err) {
    if (isRunUniqueConflict(err)) return;
    // Genuinely unexpected — even this best-effort write failing (e.g. a
    // transient DB outage on the write itself) must never throw back
    // into dispatch.ts's own caller.
  }
}

/**
 * Runs one automation's actions against the entity that caused the
 * trigger (`activity.entityId` — never a caller/config-supplied target;
 * Phase 1's own action JSON schema has no field for one). Never throws.
 */
export async function runWorkflowAutomation(
  automation: WorkflowAutomation,
  activity: CreatedActivity,
  trigger: WorkflowTriggerDefinition,
): Promise<void> {
  const entityType = trigger.customReferenceEntityType;
  if (!entityType) {
    // Unreachable given dispatch.ts's own isExecutableWorkflowTrigger
    // gate (only LEAD.STATUS_CHANGED/CLIENT.CREATED reach this function,
    // and both have a customReferenceEntityType) — never assumed.
    await recordWorkflowAutomationFailure(automation.id, activity.id, "invalid_action_config", null);
    return;
  }

  const parsedActions = parseStoredActions(automation.actions);
  if (!parsedActions) {
    await recordWorkflowAutomationFailure(automation.id, activity.id, "invalid_action_config", null);
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < parsedActions.length; i++) {
        await executeOneAction(parsedActions[i], i, activity.organizationId, entityType, activity.entityId, tx);
      }
      // The run "claim" and its final SUCCEEDED state are the same
      // write — see WorkflowAutomationRun's own schema doc comment for
      // why no separate PENDING step exists. A P2002 here means another
      // concurrent execution already completed this exact run; letting
      // it propagate rolls this entire transaction back, discarding
      // every tentatively-applied action write above along with it —
      // Postgres's own transactional isolation is the whole concurrency
      // guarantee (Phase 2 execution audit §5/§8), no application-level
      // lock needed.
      await tx.workflowAutomationRun.create({
        data: { workflowAutomationId: automation.id, activityId: activity.id, status: "SUCCEEDED" },
      });
    });
  } catch (err) {
    if (isRunUniqueConflict(err)) {
      // Lost the race to a concurrent execution that already completed
      // this exact run — a clean idempotency outcome, not a failure.
      // Nothing left to record; the winner's row already exists.
      return;
    }
    const { failureReason, failedActionIndex } =
      err instanceof WorkflowActionExecutionError
        ? { failureReason: err.failureReason, failedActionIndex: err.failedActionIndex as number | null }
        : { failureReason: "unexpected_error" as const, failedActionIndex: null };
    await recordWorkflowAutomationFailure(automation.id, activity.id, failureReason, failedActionIndex);
  }
}
