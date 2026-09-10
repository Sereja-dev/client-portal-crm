"use server";

import { revalidatePath } from "next/cache";
import type { LeadStage } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { checkRateLimit, LEAD_CREATE_LIMIT, LEAD_UPDATE_LIMIT } from "@/lib/rate-limit";
import { createActivity } from "@/lib/activity/create-activity";
import { buildLeadActivityMetadata, buildLeadStageChangeMetadata, diffLeadFields } from "@/lib/activity/lead-metadata";
import { buildClientActivityMetadata } from "@/lib/activity/client-metadata";
import {
  parseLeadInput,
  parseLostReason,
  type LeadFieldErrors,
  type LeadWritableInput,
} from "@/lib/validation/lead";
import { assertCanCreateClient, BillingLimitError } from "@/lib/billing/enforcement";
import { findDuplicateOrganizationClientByEmail } from "@/lib/clients/duplicate-email";
import { createClientContact, resolveFallbackContactName } from "@/lib/clients/contacts";
import { LEAD_STAGES, isLostLeadStage } from "@/lib/leads/stages";
import {
  getActiveCustomFieldFormDefinitions,
  getCustomFieldFormValues,
  parseCustomFieldFormValues,
  validateCustomFieldFormValues,
  persistCustomFieldValuesInTransaction,
} from "@/lib/custom-fields/entity-form";
import { resolveSystemStatusDefinition } from "@/lib/custom-statuses/resolution";
import { resolveStatusForSave } from "@/lib/custom-statuses/entity-form";
import { resolveLeadIsLost } from "@/lib/custom-statuses/semantics";
import { SYSTEM_STATUS_KEYS } from "@/lib/custom-statuses/constants";

// Select shape used everywhere below a Lead's own real business-semantic
// LOST check is made (Section F) — the immutable system-identity fields
// resolveLeadIsLost needs, nothing more (Section R: only fetch what's
// needed).
const STATUS_DEFINITION_IDENTITY_SELECT = { isSystem: true, entityType: true, key: true } as const;

/**
 * Leads / Sales Pipeline Phase 2. No Lead UI exists yet (Phase 3+) — every
 * action here takes plain, already-typed arguments rather than FormData,
 * and every result is a discriminated union rather than a redirect/toast,
 * so a future form layer (useActionState or a plain client-component
 * call) can adopt whichever shape it needs without this module changing.
 * See each result type's own comment for exactly which reasons it can
 * carry — never a raw Prisma error, never a provider/database detail
 * (the same "typed, controlled domain error" discipline
 * src/lib/billing/enforcement.ts's own BillingLimitError already
 * establishes).
 *
 * Every action below follows the same architecture the rest of this app
 * already uses for Client/Project/Task/Invoice mutations: resolve
 * {user, organizationId} via getCurrentUserOrganization() first (never
 * accept organizationId as input), rate-limit keyed by the resolved
 * user.id, verify any foreign-key input (assignedToUserId) actually
 * belongs to this same organization, do the write inside
 * prisma.$transaction alongside its Activity row, scope every lookup and
 * write by {id, organizationId} together so a foreign-org id is
 * indistinguishable from a nonexistent one, and revalidatePath("/leads")
 * even though nothing renders there yet — matching deleteClientAction's
 * own precedent of calling revalidatePath from a plain (non-redirecting)
 * action, not only from a form-redirect one.
 */

// The 5 stages a generic stage-move may target — LOST is deliberately
// excluded (markLeadLostAction is its own dedicated action, see that
// function's own comment on why), computed from the one canonical
// LEAD_STAGES definition rather than a second hardcoded list.
const MOVABLE_LEAD_STAGES: readonly LeadStage[] = LEAD_STAGES.filter((s) => !isLostLeadStage(s.value)).map(
  (s) => s.value,
);

/** Thrown only inside convertLeadToClientAction's own transaction, to carry a typed rejection reason out to its catch block — never allowed to escape that function. */
class LeadConversionError extends Error {
  constructor(readonly reason: "not_found" | "already_converted" | "lost" | "requires_duplicate_confirmation") {
    super(`Lead conversion rejected: ${reason}`);
  }
}

const DUPLICATE_EMAIL_MESSAGE = "A client with this email already exists. Do you still want to create a new client?";

/**
 * Verifies a candidate assignee actually belongs to the caller's own
 * organization (a Membership row must exist) — never trusts that a
 * client-supplied id was really offered by an in-org-only <select>, the
 * same "re-verify server-side" discipline createTaskAction's own
 * projectId check already establishes. A plain read via the top-level
 * `prisma` client (not `tx`) BEFORE opening any transaction, mirroring
 * that same existing precedent exactly.
 */
