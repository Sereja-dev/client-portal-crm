import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { CustomFieldDefinition } from "@/generated/prisma/client";
import type { CustomFieldEntityType, CustomFieldType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import { deriveUniqueCustomFieldDefinitionKey } from "./key";

/**
 * Custom Fields Phase 1 — Definition domain layer (Section C/F/G/H/I/K).
 * Every function here is organization-scoped exactly like
 * src/lib/clients/contacts.ts's own established convention: a foreign-org
 * id is always treated as nonexistent, never a distinguishable "exists
 * but denied" case (Section K).
 */

export type CustomFieldDefinitionMutationResult =
  | { ok: true; definition: CustomFieldDefinition }
  | { ok: false; reason: "DEFINITION_NOT_FOUND" };

/**
 * Every active (non-archived) definition for one organization+entityType,
 * ordered by position (Section G). Pass `includeArchived: true` to also
 * see archived definitions — excluded by default, matching Lead/
 * ClientContact's own archivedAt convention (Section H: "archived
 * definitions hidden from ordinary active lists").
 */
export async function listCustomFieldDefinitions(
  organizationId: string,
  entityType: CustomFieldEntityType,
  options: { includeArchived?: boolean } = {},
  client: PrismaClientOrTx = prisma,
): Promise<CustomFieldDefinition[]> {
  return client.customFieldDefinition.findMany({
    where: {
      organizationId,
      entityType,
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Creates a new CustomFieldDefinition. `key` derives from `label` when
 * not explicitly supplied (Section F) — deterministic collision handling
 * via deriveUniqueCustomFieldDefinitionKey; an explicitly supplied `key`
 * is still normalized through the same slugifier so no arbitrary
 * user-defined SQL-like name can reach the database (Section F), and
 * still checked for a collision the same way (a P2002 race is possible
 * only under genuine concurrent creation, surfaced as
 * CONCURRENT_KEY_CONFLICT rather than an unhandled exception).
 *
 * `position` is always `current max + 1` within this
 * organization+entityType (Section G) — never caller-supplied, so a new
 * definition always lands at the end of the active list.
 *
 * `required` is stored but never enforced against existing Client/Lead/
 * Project mutations in this phase (Section I) — see this repository's
 * CustomFieldDefinition.required schema comment for the full reasoning.
 */
export async function createCustomFieldDefinition(
  organizationId: string,
  entityType: CustomFieldEntityType,
  input: {
    label: string;
    fieldType: CustomFieldType;
    required?: boolean;
    key?: string;
  },
  client: PrismaClientOrTx = prisma,
): Promise<
  | { ok: true; definition: CustomFieldDefinition }
  | { ok: false; reason: "INVALID_LABEL" | "CONCURRENT_KEY_CONFLICT" }
> {
  const label = input.label.trim();
  if (!label) {
    return { ok: false, reason: "INVALID_LABEL" };
  }

  const key = await deriveUniqueCustomFieldDefinitionKey(organizationId, entityType, input.key ?? label, client);

  const runCreate = async (tx: PrismaClientOrTx) => {
    const last = await tx.customFieldDefinition.findFirst({
      where: { organizationId, entityType },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const position = (last?.position ?? -1) + 1;

    return tx.customFieldDefinition.create({
      data: {
        organizationId,
        entityType,
        key,
        label,
        fieldType: input.fieldType,
        required: input.required ?? false,
        position,
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

type DriverAdapterMeta = {
  driverAdapterError?: {
    cause?: { constraint?: { fields?: unknown } };
  };
};

/**
 * True only for CustomFieldDefinition's own (organizationId, entityType,
 * key) unique constraint. `error.meta.target` is never populated on this
 * project's Prisma/driver-adapter stack — the real, distinguishing
 * signal is `meta.driverAdapterError.cause.constraint.fields`, an
 * ordered array of quoted column names, per src/lib/invoices/
 * write-conflict-mapper.ts's own empirically-verified finding (reused
 * here rather than re-derived).
 */
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
 * Updates a definition's label and/or required flag. Deliberately has no
 * `fieldType` or `key` in its input type at all — fieldType is immutable
 * after creation (existing CustomFieldValue rows are already typed
 * according to it; changing it later would silently strand or corrupt
 * them, per this repository's own explicit Phase 1 design decision), and
 * key never changes automatically or otherwise once set (Section F).
 * entityType is likewise not editable — moving a definition between
 * entity types would orphan its own values the same way.
 */
export async function updateCustomFieldDefinition(
  organizationId: string,
  definitionId: string,
  input: { label?: string; required?: boolean },
  client: PrismaClientOrTx = prisma,
): Promise<CustomFieldDefinitionMutationResult | { ok: false; reason: "INVALID_LABEL" }> {
  const existing = await client.customFieldDefinition.findFirst({ where: { id: definitionId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "DEFINITION_NOT_FOUND" };
  }

  let label: string | undefined;
  if (input.label !== undefined) {
    label = input.label.trim();
    if (!label) {
      return { ok: false, reason: "INVALID_LABEL" };
    }
  }

  const definition = await client.customFieldDefinition.update({
    where: { id: definitionId },
    data: {
      ...(label !== undefined ? { label } : {}),
      ...(input.required !== undefined ? { required: input.required } : {}),
    },
  });

  return { ok: true, definition };
}

/**
 * Soft-archives a definition (archivedAt = now()) — never hard-deletes
 * (Section H). Idempotent: an already-archived definition is returned
 * unchanged. Existing CustomFieldValue rows are retained untouched; only
 * the definition itself is hidden from ordinary active lists going
 * forward (listCustomFieldDefinitions's own default).
 */
export async function archiveCustomFieldDefinition(
  organizationId: string,
  definitionId: string,
  client: PrismaClientOrTx = prisma,
): Promise<CustomFieldDefinitionMutationResult> {
  const existing = await client.customFieldDefinition.findFirst({ where: { id: definitionId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "DEFINITION_NOT_FOUND" };
  }
  if (existing.archivedAt !== null) {
    return { ok: true, definition: existing };
  }

  const definition = await client.customFieldDefinition.update({
    where: { id: definitionId },
    data: { archivedAt: new Date() },
  });
  return { ok: true, definition };
}

/**
 * Restores an archived definition (Section H: "may be unarchived
 * later"). Idempotent: an already-active definition is returned
 * unchanged. Its key/position/existing values are all exactly as they
 * were — unarchiving is a pure archivedAt flip, nothing else.
 */
export async function unarchiveCustomFieldDefinition(
  organizationId: string,
  definitionId: string,
  client: PrismaClientOrTx = prisma,
): Promise<CustomFieldDefinitionMutationResult> {
  const existing = await client.customFieldDefinition.findFirst({ where: { id: definitionId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "DEFINITION_NOT_FOUND" };
  }
  if (existing.archivedAt === null) {
    return { ok: true, definition: existing };
  }

  const definition = await client.customFieldDefinition.update({
    where: { id: definitionId },
    data: { archivedAt: null },
  });
  return { ok: true, definition };
}
