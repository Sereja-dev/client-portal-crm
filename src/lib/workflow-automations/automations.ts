import "server-only";
import type { WorkflowAutomation } from "@/generated/prisma/client";
import { ActivityEntityType, ActivityAction, type Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import { resolveWorkflowTrigger, type WorkflowTriggerDefinition } from "./triggers";
import { parseWorkflowAutomationConditions, MAX_WORKFLOW_CONDITIONS } from "./conditions";
import { parseWorkflowAutomationActions, MAX_WORKFLOW_ACTIONS } from "./actions";
import { createActivity } from "@/lib/activity/create-activity";
import { buildWorkflowAutomationActivityMetadata } from "@/lib/activity/workflow-automation-metadata";

/**
 * Workflow Automations Phase 1 — config/domain CRUD layer. No dispatch,
 * no execution: nothing in this file (or anywhere else in this phase)
 * ever evaluates a condition or runs an action against a real mutation.
 * createActivity() itself is completely untouched by this phase — see
 * its own header comment — this module only ever *calls* it, the exact
 * same way every other domain module in this codebase already does, to
 * record that automation *configuration* changed.
 *
 * Permissions (mirrors src/lib/recurring-invoices/recurring-invoices.ts's
 * own finalized V1 design, applied identically here): every function in
 * this file is OWNER/ADMIN-only. A MEMBER can never create, edit, enable/
 * disable, archive, or even read/list a WorkflowAutomation. Workflow
 * Automations V1 is Staff-originated only in the deepest sense: not only
 * is authoring OWNER/ADMIN-gated, but every trigger this phase's own
 * allowlist (see triggers.ts) accepts was individually verified to be
 * emitted exclusively by a Staff-authenticated code path. `actorId !==
 * null` is never used as a substitute for that verification anywhere in
 * this module or triggers.ts — Portal and cron/system Activity rows can
 * and do write `actorId: null` today (e.g. CLIENT_REQUEST.CREATED from
 * src/lib/client-requests/portal.ts, and every cron-generated
 * INVOICE.CREATED from src/lib/recurring-invoices/generate.ts both do),
 * so a null actorId is never proof of anything about *this* module's own
 * trust boundary — it happens to coincide with "not Staff" on some
 * existing pairs and not on others, which is exactly why source
 * discrimination for the trigger allowlist below is done by inspecting
 * which code paths exist, not by reading actorId at all.
 */

export type WorkflowAutomationActor = { id: string; name: string; role: Role };

function isPrivileged(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export const WORKFLOW_AUTOMATION_NAME_MAX_LENGTH = 200;

function parseName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "name must be a string." };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "name must not be empty." };
  }
  if (trimmed.length > WORKFLOW_AUTOMATION_NAME_MAX_LENGTH) {
    return { ok: false, error: `name must be ${WORKFLOW_AUTOMATION_NAME_MAX_LENGTH} characters or fewer.` };
  }
  return { ok: true, value: trimmed };
}

function parseTrigger(
  triggerEntityType: unknown,
  triggerAction: unknown,
): { ok: true; trigger: WorkflowTriggerDefinition } | { ok: false; error: string } {
  const entityTypeValues: readonly string[] = Object.values(ActivityEntityType);
  const actionValues: readonly string[] = Object.values(ActivityAction);
  if (typeof triggerEntityType !== "string" || !entityTypeValues.includes(triggerEntityType)) {
    return { ok: false, error: "triggerEntityType is not a recognized entity type." };
  }
  if (typeof triggerAction !== "string" || !actionValues.includes(triggerAction)) {
    return { ok: false, error: "triggerAction is not a recognized action." };
  }
  const trigger = resolveWorkflowTrigger(triggerEntityType as ActivityEntityType, triggerAction as ActivityAction);
  if (!trigger) {
    return {
      ok: false,
      error: `${triggerEntityType}.${triggerAction} is not a supported Workflow Automations trigger in V1.`,
    };
  }
  return { ok: true, trigger };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateWorkflowAutomationInput = {
  name: unknown;
  triggerEntityType: unknown;
  triggerAction: unknown;
  /** Defaults to an empty array when omitted. */
  conditions?: unknown;
  /** Defaults to an empty array when omitted. */
  actions?: unknown;
};

export type CreateWorkflowAutomationResult =
  | { ok: true; workflowAutomation: WorkflowAutomation }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "VALIDATION"; error: string };