async function verifyAssigneeInOrganization(assignedToUserId: string | null, organizationId: string): Promise<boolean> {
  if (!assignedToUserId) return true;
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: assignedToUserId, organizationId } },
    select: { userId: true },
  });
  return membership !== null;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateLeadResult =
  | { ok: true; leadId: string }
  | { ok: false; reason: "validation"; fieldErrors: LeadFieldErrors }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "invalid_assignee" }
  | { ok: false; reason: "custom_field_validation"; customFieldErrors: Record<string, string> };

/**
 * Always creates at stage NEW — no explicit initial-stage input is
 * accepted. A deliberate, conservative Phase 2 choice: every other stage
 * transition (including into WON/LOST) goes through its own dedicated
 * action with its own invariants (converted-locking, lostReason
 * handling); letting create bypass those by setting an arbitrary initial
 * stage would undermine them for no real benefit. No entitlement gate —
 * leads are unlimited (approved product decision); only Client creation
 * (via conversion) is ever entitlement-checked.
 *
 * Custom Fields Phase 2B — `customFieldFormData` is optional and used
 * ONLY to extract `customField_<definitionId>` entries (Section J/K);
 * every other field on this action's own `input` argument is completely
 * unaffected, preserving this action's own original "plain, already-
 * typed arguments, not FormData" design intent for its normal Lead
 * fields (see this file's own header comment) — only the custom-field
 * slice needs the richer FormData shape, since a definition can be
 * created/archived/reordered by Staff at any time and this action must
 * always parse against whatever is active right now, not a fixed shape
 * baked into LeadWritableInput.
 */
export async function createLeadAction(
  input: LeadWritableInput,
  customFieldFormData?: FormData,
): Promise<CreateLeadResult> {
  const { values, fieldErrors } = parseLeadInput(input);
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, reason: "validation", fieldErrors };
  }

  const { user, organizationId } = await getCurrentUserOrganization();

  // Keyed by the authenticated staff user id — never anything from the
  // input — same ordering (auth resolved, then rate limit checked
  // immediately after, before any other work) every per-user limiter in
  // this app already uses.
  const limitCheck = checkRateLimit(LEAD_CREATE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  if (!(await verifyAssigneeInOrganization(values.assignedToUserId, organizationId))) {
    return { ok: false, reason: "invalid_assignee" };
  }

  // Custom Fields Phase 2B (Section E/J/K) — see createClientAction's
  // own identical comment. An absent customFieldFormData (no form layer
  // calling this yet, or a caller with nothing to submit) is treated
  // exactly like an empty FormData — every definition simply parses to
  // "no raw value", which is only an error for a required field.
  const customFieldDefinitions = await getActiveCustomFieldFormDefinitions(organizationId, "LEAD");
  const rawCustomFieldValues = parseCustomFieldFormValues(customFieldFormData ?? new FormData(), customFieldDefinitions);
  const customFieldValidation = validateCustomFieldFormValues(customFieldDefinitions, rawCustomFieldValues);
  if (!customFieldValidation.ok) {
    return { ok: false, reason: "custom_field_validation", customFieldErrors: customFieldValidation.fieldErrors };
  }

  // Lead create, its custom field values, and its Activity row are one
  // atomic unit — a failed Activity insert (or custom field write) rolls
  // the create back with it, matching createClientAction/
  // createTaskAction's own exact pattern.
  const lead = await prisma.$transaction(async (tx) => {
    // Custom Statuses Phase 1 (Section P) — the created Lead always
    // starts at the schema's own default NEW stage (see the comment
    // below), so its statusDefinitionId is resolved to the matching
    // system definition's key up front, same "leave unset if somehow
    // not found" fail-open rule as createClientAction's own comment.
    const statusDefinition = await resolveSystemStatusDefinition(organizationId, "LEAD", "new", tx);

    const created = await tx.lead.create({
      data: {
        organizationId,
        name: values.name,
        company: values.company,
        email: values.email,
        phone: values.phone,
        source: values.source,
        value: values.value,
        notes: values.notes,
        assignedToUserId: values.assignedToUserId,
        statusDefinitionId: statusDefinition?.id,
        // stage: not set — the schema's own @default(NEW) applies. Never
        // accepted from `input` (see this action's own doc comment).
      },
    });

    await persistCustomFieldValuesInTransaction(tx, {
      organizationId,
      entityType: "LEAD",
      entityId: created.id,
      definitions: customFieldDefinitions,
      rawValues: rawCustomFieldValues,
      decisions: customFieldValidation.decisions,
    });

    await createActivity(tx, {
      organizationId,
      actorId: user.id,
      entityType: "LEAD",
      entityId: created.id,
      action: "CREATED",
      metadata: buildLeadActivityMetadata(created, user.name),
    });

    return created;
  });

  revalidatePath("/leads");
  return { ok: true, leadId: lead.id };
}

