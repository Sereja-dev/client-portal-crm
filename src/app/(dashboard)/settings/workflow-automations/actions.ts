"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentMembership } from "@/lib/current-user";
import {
  createWorkflowAutomation,
  updateWorkflowAutomation,
  setWorkflowAutomationEnabled,
  archiveWorkflowAutomation,
} from "@/lib/workflow-automations/automations";
import { withToast } from "@/lib/toast-url";
import type { WorkflowAutomationFormState } from "@/types";

/**
 * Workflow Automations V1 — Staff Authoring UI Server Action layer. Every
 * action here is a thin wrapper around the existing, unchanged Phase 1
 * domain functions (src/lib/workflow-automations/automations.ts) — no
 * authorization, tenant-scoping, trigger/condition/action validation, or
 * Custom Status/Custom Field reference checking is duplicated here. Each
 * action resolves the authenticated staff member's own membership itself
 * (getCurrentMembership()) and passes {id, name, role} as the actor the
 * domain layer already expects — organizationId is never trusted from
 * client input, matching every other settings/Server Action pair in this
 * app.
 */

const LIST_PATH = "/settings/workflow-automations";

function editPath(id: string): string {
  return `${LIST_PATH}/${id}`;
}

const INVALID_CONFIG_ERROR = "Something went wrong with your condition/action configuration. Please reload and try again.";

/** `null` return means "no condition was configured" — the automation always fires (an empty conditions array). `undefined` means malformed JSON — reject outright, never silently fall back to "no condition". */
function parseConditionInput(formData: FormData): { ok: true; value: unknown[] } | { ok: false } {
  const raw = formData.get("condition");
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: true, value: [] };
  }
  try {
    return { ok: true, value: [JSON.parse(raw)] };
  } catch {
    return { ok: false };
  }
}

/** Exactly one action is required by this UI (see WorkflowAutomationForm's own header comment) — the domain layer itself still accepts 0..5, this form just never submits zero. */
function parseActionInput(formData: FormData): { ok: true; value: unknown[] } | { ok: false } {
  const raw = formData.get("action");
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false };
  }
  try {
    return { ok: true, value: [JSON.parse(raw)] };
  } catch {
    return { ok: false };
  }
}

export async function createWorkflowAutomationAction(
  _prevState: WorkflowAutomationFormState,
  formData: FormData,
): Promise<WorkflowAutomationFormState> {
  const conditionResult = parseConditionInput(formData);
  const actionResult = parseActionInput(formData);
  if (!conditionResult.ok || !actionResult.ok) {
    return { error: INVALID_CONFIG_ERROR };
  }

  const { user, organizationId, membership } = await getCurrentMembership();
  const actor = { id: user.id, name: user.name, role: membership.role };

  const result = await createWorkflowAutomation(organizationId, actor, {
    name: formData.get("name"),
    triggerEntityType: formData.get("triggerEntityType"),
    triggerAction: formData.get("triggerAction"),
    conditions: conditionResult.value,
    actions: actionResult.value,
  });

  if (!result.ok) {
    if (result.reason === "FORBIDDEN") {
      return { error: "You don't have permission to do that." };
    }
    return { error: result.error };
  }

  revalidatePath(LIST_PATH);
  redirect(withToast(LIST_PATH, "Workflow automation created"));
}

export async function updateWorkflowAutomationAction(
  automationId: string,
  _prevState: WorkflowAutomationFormState,
  formData: FormData,
): Promise<WorkflowAutomationFormState> {
  const conditionResult = parseConditionInput(formData);
  const actionResult = parseActionInput(formData);
  if (!conditionResult.ok || !actionResult.ok) {
    return { error: INVALID_CONFIG_ERROR };
  }

  const { user, organizationId, membership } = await getCurrentMembership();
  const actor = { id: user.id, name: user.name, role: membership.role };

  // Trigger is deliberately never accepted here — updateWorkflowAutomation
  // itself has no triggerEntityType/triggerAction parameter at all (Phase
  // 1's own design: the trigger is immutable after creation, matching
  // updateRecurringInvoice's own "reschedule is a separate concern"
  // precedent). WorkflowAutomationForm's edit mode never renders a
  // trigger select for exactly this reason.
  const result = await updateWorkflowAutomation(organizationId, automationId, actor, {
    name: formData.get("name"),
    conditions: conditionResult.value,
    actions: actionResult.value,
  });

  if (!result.ok) {
    if (result.reason === "FORBIDDEN") {
      return { error: "You don't have permission to do that." };
    }
    if (result.reason === "NOT_FOUND") {
      return { error: "This automation is no longer available." };
    }
    return { error: result.error };
  }

  revalidatePath(LIST_PATH);
  revalidatePath(editPath(automationId));
  redirect(withToast(LIST_PATH, "Workflow automation updated"));
}

export type WorkflowAutomationLifecycleResult = { ok: true } | { ok: false; reason: string };

export async function setWorkflowAutomationEnabledAction(
  automationId: string,
  isEnabled: boolean,
): Promise<WorkflowAutomationLifecycleResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const actor = { id: user.id, name: user.name, role: membership.role };

  const result = await setWorkflowAutomationEnabled(organizationId, automationId, actor, isEnabled);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function archiveWorkflowAutomationAction(automationId: string): Promise<WorkflowAutomationLifecycleResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const actor = { id: user.id, name: user.name, role: membership.role };

  const result = await archiveWorkflowAutomation(organizationId, automationId, actor);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  revalidatePath(LIST_PATH);
  return { ok: true };
}