export async function createWorkflowAutomation(
  organizationId: string,
  actor: WorkflowAutomationActor,
  input: CreateWorkflowAutomationInput,
  client: PrismaClientOrTx = prisma,
): Promise<CreateWorkflowAutomationResult> {
  // Authorization checked first, before any DB read — a MEMBER never
  // learns whether a submitted trigger/condition/action reference even
  // exists, matching createRecurringInvoice's own ordering.
  if (!isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const nameResult = parseName(input.name);
  if (!nameResult.ok) {
    return { ok: false, reason: "VALIDATION", error: nameResult.error };
  }

  const triggerResult = parseTrigger(input.triggerEntityType, input.triggerAction);
  if (!triggerResult.ok) {
    return { ok: false, reason: "VALIDATION", error: triggerResult.error };
  }
  const { trigger } = triggerResult;

  const conditionsResult = parseWorkflowAutomationConditions(input.conditions ?? [], trigger);
  if (!conditionsResult.ok) {
    return { ok: false, reason: "VALIDATION", error: conditionsResult.error };
  }

  const actionsResult = await parseWorkflowAutomationActions(input.actions ?? [], organizationId, trigger, client);
  if (!actionsResult.ok) {
    return { ok: false, reason: "VALIDATION", error: actionsResult.error };
  }

  const runCreate = async (tx: PrismaClientOrTx) => {
    const created = await tx.workflowAutomation.create({
      data: {
        organizationId,
        name: nameResult.value,
        isEnabled: true,
        triggerEntityType: trigger.entityType,
        triggerAction: trigger.action,
        conditions: conditionsResult.values,
        actions: actionsResult.values,
        createdByUserId: actor.id,
      },
    });

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "WORKFLOW_AUTOMATION",
      entityId: created.id,
      action: "CREATED",
      metadata: buildWorkflowAutomationActivityMetadata(created, actor.name),
    });

    return created;
  };

  const workflowAutomation = client === prisma ? await prisma.$transaction((tx) => runCreate(tx)) : await runCreate(client);
  return { ok: true, workflowAutomation };
}

// ---------------------------------------------------------------------------
// Update — name/conditions/actions only. The trigger itself (entityType +
// action) is immutable after creation, the same "reschedule is its own
// separate concern, not part of a plain update" choice
// updateRecurringInvoice's own header comment already made for
// frequency/anchorDay — changing what an automation reacts to is a
// meaningfully different decision than editing what it does once fired.
// ---------------------------------------------------------------------------

export type UpdateWorkflowAutomationInput = {
  name?: unknown;
  /** Omit for "no change". */
  conditions?: unknown;
  /** Omit for "no change". */
  actions?: unknown;
};

export type UpdateWorkflowAutomationResult =
  | { ok: true; workflowAutomation: WorkflowAutomation }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "VALIDATION"; error: string };