// ---------------------------------------------------------------------------
// Update (generic edit — never stage/lostReason/archivedAt/converted*)
// ---------------------------------------------------------------------------

export type UpdateLeadResult =
  | { ok: true }
  | { ok: false; reason: "validation"; fieldErrors: LeadFieldErrors }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid_assignee" }
  | { ok: false; reason: "custom_field_validation"; customFieldErrors: Record<string, string> };

/**
 * Editable: name, company, email, phone, source, value, notes,
 * assignedToUserId — exactly the approved Phase 2 field set. Always
 * "full values", matching updateClientAction/updateTaskAction's own
 * convention (no partial-patch variant): a caller wanting to change one
 * field still supplies every field's current desired value.
 * organizationId/convertedClientId/convertedAt/archivedAt/stage/
 * lostReason are structurally impossible to set through this action —
 * `input`'s own LeadWritableInput type has no such fields, and the write
 * below only ever assigns from `values`, never from a route param or any
 * other caller-supplied source.
 *
 * `customFieldFormData` — see createLeadAction's own identical comment.
 */
export async function updateLeadAction(
  leadId: string,
  input: LeadWritableInput,
  customFieldFormData?: FormData,
): Promise<UpdateLeadResult> {
  const { values, fieldErrors } = parseLeadInput(input);
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, reason: "validation", fieldErrors };
  }

  const { user, organizationId } = await getCurrentUserOrganization();

  const limitCheck = checkRateLimit(LEAD_UPDATE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  if (!(await verifyAssigneeInOrganization(values.assignedToUserId, organizationId))) {
    return { ok: false, reason: "invalid_assignee" };
  }

  // Custom Fields Phase 2B (Section F/H/I/J/K) — see updateClientAction's
  // own identical comment.
  const customFieldDefinitions = await getActiveCustomFieldFormDefinitions(organizationId, "LEAD");
  const existingCustomFieldValues = await getCustomFieldFormValues(organizationId, "LEAD", leadId, customFieldDefinitions);
  const rawCustomFieldValues = parseCustomFieldFormValues(customFieldFormData ?? new FormData(), customFieldDefinitions);
  const customFieldValidation = validateCustomFieldFormValues(
    customFieldDefinitions,
    rawCustomFieldValues,
    existingCustomFieldValues,
  );
  if (!customFieldValidation.ok) {
    return { ok: false, reason: "custom_field_validation", customFieldErrors: customFieldValidation.fieldErrors };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    // Scoped by id + organizationId together — a foreign org's lead id
    // simply doesn't match, indistinguishable from a nonexistent one.
    // Also doubles as the "before" snapshot for the Activity diff below.
    const existing = await tx.lead.findFirst({ where: { id: leadId, organizationId } });
    if (!existing) {
      return "not_found" as const;
    }

    const result = await tx.lead.updateMany({
      where: { id: leadId, organizationId },
      data: {
        name: values.name,
        company: values.company,
        email: values.email,
        phone: values.phone,
        source: values.source,
        value: values.value,
        notes: values.notes,
        assignedToUserId: values.assignedToUserId,
      },
    });

    if (result.count === 0) {
      return "not_found" as const;
    }

    await persistCustomFieldValuesInTransaction(tx, {
      organizationId,
      entityType: "LEAD",
      entityId: leadId,
      definitions: customFieldDefinitions,
      rawValues: rawCustomFieldValues,
      decisions: customFieldValidation.decisions,
    });

    // Only log a real change — a re-submit of identical values shouldn't
    // add a no-op entry to the log, matching updateClientAction exactly.
    // The diff itself only ever carries field NAMES, never their values
    // (see lead-metadata.ts's own doc comment) — full notes/email/phone
    // content never reaches Activity.metadata either way.
    const changedFields = diffLeadFields(existing, values);
    if (changedFields.length > 0) {
      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "LEAD",
        entityId: leadId,
        action: "UPDATED",
        metadata: buildLeadActivityMetadata({ name: values.name, stage: existing.stage }, user.name, changedFields),
      });
    }

    return "updated" as const;
  });

  if (outcome === "not_found") {
    return { ok: false, reason: "not_found" };
  }

  revalidatePath("/leads");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Stage move (generic — NEW/CONTACTED/QUALIFIED/PROPOSAL/WON only)
