import "server-only";
import type { ClientStatus, LeadStage, ProjectStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import { assertStatusDefinitionOwnership } from "./resolution";

/**
 * Custom Statuses Phase 1 — entity-assignment primitives (Section R).
 * Deliberately "dumb" status swaps and nothing more: assigning a status
 * definition to a Client/Lead/Project here NEVER triggers conversion,
 * NEVER requires/clears lostReason, NEVER mutates a Quote, and NEVER
 * gates Portal/billing behavior — those all remain the exclusive
 * responsibility of the existing dedicated Server Actions
 * (markLeadLostAction, convertLeadToClientAction, moveLeadStageAction),
 * which this phase leaves untouched apart from the compatibility-sync
 * wiring described in each legacy enum column's own schema comment
 * (Section P). This is precisely Section H/I/J's own requirement: a
 * custom status must never automatically behave like a system one, and
 * these functions are simple enough that they structurally cannot —
 * there is no label-sniffing, no key-pattern-matching, nothing here even
 * looks at which specific definition was passed beyond confirming it
 * belongs to the right organization+entityType and isn't archived.
 *
 * Compatibility sync (Section P): when the assigned definition is
 * SYSTEM-backed, the legacy enum/stage column is also written, keeping
 * both representations consistent for every existing business rule that
 * still reads the legacy column as authoritative. When the assigned
 * definition is CUSTOM, the legacy column is left completely untouched
 * (Section P's own documented Phase 1 limitation — see this feature's
 * own migration's header comment for the full "why not nullable yet"
 * reasoning) — Phase 1 calls no code path that would ever actually reach
 * this branch against a real entity yet, since no Server Action/UI
 * exists to assign a custom status at all (Section Y).
 */

const CLIENT_KEY_TO_LEGACY_STATUS: Record<string, ClientStatus> = {
  lead: "LEAD",
  active: "ACTIVE",
  inactive: "INACTIVE",
  archived: "ARCHIVED",
};

const LEAD_KEY_TO_LEGACY_STAGE: Record<string, LeadStage> = {
  new: "NEW",
  contacted: "CONTACTED",
  qualified: "QUALIFIED",
  proposal: "PROPOSAL",
  won: "WON",
  lost: "LOST",
};

const PROJECT_KEY_TO_LEGACY_STATUS: Record<string, ProjectStatus> = {
  planning: "PLANNING",
  in_progress: "IN_PROGRESS",
  on_hold: "ON_HOLD",
  completed: "COMPLETED",
  cancelled: "CANCELLED",
};

export type AssignStatusResult =
  | { ok: true }
  | { ok: false; reason: "ENTITY_NOT_FOUND" | "DEFINITION_NOT_FOUND" | "ARCHIVED_DEFINITION" };

export async function assignClientStatus(
  organizationId: string,
  clientId: string,
  definitionId: string,
  client: PrismaClientOrTx = prisma,
): Promise<AssignStatusResult> {
  const definition = await assertStatusDefinitionOwnership(
    { organizationId, entityType: "CLIENT", definitionId },
    client,
  );
  if (!definition) {
    return { ok: false, reason: "DEFINITION_NOT_FOUND" };
  }
  if (definition.archivedAt !== null) {
    return { ok: false, reason: "ARCHIVED_DEFINITION" };
  }

  const legacyStatus = definition.isSystem ? CLIENT_KEY_TO_LEGACY_STATUS[definition.key] : undefined;

  const result = await client.client.updateMany({
    where: { id: clientId, organizationId },
    data: {
      statusDefinitionId: definitionId,
      ...(legacyStatus ? { status: legacyStatus } : {}),
    },
  });

  if (result.count === 0) {
    return { ok: false, reason: "ENTITY_NOT_FOUND" };
  }
  return { ok: true };
}

export async function assignLeadStatus(
  organizationId: string,
  leadId: string,
  definitionId: string,
  client: PrismaClientOrTx = prisma,
): Promise<AssignStatusResult> {
  const definition = await assertStatusDefinitionOwnership(
    { organizationId, entityType: "LEAD", definitionId },
    client,
  );
  if (!definition) {
    return { ok: false, reason: "DEFINITION_NOT_FOUND" };
  }
  if (definition.archivedAt !== null) {
    return { ok: false, reason: "ARCHIVED_DEFINITION" };
  }

  const legacyStage = definition.isSystem ? LEAD_KEY_TO_LEGACY_STAGE[definition.key] : undefined;

  const result = await client.lead.updateMany({
    where: { id: leadId, organizationId },
    data: {
      statusDefinitionId: definitionId,
      ...(legacyStage ? { stage: legacyStage } : {}),
    },
  });

  if (result.count === 0) {
    return { ok: false, reason: "ENTITY_NOT_FOUND" };
  }
  return { ok: true };
}

export async function assignProjectStatus(
  organizationId: string,
  projectId: string,
  definitionId: string,
  client: PrismaClientOrTx = prisma,
): Promise<AssignStatusResult> {
  const definition = await assertStatusDefinitionOwnership(
    { organizationId, entityType: "PROJECT", definitionId },
    client,
  );
  if (!definition) {
    return { ok: false, reason: "DEFINITION_NOT_FOUND" };
  }
  if (definition.archivedAt !== null) {
    return { ok: false, reason: "ARCHIVED_DEFINITION" };
  }

  const legacyStatus = definition.isSystem ? PROJECT_KEY_TO_LEGACY_STATUS[definition.key] : undefined;

  const result = await client.project.updateMany({
    where: { id: projectId, organizationId },
    data: {
      statusDefinitionId: definitionId,
      ...(legacyStatus ? { status: legacyStatus } : {}),
    },
  });

  if (result.count === 0) {
    return { ok: false, reason: "ENTITY_NOT_FOUND" };
  }
  return { ok: true };
}
