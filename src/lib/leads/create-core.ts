import "server-only";
import type { Prisma, Lead } from "@/generated/prisma/client";
import { resolveSystemStatusDefinition } from "@/lib/custom-statuses/resolution";
import { createActivity } from "@/lib/activity/create-activity";
import { buildLeadActivityMetadata } from "@/lib/activity/lead-metadata";
import type { ParsedLeadInput } from "@/lib/validation/lead";

/**
 * CSV Import Phase 2 — Lead's own counterpart to
 * src/lib/clients/create-core.ts (see that module's own doc comment for
 * the full "why" — identical reasoning applies here). `createLeadAction`
 * (interactive) and the import execute step both call this one function
 * from inside their own already-open transaction.
 *
 * Lead creation never dispatches Workflow Automations today at all (only
 * updateLeadAction/markLeadLostAction/convertLeadToClientAction do) —
 * this core's own `context` therefore only controls Activity creation,
 * which is still the one thing import must explicitly suppress per the
 * approved architecture ("no per-row CREATED Activity, no Workflow
 * Automation dispatch" — the latter half is satisfied by there being no
 * dispatch call on this path at all, interactive or import).
 */
export type LeadCreationContext = "interactive" | "import";

export type CreateLeadCoreParams = {
  organizationId: string;
  userId: string;
  actorName: string;
  context: LeadCreationContext;
  input: ParsedLeadInput;
};

export type CreateLeadCoreResult = {
  lead: Lead;
  /** Non-null only for context "interactive" — see this module's own doc comment. */
  activity: Awaited<ReturnType<typeof createActivity>> | null;
};

/** Must be called from inside an already-open transaction (`tx`) — the Lead row and its Activity row are one atomic unit, identical to createLeadAction's own pre-existing transaction shape. */
export async function createLeadCore(
  tx: Prisma.TransactionClient,
  params: CreateLeadCoreParams,
): Promise<CreateLeadCoreResult> {
  // Custom Statuses Phase 1 (Section P) — a created Lead always starts
  // at the schema's own default NEW stage (createLeadAction's own
  // pre-existing rule, unconditionally the same for import — Phase 2's
  // own locked scope: "Imported Leads always begin in NEW... a CSV Stage
  // column must not change that behavior"), so its statusDefinitionId is
  // resolved to the matching system definition's key up front, same
  // "leave unset if somehow not found" fail-open rule createLeadAction
  // itself already uses.
  const statusDefinition = await resolveSystemStatusDefinition(params.organizationId, "LEAD", "new", tx);

  const created = await tx.lead.create({
    data: {
      organizationId: params.organizationId,
      name: params.input.name,
      company: params.input.company,
      email: params.input.email,
      phone: params.input.phone,
      source: params.input.source,
      value: params.input.value,
      notes: params.input.notes,
      assignedToUserId: params.input.assignedToUserId,
      statusDefinitionId: statusDefinition?.id,
      // stage: not set — the schema's own @default(NEW) applies, exactly
      // like createLeadAction's own identical comment.
    },
  });

  let activity: Awaited<ReturnType<typeof createActivity>> | null = null;
  if (params.context === "interactive") {
    activity = await createActivity(tx, {
      organizationId: params.organizationId,
      actorId: params.userId,
      entityType: "LEAD",
      entityId: created.id,
      action: "CREATED",
      metadata: buildLeadActivityMetadata(created, params.actorName),
    });
  }
  // context === "import": no Activity row is written — the explicit,
  // named suppression this module's own doc comment describes.

  return { lead: created, activity };
}