// ---------------------------------------------------------------------------

export type MoveLeadStageResult =
  | { ok: true }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid_stage" }
  | { ok: false; reason: "converted_locked" };

/**
 * LOST is deliberately not a valid target here — markLeadLostAction is
 * its own dedicated action, since marking a Lead lost also records
 * lostReason, a second field this generic move never touches. WON *is* a
 * valid target here even before conversion ("won but not yet converted"
 * is a legitimate state per the approved product model) — conversion
 * itself separately guarantees stage WON when it happens.
 *
 * Reactivation: moving a LOST Lead to any of the 5 stages here is exactly
 * how a Lead is reactivated — no separate "reactivate" action exists.
 * lostReason is cleared automatically whenever the Lead's stage was LOST
 * before this move (never otherwise, so a still-open Lead's own
 * always-null lostReason is simply left untouched).
 *
 * A converted Lead can never move stage at all (locked to WON) —
 * enforced both by an upfront read and, for the race where a concurrent
 * conversion completes between that read and this write, by the guarded
 * updateMany's own `convertedClientId: null` condition.
 */
export async function moveLeadStageAction(leadId: string, stage: LeadStage): Promise<MoveLeadStageResult> {
  if (!MOVABLE_LEAD_STAGES.includes(stage)) {
    return { ok: false, reason: "invalid_stage" };
  }

  const { user, organizationId } = await getCurrentUserOrganization();

  const limitCheck = checkRateLimit(LEAD_UPDATE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const existing = await tx.lead.findFirst({
      where: { id: leadId, organizationId },
      include: { statusDefinition: { select: STATUS_DEFINITION_IDENTITY_SELECT } },
    });
    if (!existing) {
      return "not_found" as const;
    }
    if (existing.convertedClientId) {
      return "converted_locked" as const;
    }

    // Custom Statuses Phase 2A (Section F) — authoritative via the
    // Lead's own statusDefinition (immune to a stale legacy `stage`
    // ever being mistaken for LOST once a real definition is assigned);
    // falls back to the legacy enum only for a still-unbackfilled row
    // (Section D).
    const wasLost = resolveLeadIsLost(existing);

    // Custom Statuses Phase 1 (Section P) — kept in sync with the new
    // `stage` this action writes below.
    const statusDefinition = await resolveSystemStatusDefinition(organizationId, "LEAD", stage.toLowerCase(), tx);

    const result = await tx.lead.updateMany({
      where: { id: leadId, organizationId, convertedClientId: null },
      data: {
        stage,
        statusDefinitionId: statusDefinition?.id,
        // undefined = "leave this column untouched" to Prisma; only ever
        // explicitly cleared when actually leaving LOST.
        lostReason: wasLost ? null : undefined,
      },
    });

    if (result.count === 0) {
      // Raced with a concurrent conversion between the read above and
      // this write — treat exactly like the upfront check above.
      return "converted_locked" as const;
    }

    await createActivity(tx, {
      organizationId,
      actorId: user.id,
      entityType: "LEAD",
      entityId: leadId,
      action: "STATUS_CHANGED",
      metadata: buildLeadStageChangeMetadata(existing.stage, stage),
    });

    return "updated" as const;
  });

  if (outcome === "not_found") return { ok: false, reason: "not_found" };
  if (outcome === "converted_locked") return { ok: false, reason: "converted_locked" };

  revalidatePath("/leads");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Generic status-definition assignment (Custom Statuses Phase 2B, Section M — CRITICAL)
// ---------------------------------------------------------------------------

export type AssignLeadStatusDefinitionResult =
  | { ok: true }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "converted_locked" }
  | { ok: false; reason: "invalid_stage" }
  | { ok: false; reason: "status_not_found" }
  | { ok: false; reason: "status_archived" }
  | { ok: false; reason: "use_mark_lost_action" };