export async function updateWorkflowAutomation(
  organizationId: string,
  workflowAutomationId: string,
  actor: WorkflowAutomationActor,
  input: UpdateWorkflowAutomationInput,
  client: PrismaClientOrTx = prisma,
): Promise<UpdateWorkflowAutomationResult> {
  if (!isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const existing = await client.workflowAutomation.findFirst({ where: { id: workflowAutomationId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const trigger = resolveWorkflowTrigger(existing.triggerEntityType, existing.triggerAction);
  if (!trigger) {
    // Defensive only — every row in this table was created through
    // createWorkflowAutomation above, which only ever persists an
    // allowlisted trigger. Unreachable in practice, but a config update
    // must never silently skip re-validating conditions/actions against
    // an unresolved trigger.
    return { ok: false, reason: "VALIDATION", error: "This automation's trigger is no longer supported." };
  }

  const changedFields: string[] = [];
  let name = existing.name;
  let conditions = existing.conditions;
  let actions = existing.actions;

  if (input.name !== undefined) {
    const nameResult = parseName(input.name);
    if (!nameResult.ok) {
      return { ok: false, reason: "VALIDATION", error: nameResult.error };
    }
    if (nameResult.value !== existing.name) {
      name = nameResult.value;
      changedFields.push("name");
    }
  }

  if (input.conditions !== undefined) {
    const conditionsResult = parseWorkflowAutomationConditions(input.conditions, trigger);
    if (!conditionsResult.ok) {
      return { ok: false, reason: "VALIDATION", error: conditionsResult.error };
    }
    conditions = conditionsResult.values;
    changedFields.push("conditions");
  }

  if (input.actions !== undefined) {
    const actionsResult = await parseWorkflowAutomationActions(input.actions, organizationId, trigger, client);
    if (!actionsResult.ok) {
      return { ok: false, reason: "VALIDATION", error: actionsResult.error };
    }
    actions = actionsResult.values;
    changedFields.push("actions");
  }

  if (changedFields.length === 0) {
    // No real change — same idempotent no-op convention as
    // archiveLead/archiveClientRequest for a redundant call.
    return { ok: true, workflowAutomation: existing };
  }

  const runUpdate = async (tx: PrismaClientOrTx) => {
    const updated = await tx.workflowAutomation.update({
      where: { id: workflowAutomationId },
      data: { name, conditions: conditions as object, actions: actions as object },
    });

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "WORKFLOW_AUTOMATION",
      entityId: workflowAutomationId,
      action: "UPDATED",
      metadata: buildWorkflowAutomationActivityMetadata({ name }, actor.name, changedFields),
    });

    return updated;
  };

  const workflowAutomation = client === prisma ? await prisma.$transaction((tx) => runUpdate(tx)) : await runUpdate(client);
  return { ok: true, workflowAutomation };
}

// ---------------------------------------------------------------------------
// Enable / disable — the ordinary on/off toggle (isEnabled), distinct from
// archive (archivedAt) below. Same "isActive vs archivedAt" split
// LeadCaptureForm already established (see WorkflowAutomation's own
// schema doc comment).
// ---------------------------------------------------------------------------

export type SetWorkflowAutomationEnabledResult =
  | { ok: true; workflowAutomation: WorkflowAutomation }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "ARCHIVED" };

export async function setWorkflowAutomationEnabled(
  organizationId: string,
  workflowAutomationId: string,
  actor: WorkflowAutomationActor,
  isEnabled: boolean,
  client: PrismaClientOrTx = prisma,
): Promise<SetWorkflowAutomationEnabledResult> {
  if (!isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const existing = await client.workflowAutomation.findFirst({ where: { id: workflowAutomationId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (existing.archivedAt !== null) {
    return { ok: false, reason: "ARCHIVED" };
  }
  if (existing.isEnabled === isEnabled) {
    return { ok: true, workflowAutomation: existing };
  }

  const runUpdate = async (tx: PrismaClientOrTx) => {
    const updated = await tx.workflowAutomation.update({ where: { id: workflowAutomationId }, data: { isEnabled } });

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "WORKFLOW_AUTOMATION",
      entityId: workflowAutomationId,
      action: "UPDATED",
      metadata: buildWorkflowAutomationActivityMetadata(existing, actor.name, ["isEnabled"]),
    });

    return updated;
  };

  const workflowAutomation = client === prisma ? await prisma.$transaction((tx) => runUpdate(tx)) : await runUpdate(client);
  return { ok: true, workflowAutomation };
}

// ---------------------------------------------------------------------------
// Archive — terminal in V1, same "no un-archive path yet" precedent as
// archiveRecurringInvoice.
// ---------------------------------------------------------------------------

export type ArchiveWorkflowAutomationResult =
  | { ok: true; workflowAutomation: WorkflowAutomation }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "FORBIDDEN" };

export async function archiveWorkflowAutomation(
  organizationId: string,
  workflowAutomationId: string,
  actor: WorkflowAutomationActor,
  client: PrismaClientOrTx = prisma,
): Promise<ArchiveWorkflowAutomationResult> {
  if (!isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const existing = await client.workflowAutomation.findFirst({ where: { id: workflowAutomationId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (existing.archivedAt !== null) {
    // Idempotent no-op — already archived.
    return { ok: true, workflowAutomation: existing };
  }

  const runArchive = async (tx: PrismaClientOrTx) => {
    const updated = await tx.workflowAutomation.update({
      where: { id: workflowAutomationId },
      data: { archivedAt: new Date() },
    });

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "WORKFLOW_AUTOMATION",
      entityId: workflowAutomationId,
      action: "UPDATED",
      metadata: buildWorkflowAutomationActivityMetadata(existing, actor.name, ["archivedAt"]),
    });

    return updated;
  };

  const workflowAutomation = client === prisma ? await prisma.$transaction((tx) => runArchive(tx)) : await runArchive(client);
  return { ok: true, workflowAutomation };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export type GetWorkflowAutomationResult =
  | { ok: true; workflowAutomation: WorkflowAutomation | null }
  | { ok: false; reason: "FORBIDDEN" };

export async function getWorkflowAutomation(
  organizationId: string,
  workflowAutomationId: string,
  actor: WorkflowAutomationActor,
  client: PrismaClientOrTx = prisma,
): Promise<GetWorkflowAutomationResult> {
  if (!isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  const workflowAutomation = await client.workflowAutomation.findFirst({
    where: { id: workflowAutomationId, organizationId },
  });
  return { ok: true, workflowAutomation };
}

export type ListWorkflowAutomationsOptions = {
  /** Defaults to excluding archived rows — same convention as listCustomStatusDefinitions/listCustomFieldDefinitions. */
  includeArchived?: boolean;
};

export type ListWorkflowAutomationsResult =
  | { ok: true; workflowAutomations: WorkflowAutomation[] }
  | { ok: false; reason: "FORBIDDEN" };

export async function listWorkflowAutomations(
  organizationId: string,
  actor: WorkflowAutomationActor,
  options: ListWorkflowAutomationsOptions = {},
  client: PrismaClientOrTx = prisma,
): Promise<ListWorkflowAutomationsResult> {
  if (!isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  const workflowAutomations = await client.workflowAutomation.findMany({
    where: {
      organizationId,
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return { ok: true, workflowAutomations };
}

// Re-exported so callers/tests need only import from this one module for
// the common case, matching createRecurringInvoice's own file-level
// re-export convention.
export { MAX_WORKFLOW_CONDITIONS, MAX_WORKFLOW_ACTIONS };
