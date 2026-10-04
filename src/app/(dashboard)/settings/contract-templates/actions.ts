"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMembership } from "@/lib/current-user";
import {
  createContractTemplate,
  updateContractTemplate,
  archiveContractTemplate,
  restoreContractTemplate,
  duplicateContractTemplate,
  type CreateContractTemplateResult,
  type UpdateContractTemplateResult,
} from "@/lib/contract-templates/service";
import type { ContractTemplateActor } from "@/lib/contract-templates/authorization";
import type { ContractTemplateWritableInput } from "@/lib/contract-templates/validation";

/**
 * Contract Templates V1 — the Server Action layer binding
 * src/lib/contract-templates/service.ts's own domain functions to the
 * Settings → Contract Templates UI. Mirrors
 * src/app/(dashboard)/settings/invoice-templates/actions.ts's own
 * identical shape exactly.
 *
 * Every action here re-resolves {user, organizationId, membership} itself
 * via getCurrentMembership() — never trusts a client-supplied
 * organizationId or role — and then hands off to the service function,
 * which independently re-verifies canManageContractTemplates() (OWNER/
 * ADMIN) before doing anything else. This file adds no authorization
 * logic of its own.
 */

function actorFor(user: { id: string; name: string }, role: ContractTemplateActor["role"]): ContractTemplateActor {
  return { id: user.id, name: user.name, role };
}

export async function createContractTemplateAction(input: ContractTemplateWritableInput): Promise<CreateContractTemplateResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await createContractTemplate(organizationId, actorFor(user, membership.role), input);
  if (result.ok) {
    revalidatePath("/settings/contract-templates");
  }
  return result;
}

export async function updateContractTemplateAction(
  templateId: string,
  input: ContractTemplateWritableInput,
): Promise<UpdateContractTemplateResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await updateContractTemplate(organizationId, templateId, actorFor(user, membership.role), input);
  if (result.ok) {
    revalidatePath("/settings/contract-templates");
    revalidatePath(`/settings/contract-templates/${templateId}`);
  }
  return result;
}

export type RowActionResult = { ok: true } | { ok: false; reason: "FORBIDDEN" | "NOT_FOUND" };

export async function archiveContractTemplateAction(templateId: string): Promise<RowActionResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await archiveContractTemplate(organizationId, templateId, actorFor(user, membership.role));
  revalidatePath("/settings/contract-templates");
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

export async function restoreContractTemplateAction(templateId: string): Promise<RowActionResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await restoreContractTemplate(organizationId, templateId, actorFor(user, membership.role));
  revalidatePath("/settings/contract-templates");
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

export type DuplicateContractTemplateActionResult =
  | { ok: true; newTemplateId: string }
  | { ok: false; reason: "FORBIDDEN" | "NOT_FOUND" };

/** Duplicate → the caller navigates to the new copy's own edit page for review (see ContractTemplateRowActions' own comment) — this action only ever returns the new id, it never redirects itself. */
export async function duplicateContractTemplateAction(templateId: string): Promise<DuplicateContractTemplateActionResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await duplicateContractTemplate(organizationId, templateId, actorFor(user, membership.role));
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  revalidatePath("/settings/contract-templates");
  return { ok: true, newTemplateId: result.template.id };
}