/**
 * The one generic "assign any status definition" entry point behind the
 * Section L/M/O-style status selector the Lead edit form/pipeline card
 * use — deliberately separate from, and never replacing,
 * moveLeadStageAction above (its ~60+ existing call sites keep working
 * completely unchanged).
 *
 * Section M is explicit and CRITICAL here: a generic status selector
 * must never silently bypass a business action that carries its own
 * required side effects. LOST is exactly that case — markLeadLostAction
 * also collects a required lostReason that a generic selector has no
 * field for — so the system LOST definition is REJECTED here with its
 * own typed reason, and the UI directs the user to the existing
 * dedicated "Mark lost" dialog instead. This is the "exclude/disable and
 * direct to the existing dedicated action" option the task explicitly
 * prefers over weakening the semantic rule.
 *
 * WON stays reachable here (system, not LOST) — this exactly matches
 * moveLeadStageAction's own pre-existing behavior, which already allows
 * moving to WON without converting; only convertLeadToClientAction ever
 * performs a real conversion. A non-LOST SYSTEM target is delegated
 * straight to moveLeadStageAction so every one of its already-tested
 * invariants (converted-lock, wasLost-clears-lostReason, Activity)
 * applies with zero duplicated logic — at the deliberate cost of
 * re-resolving {user, organizationId} and re-checking the update rate
 * limit a second time inside that delegated call, an acceptable
 * trade-off for reusing fully-tested logic rather than re-implementing
 * it.
 *
 * A CUSTOM target has no LeadStage representation at all, so it's
 * handled directly here: only statusDefinitionId is written (`stage`
 * itself is left completely untouched — a custom status layers on top
 * of, never replaces, the legacy pipeline stage), the same "clear
 * lostReason only if the Lead was actually LOST before" hygiene rule as
 * every other stage-changing action applies, and the change is logged
 * as a generic UPDATED Activity event (changedFields: ["status"])
 * rather than inventing any new Activity schema/enum (Section X) — the
 * existing LeadStageChangeMetadata shape has no room for a custom
 * status's own label/key.
 */
export async function assignLeadStatusDefinitionAction(
  leadId: string,
  definitionId: string,
): Promise<AssignLeadStatusDefinitionResult> {
  const { user, organizationId } = await getCurrentUserOrganization();

  const limitCheck = checkRateLimit(LEAD_UPDATE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  const existing = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    select: {
      name: true,
      stage: true,
      convertedClientId: true,
      statusDefinitionId: true,
      statusDefinition: { select: STATUS_DEFINITION_IDENTITY_SELECT },
    },
  });
  if (!existing) {
    return { ok: false, reason: "not_found" };
  }
  if (existing.convertedClientId) {
    return { ok: false, reason: "converted_locked" };
  }

  const statusResult = await resolveStatusForSave(
    organizationId,
    "LEAD",
    definitionId,
    existing.statusDefinitionId,
    prisma,
  );
  if (!statusResult.ok) {
    return { ok: false, reason: statusResult.reason === "ARCHIVED" ? "status_archived" : "status_not_found" };
  }

  if (statusResult.isSystem) {
    if (statusResult.key === SYSTEM_STATUS_KEYS.LEAD_LOST) {
      return { ok: false, reason: "use_mark_lost_action" };
    }

    // Reuse moveLeadStageAction wholesale — see this function's own doc
    // comment for why. MOVABLE_LEAD_STAGES already excludes LOST, and
    // every other system LEAD key (new/contacted/qualified/proposal/won)
    // uppercases to a valid LeadStage.
    return moveLeadStageAction(leadId, statusResult.key.toUpperCase() as LeadStage);
  }

  // CUSTOM target — minimal direct write, `stage` untouched.
  const wasLost = resolveLeadIsLost({ stage: existing.stage, statusDefinition: existing.statusDefinition });

  const outcome = await prisma.$transaction(async (tx) => {
    const result = await tx.lead.updateMany({
      where: { id: leadId, organizationId, convertedClientId: null },
      data: {
        statusDefinitionId: statusResult.definitionId,
        // undefined = "leave this column untouched" to Prisma; only ever
        // explicitly cleared when actually leaving LOST — matches every
        // other stage-changing action's own identical rule.
        lostReason: wasLost ? null : undefined,
      },
    });

    if (result.count === 0) {
      // Raced with a concurrent conversion between the read above and
      // this write.
      return "converted_locked" as const;
    }

    await createActivity(tx, {
      organizationId,
      actorId: user.id,
      entityType: "LEAD",
      entityId: leadId,
      action: "UPDATED",
      metadata: buildLeadActivityMetadata({ name: existing.name, stage: existing.stage }, user.name, ["status"]),
    });

    return "updated" as const;
  });

  if (outcome === "converted_locked") {
    return { ok: false, reason: "converted_locked" };
  }

  revalidatePath("/leads");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Mark lost
// ---------------------------------------------------------------------------

export type MarkLeadLostResult =
  | { ok: true }
  | { ok: false; reason: "validation" }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "converted_locked" };

