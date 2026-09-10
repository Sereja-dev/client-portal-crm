import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { CustomStatusDefinition } from "@/generated/prisma/client";
import type { CustomStatusColor, CustomStatusEntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import { slugifyCustomStatusIdentifier } from "./slug";
import { SYSTEM_STATUS_KEYS } from "./constants";

/**
 * Custom Statuses Phase 1 — Definition domain layer (Section F/K/L/S/U).
 * Every function here is organization-scoped exactly like Custom Fields'
 * own definitions.ts: a foreign-org id is always treated as nonexistent,
 * never a distinguishable "exists but denied" case (Section V).
 */

export type CustomStatusDefinitionMutationResult =
  | { ok: true; definition: CustomStatusDefinition }
  | { ok: false; reason: "DEFINITION_NOT_FOUND" };

/**
 * Every active (non-archived) definition for one organization+entityType,
 * ordered by position (Section U) — system and custom definitions share
 * one ordering. Pass `includeArchived: true` to also see archived
 * definitions (Section L: hidden from ordinary active lists by default).
 */
export async function listCustomStatusDefinitions(
  organizationId: string,
  entityType: CustomStatusEntityType,
  options: { includeArchived?: boolean } = {},
  client: PrismaClientOrTx = prisma,
): Promise<CustomStatusDefinition[]> {
  return client.customStatusDefinition.findMany({
    where: {
      organizationId,
      entityType,
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

export async function getCustomStatusDefinition(
  organizationId: string,
  definitionId: string,
  client: PrismaClientOrTx = prisma,
): Promise<CustomStatusDefinition | null> {
  return client.customStatusDefinition.findFirst({ where: { id: definitionId, organizationId } });
}

type DriverAdapterMeta = {
  driverAdapterError?: {
    cause?: { constraint?: { fields?: unknown } };
  };
};

/** True only for CustomStatusDefinition's own (organizationId, entityType, key) unique constraint — same detection shape Custom Fields' own isKeyConflict already established (src/lib/custom-fields/definitions.ts). `error.meta.target` is never populated on this project's Prisma/driver-adapter stack. */
function isKeyConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const fields = (err.meta as DriverAdapterMeta | undefined)?.driverAdapterError?.cause?.constraint?.fields;
  return (
    Array.isArray(fields) &&
    fields.length === 3 &&
    fields[0] === '"organizationId"' &&
    fields[1] === '"entityType"' &&
    fields[2] === '"key"'
  );
}

/**
 * Deterministic collision handling (Section S): base slug, then
 * `${base}_2`, `${base}_3`, ... until one is free within this
 * organization+entityType. Archived definitions still occupy their key
 * (permanently reserved, same rule as Custom Fields' own key), so this
 * check deliberately does NOT filter by archivedAt.
 */
async function deriveUniqueCustomStatusKey(
  organizationId: string,
  entityType: CustomStatusEntityType,
  label: string,
  client: PrismaClientOrTx,
): Promise<string> {
  const base = slugifyCustomStatusIdentifier(label);

  let candidate = base;
  let suffix = 2;
  while (
    await client.customStatusDefinition.findFirst({
      where: { organizationId, entityType, key: candidate },
      select: { id: true },
    })
  ) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }

  return candidate;
}

/**
 * Creates a new CUSTOM status definition — always isSystem: false,
 * isDefault: false (Section F/K: a newly created definition never
 * silently becomes the default; use setDefaultCustomStatusDefinition
 * explicitly for that). `key` auto-derives from `label` (Section S).
 * `position` is always `current max + 1` within this
 * organization+entityType (Section U), so it lands after every existing
 * system and custom definition alike.
 */
export async function createCustomStatusDefinition(
  organizationId: string,
  entityType: CustomStatusEntityType,
  input: { label: string; color?: CustomStatusColor | null },
  client: PrismaClientOrTx = prisma,
): Promise<
  | { ok: true; definition: CustomStatusDefinition }
  | { ok: false; reason: "INVALID_LABEL" | "CONCURRENT_KEY_CONFLICT" }
> {
  const label = input.label.trim();
  if (!label) {
    return { ok: false, reason: "INVALID_LABEL" };
  }

  const key = await deriveUniqueCustomStatusKey(organizationId, entityType, label, client);

  const runCreate = async (tx: PrismaClientOrTx) => {
    const last = await tx.customStatusDefinition.findFirst({
      where: { organizationId, entityType },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const position = (last?.position ?? -1) + 1;

    return tx.customStatusDefinition.create({
      data: {
        organizationId,
        entityType,
        key,
        label,
        color: input.color ?? null,
        position,
        isDefault: false,
        isSystem: false,
      },
    });
  };

  try {
    const definition = client === prisma ? await prisma.$transaction((tx) => runCreate(tx)) : await runCreate(client);
    return { ok: true, definition };
  } catch (err) {
    if (isKeyConflict(err)) {
      return { ok: false, reason: "CONCURRENT_KEY_CONFLICT" };
    }
    throw err;
  }
}

/**
 * Updates a CUSTOM definition's label and/or color. System definitions
 * are deliberately never editable through this function (Section L: "do
 * not allow archive... if core semantics depend on them" — extended here
 * to label/color too, the same conservative Phase 1 rule: a system
 * definition's label is meant to keep matching the legacy enum value it
 * mirrors, and nothing in this phase reviews or displays a changed
 * label anywhere yet). `key` is never accepted as input at all (Section
 * S: label rename never changes key).
 */
export async function updateCustomStatusDefinition(
  organizationId: string,
  definitionId: string,
  input: { label?: string; color?: CustomStatusColor | null },
  client: PrismaClientOrTx = prisma,
): Promise<CustomStatusDefinitionMutationResult | { ok: false; reason: "INVALID_LABEL" | "SYSTEM_DEFINITION" }> {
  const existing = await client.customStatusDefinition.findFirst({ where: { id: definitionId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "DEFINITION_NOT_FOUND" };
  }
  if (existing.isSystem) {
    return { ok: false, reason: "SYSTEM_DEFINITION" };
  }

  let label: string | undefined;
  if (input.label !== undefined) {
    label = input.label.trim();
    if (!label) {
      return { ok: false, reason: "INVALID_LABEL" };
    }
  }

  const definition = await client.customStatusDefinition.update({
    where: { id: definitionId },
    data: {
      ...(label !== undefined ? { label } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
    },
  });

  return { ok: true, definition };
}

/**
 * Soft-archives a CUSTOM definition (Section L). Blocked for:
 *   - a system definition (Section L: core semantics may depend on it,
 *     and nothing in this phase has migrated off reading the legacy
 *     enum column those mirror);
 *   - the current default (Section K/L's own "prefer simple safe rule:
 *     block archive of current default" — the caller must
 *     setDefaultCustomStatusDefinition to a different active definition
 *     first).
 * Idempotent: an already-archived definition is returned unchanged.
 * Existing entities that reference this definition (via
 * statusDefinitionId — Phase 2+, nothing in Phase 1 assigns a custom
 * status to a real entity yet) retain it untouched; only the definition
 * itself is hidden from ordinary active lists going forward.
 */
export async function archiveCustomStatusDefinition(
  organizationId: string,
  definitionId: string,
  client: PrismaClientOrTx = prisma,
): Promise<CustomStatusDefinitionMutationResult | { ok: false; reason: "SYSTEM_DEFINITION" | "IS_CURRENT_DEFAULT" }> {
  const existing = await client.customStatusDefinition.findFirst({ where: { id: definitionId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "DEFINITION_NOT_FOUND" };
  }
  if (existing.archivedAt !== null) {
    return { ok: true, definition: existing };
  }
  if (existing.isSystem) {
    return { ok: false, reason: "SYSTEM_DEFINITION" };
  }
  if (existing.isDefault) {
    return { ok: false, reason: "IS_CURRENT_DEFAULT" };
  }

  const definition = await client.customStatusDefinition.update({
    where: { id: definitionId },
    data: { archivedAt: new Date() },
  });
  return { ok: true, definition };
}

/** Restores an archived CUSTOM definition (Section L). Idempotent. Its key/position/isDefault are all exactly as they were — unarchiving is a pure archivedAt flip. */
export async function unarchiveCustomStatusDefinition(
  organizationId: string,
  definitionId: string,
  client: PrismaClientOrTx = prisma,
): Promise<CustomStatusDefinitionMutationResult> {
  const existing = await client.customStatusDefinition.findFirst({ where: { id: definitionId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "DEFINITION_NOT_FOUND" };
  }
  if (existing.archivedAt === null) {
    return { ok: true, definition: existing };
  }

  const definition = await client.customStatusDefinition.update({
    where: { id: definitionId },
    data: { archivedAt: null },
  });
  return { ok: true, definition };
}

/**
 * Sets this definition as THE active default for its own
 * organization+entityType (Section K) — transactionally unsets whichever
 * definition previously held that spot, in the same transaction as
 * setting the new one, so there is never a moment with zero or two
 * active defaults. The target must already be active (not archived);
 * archived definitions can never become the default. Works for both
 * system and custom definitions for CLIENT/PROJECT (Section K places no
 * isSystem restriction on which definition may be the default — a
 * custom default is a legitimate, intended capability, and reverting
 * back to a system default like "Lead" must also stay possible).
 *
 * Phase 2B Completion Pass (Section B/C) — LEAD is the one exception:
 * its default is permanently locked to the system NEW definition (Lead
 * creation always starts at NEW, a pre-existing invariant this Settings
 * surface must never appear to control — see leads/actions.ts's own
 * createLeadAction comment). Rejected here, at the one real write
 * choke-point every caller (the Settings Server Action's direct "Set
 * default" button AND createCustomStatusAction's own makeDefault path)
 * funnels through — never relying on the UI alone to hide the button
 * (Section C).
 */
export async function setDefaultCustomStatusDefinition(
  organizationId: string,
  entityType: CustomStatusEntityType,
  definitionId: string,
  client: PrismaClientOrTx = prisma,
): Promise<CustomStatusDefinitionMutationResult | { ok: false; reason: "ARCHIVED_DEFINITION" | "LEAD_DEFAULT_LOCKED" }> {
  const target = await client.customStatusDefinition.findFirst({ where: { id: definitionId, organizationId, entityType } });
  if (!target) {
    return { ok: false, reason: "DEFINITION_NOT_FOUND" };
  }
  if (entityType === "LEAD" && !(target.isSystem && target.key === SYSTEM_STATUS_KEYS.LEAD_NEW)) {
    return { ok: false, reason: "LEAD_DEFAULT_LOCKED" };
  }
  if (target.archivedAt !== null) {
    return { ok: false, reason: "ARCHIVED_DEFINITION" };
  }
  if (target.isDefault) {
    return { ok: true, definition: target };
  }

  const runSetDefault = async (tx: PrismaClientOrTx) => {
    await tx.customStatusDefinition.updateMany({
      where: { organizationId, entityType, isDefault: true, id: { not: definitionId } },
      data: { isDefault: false },
    });
    return tx.customStatusDefinition.update({
      where: { id: definitionId },
      data: { isDefault: true },
    });
  };

  const definition = client === prisma ? await prisma.$transaction((tx) => runSetDefault(tx)) : await runSetDefault(client);
  return { ok: true, definition };
}

/**
 * Custom Statuses Phase 1 (Section U) — the same focused, O(1)-write
 * reorder Custom Fields' own moveCustomFieldDefinition already
 * established (see that function's own comment for the full swap/race-
 * safety reasoning). Moves one definition one step up/down among the
 * ACTIVE definitions for this organization+entityType — system and
 * custom definitions share one ordering, so this can reorder either kind
 * (or swap a system definition past a custom one and vice versa).
 */
export async function moveCustomStatusDefinition(
  organizationId: string,
  entityType: CustomStatusEntityType,
  definitionId: string,
  direction: "up" | "down",
  client: PrismaClientOrTx = prisma,
): Promise<{ ok: true } | { ok: false; reason: "DEFINITION_NOT_FOUND" | "CANNOT_MOVE" }> {
  const runMove = async (tx: PrismaClientOrTx) => {
    const target = await tx.customStatusDefinition.findFirst({
      where: { id: definitionId, organizationId, entityType, archivedAt: null },
    });
    if (!target) {
      return { ok: false as const, reason: "DEFINITION_NOT_FOUND" as const };
    }

    const neighbor = await tx.customStatusDefinition.findFirst({
      where: {
        organizationId,
        entityType,
        archivedAt: null,
        position: direction === "up" ? { lt: target.position } : { gt: target.position },
      },
      orderBy: { position: direction === "up" ? "desc" : "asc" },
    });
    if (!neighbor) {
      return { ok: false as const, reason: "CANNOT_MOVE" as const };
    }

    await tx.customStatusDefinition.update({ where: { id: target.id }, data: { position: neighbor.position } });
    await tx.customStatusDefinition.update({ where: { id: neighbor.id }, data: { position: target.position } });
    return { ok: true as const };
  };

  return client === prisma ? prisma.$transaction((tx) => runMove(tx)) : runMove(client);
}
