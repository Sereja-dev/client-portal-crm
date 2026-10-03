"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMembership } from "@/lib/current-user";
import {
  createInvoiceTemplate,
  updateInvoiceTemplate,
  archiveInvoiceTemplate,
  restoreInvoiceTemplate,
  duplicateInvoiceTemplate,
  type CreateInvoiceTemplateResult,
  type UpdateInvoiceTemplateResult,
} from "@/lib/invoice-templates/service";
import type { InvoiceTemplateActor } from "@/lib/invoice-templates/authorization";
import type { InvoiceTemplateWritableInput } from "@/lib/invoice-templates/validation";

/**
 * Invoice Templates V1 — the Server Action layer binding
 * src/lib/invoice-templates/service.ts's own domain functions to the
 * Settings → Invoice Templates UI. Mirrors
 * src/app/(dashboard)/settings/templates/actions.ts's own identical shape
 * exactly.
 *
 * Every action here re-resolves {user, organizationId, membership} itself
 * via getCurrentMembership() — never trusts a client-supplied
 * organizationId or role — and then hands off to the service function,
 * which independently re-verifies canManageInvoiceTemplates() (OWNER/
 * ADMIN) before doing anything else. This file adds no authorization
 * logic of its own.
 */

function actorFor(user: { id: string; name: string }, role: InvoiceTemplateActor["role"]): InvoiceTemplateActor {
  return { id: user.id, name: user.name, role };
}

export async function createInvoiceTemplateAction(input: InvoiceTemplateWritableInput): Promise<CreateInvoiceTemplateResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await createInvoiceTemplate(organizationId, actorFor(user, membership.role), input);
  if (result.ok) {
    revalidatePath("/settings/invoice-templates");
  }
  return result;
}

export async function updateInvoiceTemplateAction(
  templateId: string,
  input: InvoiceTemplateWritableInput,
): Promise<UpdateInvoiceTemplateResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await updateInvoiceTemplate(organizationId, templateId, actorFor(user, membership.role), input);
  if (result.ok) {
    revalidatePath("/settings/invoice-templates");
    revalidatePath(`/settings/invoice-templates/${templateId}`);
  }
  return result;
}

export type RowActionResult = { ok: true } | { ok: false; reason: "FORBIDDEN" | "NOT_FOUND" };

export async function archiveInvoiceTemplateAction(templateId: string): Promise<RowActionResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await archiveInvoiceTemplate(organizationId, templateId, actorFor(user, membership.role));
  revalidatePath("/settings/invoice-templates");
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

export async function restoreInvoiceTemplateAction(templateId: string): Promise<RowActionResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await restoreInvoiceTemplate(organizationId, templateId, actorFor(user, membership.role));
  revalidatePath("/settings/invoice-templates");
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

export type DuplicateInvoiceTemplateActionResult =
  | { ok: true; newTemplateId: string }
  | { ok: false; reason: "FORBIDDEN" | "NOT_FOUND" };

/** Duplicate → the caller navigates to the new copy's own edit page for review (see InvoiceTemplateRowActions' own comment) — this action only ever returns the new id, it never redirects itself. */
export async function duplicateInvoiceTemplateAction(templateId: string): Promise<DuplicateInvoiceTemplateActionResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await duplicateInvoiceTemplate(organizationId, templateId, actorFor(user, membership.role));
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  revalidatePath("/settings/invoice-templates");
  return { ok: true, newTemplateId: result.template.id };
}