export async function markLeadLostAction(leadId: string, lostReason?: string | null): Promise<MarkLeadLostResult> {
  const parsedReason = parseLostReason(lostReason);
  if (!parsedReason.ok) {
    return { ok: false, reason: "validation" };
  }

  const { user, organizationId } = await getCurrentUserOrganization();

  const limitCheck = checkRateLimit(LEAD_UPDATE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const existing = await tx.lead.findFirst({ where: { id: leadId, organizationId } });
    if (!existing) {
      return "not_found" as const;
    }
    if (existing.convertedClientId) {
      return "converted_locked" as const;
    }

    // Custom Statuses Phase 1 (Section P/H) — synced alongside `stage:
    // "LOST"` below; this is exactly the one real LOST system definition
    // (Section H — a custom status can never reach this path at all).
    const statusDefinition = await resolveSystemStatusDefinition(organizationId, "LEAD", "lost", tx);

    const result = await tx.lead.updateMany({
      where: { id: leadId, organizationId, convertedClientId: null },
      data: { stage: "LOST", statusDefinitionId: statusDefinition?.id, lostReason: parsedReason.value },
    });

    if (result.count === 0) {
      return "converted_locked" as const;
    }

    await createActivity(tx, {
      organizationId,
      actorId: user.id,
      entityType: "LEAD",
      entityId: leadId,
      action: "STATUS_CHANGED",
      // lostReason's own freeform text is deliberately never written into
      // Activity.metadata — only the stage transition is (see
      // lead-metadata.ts's own doc comment); the reason itself stays on
      // the Lead row only.
      metadata: buildLeadStageChangeMetadata(existing.stage, "LOST"),
    });

    return "updated" as const;
  });

  if (outcome === "not_found") return { ok: false, reason: "not_found" };
  if (outcome === "converted_locked") return { ok: false, reason: "converted_locked" };

  revalidatePath("/leads");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Archive / unarchive (soft only — no hard delete in this phase)
// ---------------------------------------------------------------------------

export type ArchiveLeadResult =
  | { ok: true }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "not_found" };

/**
 * Archive is visibility, not deletion — a converted Lead may still be
 * archived (no converted_locked check here, unlike stage-changing
 * actions), and archiving never touches stage, convertedClientId, or any
 * other field.
 */
export async function archiveLeadAction(leadId: string): Promise<ArchiveLeadResult> {
  const { user, organizationId } = await getCurrentUserOrganization();

  const limitCheck = checkRateLimit(LEAD_UPDATE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const existing = await tx.lead.findFirst({ where: { id: leadId, organizationId } });
    if (!existing) {
      return "not_found" as const;
    }

    const alreadyArchived = existing.archivedAt !== null;

    const result = await tx.lead.updateMany({
      where: { id: leadId, organizationId },
      data: { archivedAt: existing.archivedAt ?? new Date() },
    });
    if (result.count === 0) {
      return "not_found" as const;
    }

    // Only log a real transition — archiving an already-archived Lead is
    // a harmless no-op, not a new event.
    if (!alreadyArchived) {
      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "LEAD",
        entityId: leadId,
        action: "UPDATED",
        metadata: buildLeadActivityMetadata(existing, user.name, ["archivedAt"]),
      });
    }

    return "updated" as const;
  });

  if (outcome === "not_found") return { ok: false, reason: "not_found" };
  revalidatePath("/leads");
  return { ok: true };
}

export async function unarchiveLeadAction(leadId: string): Promise<ArchiveLeadResult> {
  const { user, organizationId } = await getCurrentUserOrganization();

  const limitCheck = checkRateLimit(LEAD_UPDATE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const existing = await tx.lead.findFirst({ where: { id: leadId, organizationId } });
    if (!existing) {
      return "not_found" as const;
    }

    const wasArchived = existing.archivedAt !== null;

    const result = await tx.lead.updateMany({
      where: { id: leadId, organizationId },
      data: { archivedAt: null },
    });
    if (result.count === 0) {
      return "not_found" as const;
    }

    if (wasArchived) {
      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "LEAD",
        entityId: leadId,
        action: "UPDATED",
        metadata: buildLeadActivityMetadata(existing, user.name, ["archivedAt"]),
      });
    }

    return "updated" as const;
  });

  if (outcome === "not_found") return { ok: false, reason: "not_found" };
  revalidatePath("/leads");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Convert Lead -> Client
// ---------------------------------------------------------------------------

