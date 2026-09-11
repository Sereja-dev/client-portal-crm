import "server-only";
import { prisma } from "@/lib/prisma";
import { resolveSystemStatusDefinition } from "@/lib/custom-statuses/resolution";
import { createActivity } from "@/lib/activity/create-activity";
import { buildLeadActivityMetadata } from "@/lib/activity/lead-metadata";
import {
  resolveLeadCaptureFormFieldsConfig,
  buildPublicLeadCaptureFormFields,
  type LeadCaptureFormFieldsConfig,
  type PublicLeadCaptureFormField,
} from "./fields";
import { parsePublicLeadCaptureSubmission, type PublicLeadCaptureSubmissionInput, type PublicLeadCaptureFieldErrors } from "@/lib/validation/lead-capture-form";

/**
 * Public Lead Capture Forms, Phase 1 — the two public, unauthenticated
 * entry points (resolved only through a form's own `publicToken`, never
 * an organization id or this row's own `id`). No caller anywhere in this
 * module is authenticated — every function here must independently
 * reject anything that isn't a genuinely active, non-archived form,
 * exactly like the existing Invitation-token pages'
 * "not found and REVOKED share one generic message" convention (see
 * src/app/invite/[token]/page.tsx) — an inactive/archived form is never
 * distinguishable from a token that never existed.
 */

function safeParseFieldsConfig(raw: unknown): LeadCaptureFormFieldsConfig {
  // Always written by validateLeadCaptureFormFieldsConfigInput (see
  // forms.ts), so this is normally already well-formed — this is a
  // defensive fallback only, never trusted as the primary validation
  // boundary. An unexpected shape (e.g. hand-edited row) degrades to "use
  // every field's own default" rather than throwing.
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as LeadCaptureFormFieldsConfig;
}

export type PublicLeadCaptureFormSchema = {
  title: string;
  description: string | null;
  successMessage: string | null;
  fields: PublicLeadCaptureFormField[];
};

/**
 * Returns only the safe render schema — never organizationId, the row's
 * own internal `id`, `name` (the staff-facing internal label), or
 * `isActive`/`archivedAt` themselves. `null` for a missing, inactive, or
 * archived form — all three collapse to the exact same outcome.
 */
export async function getPublicLeadCaptureForm(publicToken: string): Promise<PublicLeadCaptureFormSchema | null> {
  const form = await prisma.leadCaptureForm.findUnique({ where: { publicToken } });
  if (!form || !form.isActive || form.archivedAt !== null) {
    return null;
  }

  return {
    title: form.title,
    description: form.description,
    successMessage: form.successMessage,
    fields: buildPublicLeadCaptureFormFields(safeParseFieldsConfig(form.fieldsConfig)),
  };
}

export type SubmitPublicLeadCaptureFormResult =
  | { ok: true; leadId: string; successMessage: string | null }
  // Honeypot populated — silently discarded. Deliberately the exact same
  // shape a caller would branch on as a real success (no leadId to
  // distinguish it further at the type level beyond this variant's own
  // absence of one) so nothing about the response itself ever signals
  // "this was detected as spam" back to whoever submitted it.
  | { ok: true; discarded: true }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "VALIDATION"; fieldErrors: PublicLeadCaptureFieldErrors };

/**
 * Creates exactly one Lead from a public submission, or rejects/discards.
 * Rate limiting is the caller's responsibility (see
 * src/app/forms/[token]/actions.ts) — kept out of this pure domain
 * function the same way createLeadAction's own rate-limit check lives in
 * the action layer, not a shared lib.
 *
 * Every value this function ever writes to the created Lead is either
 * server-resolved (organizationId from the form row, source hardcoded to
 * WEBSITE, statusDefinitionId via the same resolveSystemStatusDefinition
 * every other Lead-create path uses) or taken from `input`'s own narrow
 * type — organizationId, statusDefinitionId, stage, source, assignedTo,
 * and convertedClientId are never representable in
 * PublicLeadCaptureSubmissionInput at all, let alone read from it.
 */
export async function submitPublicLeadCaptureForm(
  publicToken: string,
  input: PublicLeadCaptureSubmissionInput,
): Promise<SubmitPublicLeadCaptureFormResult> {
  const honeypotValue = typeof input.honeypot === "string" ? input.honeypot.trim() : "";
  if (honeypotValue) {
    return { ok: true, discarded: true };
  }

  const form = await prisma.leadCaptureForm.findUnique({ where: { publicToken } });
  if (!form || !form.isActive || form.archivedAt !== null) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const resolvedFields = resolveLeadCaptureFormFieldsConfig(safeParseFieldsConfig(form.fieldsConfig));
  const parsed = parsePublicLeadCaptureSubmission(input, resolvedFields);
  if (!parsed.ok) {
    return { ok: false, reason: "VALIDATION", fieldErrors: parsed.fieldErrors };
  }

  const lead = await prisma.$transaction(async (tx) => {
    // Custom Statuses — the created Lead always starts at the schema's
    // own default NEW stage, so its statusDefinitionId is resolved to the
    // matching system definition, same "leave unset if somehow not
    // found" fail-open rule createLeadAction's own identical call uses.
    const statusDefinition = await resolveSystemStatusDefinition(form.organizationId, "LEAD", "new", tx);

    const created = await tx.lead.create({
      data: {
        organizationId: form.organizationId,
        name: parsed.values.name,
        company: parsed.values.company,
        email: parsed.values.email,
        phone: parsed.values.phone,
        // source is always WEBSITE for a public form submission — never
        // accepted from `input` (PublicLeadCaptureSubmissionInput has no
        // such field at all).
        source: "WEBSITE",
        // The closest existing field to a public form's free-text
        // "message" — see this module's own doc comment.
        notes: parsed.values.message,
        statusDefinitionId: statusDefinition?.id,
        // stage: not set — the schema's own @default(NEW) applies, same
        // as createLeadAction. assignedToUserId/value: left unset (null)
        // — a public submission never has either.
      },
    });

    await createActivity(tx, {
      organizationId: form.organizationId,
      // No authenticated actor exists for a public submission —
      // Activity.actorId is nullable exactly for cases like this one.
      actorId: null,
      entityType: "LEAD",
      entityId: created.id,
      action: "CREATED",
      metadata: buildLeadActivityMetadata(created, `Public form: ${form.name}`),
    });

    return created;
  });

  return { ok: true, leadId: lead.id, successMessage: form.successMessage };
}
