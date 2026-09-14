"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMembership } from "@/lib/current-user";
import {
  createQuoteTemplate,
  updateQuoteTemplate,
  archiveQuoteTemplate,
  restoreQuoteTemplate,
  duplicateQuoteTemplate,
  type CreateQuoteTemplateResult,
  type UpdateQuoteTemplateResult,
} from "@/lib/quote-templates/service";
import type { QuoteTemplateActor } from "@/lib/quote-templates/authorization";
import type { QuoteTemplateWritableInput } from "@/lib/quote-templates/validation";

/**
 * Quote Templates Phase 2 — the Server Action layer binding
 * src/lib/quote-templates/service.ts's own Phase 1 domain functions to
 * the Settings → Templates UI. Mirrors src/app/(dashboard)/quotes/
 * actions.ts's own createQuoteAction shape exactly (a plain, already-
 * typed input object, not FormData — matching this app's own Quotes
 * Phase 2 precedent, which QuoteForm itself already calls directly
 * inside startTransition rather than through useActionState).
 *
 * Every action here re-resolves {user, organizationId, membership} itself
 * via getCurrentMembership() — never trusts a client-supplied
 * organizationId or role — and then hands off to the Phase 1 service
 * function, which independently re-verifies canManageQuoteTemplates()
 * (OWNER/ADMIN) before doing anything else. This file adds no
 * authorization logic of its own; it only translates the service
 * layer's own discriminated-union results into what each client
 * component needs (revalidatePath so the list reflects the change on
 * the next navigation, and a small {ok, reason} shape for the row-level
 * archive/restore/duplicate buttons).
 */

function actorFor(user: { id: string; name: string }, role: QuoteTemplateActor["role"]): QuoteTemplateActor {
  return { id: user.id, name: user.name, role };
}

export async function createQuoteTemplateAction(input: QuoteTemplateWritableInput): Promise<CreateQuoteTemplateResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await createQuoteTemplate(organizationId, actorFor(user, membership.role), input);
  if (result.ok) {
    revalidatePath("/settings/templates");
  }
  return result;
}

export async function updateQuoteTemplateAction(
  templateId: string,
  input: QuoteTemplateWritableInput,
): Promise<UpdateQuoteTemplateResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await updateQuoteTemplate(organizationId, templateId, actorFor(user, membership.role), input);
  if (result.ok) {
    revalidatePath("/settings/templates");
    revalidatePath(`/settings/templates/${templateId}`);
  }
  return result;
}

export type RowActionResult = { ok: true } | { ok: false; reason: "FORBIDDEN" | "NOT_FOUND" };

export async function archiveQuoteTemplateAction(templateId: string): Promise<RowActionResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await archiveQuoteTemplate(organizationId, templateId, actorFor(user, membership.role));
  revalidatePath("/settings/templates");
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

export async function restoreQuoteTemplateAction(templateId: string): Promise<RowActionResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await restoreQuoteTemplate(organizationId, templateId, actorFor(user, membership.role));
  revalidatePath("/settings/templates");
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

export type DuplicateQuoteTemplateActionResult =
  | { ok: true; newTemplateId: string }
  | { ok: false; reason: "FORBIDDEN" | "NOT_FOUND" };

/** Duplicate → the caller navigates to the new copy's own edit page for review (see QuoteTemplateRowActions' own comment) — this action only ever returns the new id, it never redirects itself. */
export async function duplicateQuoteTemplateAction(templateId: string): Promise<DuplicateQuoteTemplateActionResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await duplicateQuoteTemplate(organizationId, templateId, actorFor(user, membership.role));
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  revalidatePath("/settings/templates");
  return { ok: true, newTemplateId: result.template.id };
}