export type ConvertLeadResult =
  | { ok: true; clientId: string }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "already_converted" }
  | { ok: false; reason: "lost" }
  | { ok: false; reason: "requires_duplicate_confirmation"; message: string }
  | { ok: false; reason: "entitlement_blocked"; message: string };

export type ConvertLeadOptions = {
  /**
   * Authorizes only "proceed despite a same-organization duplicate
   * email" — never selects an existing Client, never supplies a Client
   * id, never bypasses tenant scoping or the entitlement check below.
   * MVP always creates a brand-new Client either way (approved product
   * decision: no auto-link/auto-merge).
   */
  confirmDuplicate?: boolean;
};

/**
 * The highest-risk action in this phase — see this module's own header
 * comment for the shared architecture, and the inline comments below for
 * exactly how each of the approved requirements (atomicity, duplicate-
 * email handling, race safety, entitlement enforcement, repeat-conversion
 * rejection) is met.
 */
export async function convertLeadToClientAction(
  leadId: string,
  options: ConvertLeadOptions = {},
): Promise<ConvertLeadResult> {
  const { user, organizationId } = await getCurrentUserOrganization();

  const limitCheck = checkRateLimit(LEAD_UPDATE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  // Cheap pre-check, outside any transaction — fails fast on the common
  // reject paths (not found / already converted / lost / archived)
  // before ever doing the duplicate-email lookup or opening a
  // transaction. Never the actual authorization boundary: the
  // transaction below re-derives every one of these from scratch against
  // its own consistent view, specifically to close the TOCTOU window
  // between this read and that write (Section K.7's own requirement).
  const preCheck = await prisma.lead.findFirst({
    where: { id: leadId, organizationId, archivedAt: null },
    include: { statusDefinition: { select: STATUS_DEFINITION_IDENTITY_SELECT } },
  });
  if (!preCheck) {
    return { ok: false, reason: "not_found" };
  }
  if (preCheck.convertedClientId) {
    return { ok: false, reason: "already_converted" };
  }
  // Custom Statuses Phase 2A (Section F) — see moveLeadStageAction's own
  // identical comment.
  if (resolveLeadIsLost(preCheck)) {
    return { ok: false, reason: "lost" };
  }

  // Duplicate-email preflight — same-organization only, case-insensitive,
  // never revealing the existing Client's own id anywhere in the
  // returned result. Skipped when the Lead has no email at all (nothing
  // to collide on) or the caller already confirmed once.
  if (
    !options.confirmDuplicate &&
    (await findDuplicateOrganizationClientByEmail({ organizationId, email: preCheck.email }))
  ) {
    return { ok: false, reason: "requires_duplicate_confirmation", message: DUPLICATE_EMAIL_MESSAGE };
  }

  try {
    const clientId = await prisma.$transaction(async (tx) => {
      // Re-fetch and re-check every rejection condition under this
      // transaction's own consistent view — never trust the pre-check
      // above for the actual decision.
      const lead = await tx.lead.findFirst({
        where: { id: leadId, organizationId, archivedAt: null },
        include: { statusDefinition: { select: STATUS_DEFINITION_IDENTITY_SELECT } },
      });
      if (!lead) {
        throw new LeadConversionError("not_found");
      }
      if (lead.convertedClientId) {
        throw new LeadConversionError("already_converted");
      }
      // Custom Statuses Phase 2A (Section F) — see moveLeadStageAction's
      // own identical comment.
      if (resolveLeadIsLost(lead)) {
        throw new LeadConversionError("lost");
      }

      // Re-check duplicate-email state too, for the same TOCTOU reason —
      // a different request could have created a colliding Client after
      // the preflight above ran but before this transaction opened.
      if (
        !options.confirmDuplicate &&
        (await findDuplicateOrganizationClientByEmail({ organizationId, email: lead.email, client: tx }))
      ) {
        throw new LeadConversionError("requires_duplicate_confirmation");
      }

      // Billing & Subscriptions Stage 2's own re-check-inside-the-
      // transaction convention (assertCanCreateClient's own doc comment)
      // — Lead conversion must never be a way to bypass the Starter
      // plan's Client cap that direct Client creation already enforces.
      await assertCanCreateClient(organizationId, tx);

      // Custom Statuses Phase 1 (Section P/I) — the converted Client
      // always starts ACTIVE (see `status: "ACTIVE"` below); this is
      // exactly the one real ACTIVE system definition Section I's own
      // audit found (Lead conversion's hardcoded default).
      const clientStatusDefinition = await resolveSystemStatusDefinition(organizationId, "CLIENT", "active", tx);

      // Client mapping — exactly the approved field set. source/value/
      // lostReason/archivedAt stay on the Lead as historical data, never
      // copied onto the new Client.
      const client = await tx.client.create({
        data: {
          name: lead.name,
          company: lead.company,
          email: lead.email,
          phone: lead.phone,
          notes: lead.notes,
          status: "ACTIVE",
          statusDefinitionId: clientStatusDefinition?.id,
          organizationId,
          userId: user.id,
        },
      });

      // Multiple Contacts Phase 1 — same rule and reasoning as
      // createClientAction's own identical block: a primary ClientContact
      // is created in this same transaction whenever the Lead had
      // contact-capable data, so contact creation failing rolls the whole
      // conversion (Client + Activity) back with it. Lead.name is never
      // copied onto the contact's own name for the identical reason
      // Client.name isn't — Lead.name/Client.name share the same
      // ambiguous "could be a person or a business" shape (both have a
      // separate, optional `company` field), so the fallback-name rule
      // stays consistent whether a Client was created directly or via
      // Lead conversion. Lead.email/Lead.phone map straight across —
      // source/value/lostReason/stage/notes are Lead-only history and
      // were never candidates for a Contact field either way.
      if (lead.email || lead.phone) {
        const contactResult = await createClientContact(
          organizationId,
          client.id,
          {
            name: resolveFallbackContactName(lead.email),
            email: lead.email,
            phone: lead.phone,
            isPrimary: true,
          },
          tx,
        );
        if (!contactResult.ok) {
          throw new Error(`Unexpected ClientContact creation failure: ${contactResult.reason}`);
        }
      }

      // Consistency with direct Client creation (createClientAction),
      // which always logs its own CLIENT/CREATED Activity — a
      // conversion-created Client gets the identical event, so its own
      // Activity timeline reads the same regardless of how it came to
      // exist.
      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "CLIENT",
        entityId: client.id,
        action: "CREATED",
        metadata: buildClientActivityMetadata(client, user.name),
      });

      // Guarded conditional update — convertedClientId: null in the
      // WHERE is the actual race defense (two simultaneous conversions
      // must persist exactly one Client): if a concurrent request already
      // converted this same Lead between the read above and this write,
      // count is 0 here and the whole transaction throws, rolling back
      // the Client row (and its Activity) this same transaction just
      // created.
      // Custom Statuses Phase 1 (Section P/H) — synced alongside
      // `stage: "WON"` below; the one real WON system definition
      // Section H's own audit found.
      const leadStatusDefinition = await resolveSystemStatusDefinition(organizationId, "LEAD", "won", tx);

      const result = await tx.lead.updateMany({
        where: { id: leadId, organizationId, convertedClientId: null },
        data: {
          convertedClientId: client.id,
          convertedAt: new Date(),
          stage: "WON",
          statusDefinitionId: leadStatusDefinition?.id,
          lostReason: null,
        },
      });

      if (result.count !== 1) {
        throw new LeadConversionError("already_converted");
      }

      // Quotes / Estimates Phase 2 — reconcile any Quotes already
      // attached to this Lead before conversion (leadId set, clientId
      // null). This is the durable Quote invariant approved in Phase 1
      // (see Quote's own schema comment): once a Lead converts, leadId
      // is preserved permanently for lineage while clientId gets
      // populated. Scoped by organizationId + leadId + clientId: null,
      // so this can only ever fill in a still-null clientId — it can
      // never touch a Quote that already has one (a direct-Client Quote,
      // or one an earlier conversion attempt already reconciled), and it
      // never accepts a caller-supplied Quote id. No new transaction:
      // this lives inside the exact same one as the Lead/Client writes
      // above, so it rolls back together with everything else if
      // anything later in this transaction fails.
      await tx.quote.updateMany({
        where: { organizationId, leadId, clientId: null },
        data: { clientId: client.id },
      });

      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "LEAD",
        entityId: leadId,
        action: "CONVERTED",
        metadata: buildLeadActivityMetadata({ name: lead.name, stage: "WON" }, user.name),
      });

      return client.id;
    });

    revalidatePath("/leads");
    return { ok: true, clientId };
  } catch (err) {
    if (err instanceof LeadConversionError) {
      if (err.reason === "requires_duplicate_confirmation") {
        return { ok: false, reason: "requires_duplicate_confirmation", message: DUPLICATE_EMAIL_MESSAGE };
      }
      return { ok: false, reason: err.reason };
    }
    if (err instanceof BillingLimitError) {
      return { ok: false, reason: "entitlement_blocked", message: err.message };
    }
    throw err;
  }
}
