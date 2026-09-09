import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { CustomFieldOption } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import { deriveUniqueCustomFieldOptionValue } from "./key";

/**
 * Custom Fields Phase 1 — SELECT option domain layer (Section O).
 * CustomFieldOption has no direct organizationId (see that model's own
 * schema comment), so every function here takes `organizationId` and
 * `definitionId` together and re-verifies the definition actually
 * belongs to that organization before touching any option — the same
 * "never trust a caller-provided id on its own" discipline
 * assertCustomFieldEntityOwnership uses for values (Section K/L). A
 * foreign-org definitionId is treated as nonexistent, never a
 * distinguishable "exists but denied" case.
 */

export type CustomFieldOptionMutationResult =
  | { ok: true; option: CustomFieldOption }
  | { ok: false; reason: "DEFINITION_NOT_FOUND" | "OPTION_NOT_FOUND" | "NOT_SELECT_FIELD" };

/** Verifies definitionId belongs to organizationId and is a SELECT field — every mutation below needs both facts before it may touch an option. */
async function assertSelectDefinitionOwnership(
  client: PrismaClientOrTx,
  organizationId: string,
  definitionId: string,
): Promise<{ ok: true } | { ok: false; reason: "DEFINITION_NOT_FOUND" | "NOT_SELECT_FIELD" }> {
  const definition = await client.customFieldDefinition.findFirst({
    where: { id: definitionId, organizationId },
    select: { fieldType: true },
  });
  if (!definition) {
    return { ok: false, reason: "DEFINITION_NOT_FOUND" };
  }
  if (definition.fieldType !== "SELECT") {
    return { ok: false, reason: "NOT_SELECT_FIELD" };
  }
  return { ok: true };
}

/**
 * Every active (non-archived) option for one SELECT definition, ordered
 * by position (Section G). Pass `includeArchived: true` to also see
 * archived options (Section O: an archived option already selected by an
 * existing value must remain visible somewhere, e.g. a future
 * "show archived" view — mirrors ContactsList's own toggle).
 */
export async function listCustomFieldOptions(
  organizationId: string,
  definitionId: string,
  options: { includeArchived?: boolean } = {},
  client: PrismaClientOrTx = prisma,
): Promise<CustomFieldOption[] | { ok: false; reason: "DEFINITION_NOT_FOUND" }> {
  const definition = await client.customFieldDefinition.findFirst({
    where: { id: definitionId, organizationId },
    select: { id: true },
  });
  if (!definition) {
    return { ok: false, reason: "DEFINITION_NOT_FOUND" };
  }

  return client.customFieldOption.findMany({
    where: {
      definitionId,
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Creates a new CustomFieldOption for a SELECT definition. `value`
 * derives from `label` when not explicitly supplied (same "stable
 * machine identity, mutable label" principle as CustomFieldDefinition.key
 * — see renameCustomFieldOption's own comment below), unique per
 * definitionId. `position` is always `current max + 1` within this
 * definition (Section G), never caller-supplied.
 */
export async function createCustomFieldOption(
  organizationId: string,
  definitionId: string,
  input: { label: string; value?: string },
  client: PrismaClientOrTx = prisma,
): Promise<
  | { ok: true; option: CustomFieldOption }
  | { ok: false; reason: "DEFINITION_NOT_FOUND" | "NOT_SELECT_FIELD" | "INVALID_LABEL" | "CONCURRENT_VALUE_CONFLICT" }
> {
  const ownership = await assertSelectDefinitionOwnership(client, organizationId, definitionId);
  if (!ownership.ok) {
    return ownership;
  }

  const label = input.label.trim();
  if (!label) {
    return { ok: false, reason: "INVALID_LABEL" };
  }

  const value = await deriveUniqueCustomFieldOptionValue(definitionId, input.value ?? label, client);

  const runCreate = async (tx: PrismaClientOrTx) => {
    const last = await tx.customFieldOption.findFirst({
      where: { definitionId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const position = (last?.position ?? -1) + 1;

    return tx.customFieldOption.create({
      data: { definitionId, label, value, position },
    });
  };

  try {
    const option = client === prisma ? await prisma.$transaction((tx) => runCreate(tx)) : await runCreate(client);
    return { ok: true, option };
  } catch (err) {
    if (isValueConflict(err)) {
      return { ok: false, reason: "CONCURRENT_VALUE_CONFLICT" };
    }
    throw err;
  }
}

type DriverAdapterMeta = {
  driverAdapterError?: {
    cause?: { constraint?: { fields?: unknown } };
  };
};

/** True only for CustomFieldOption's own (definitionId, value) unique constraint — same detection shape as definitions.ts's own isKeyConflict. */
function isValueConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const fields = (err.meta as DriverAdapterMeta | undefined)?.driverAdapterError?.cause?.constraint?.fields;
  return Array.isArray(fields) && fields.length === 2 && fields[0] === '"definitionId"' && fields[1] === '"value"';
}

/**
 * Renames an option's label only — `value` (its stable machine identity)
 * never changes here or anywhere else once set (Section F's own
 * principle, applied identically to options: "label can change later
 * without breaking values" — an existing CustomFieldValue.selectedOptionId
 * keeps pointing at the same row regardless of what its label now reads).
 */
export async function renameCustomFieldOption(
  organizationId: string,
  definitionId: string,
  optionId: string,
  label: string,
  client: PrismaClientOrTx = prisma,
): Promise<CustomFieldOptionMutationResult | { ok: false; reason: "INVALID_LABEL" }> {
  const ownership = await assertSelectDefinitionOwnership(client, organizationId, definitionId);
  if (!ownership.ok) {
    return ownership;
  }

  const trimmed = label.trim();
  if (!trimmed) {
    return { ok: false, reason: "INVALID_LABEL" };
  }

  const existing = await client.customFieldOption.findFirst({ where: { id: optionId, definitionId } });
  if (!existing) {
    return { ok: false, reason: "OPTION_NOT_FOUND" };
  }

  const option = await client.customFieldOption.update({
    where: { id: optionId },
    data: { label: trimmed },
  });
  return { ok: true, option };
}

/**
 * Soft-archives an option (archivedAt = now()) — never hard-deletes
 * (Section H/O). Idempotent. An option already selected by an existing
 * CustomFieldValue is NOT detached — that value keeps pointing at this
 * now-archived row (Section O: "retain historical value relationship, do
 * not silently clear it"); only createCustomFieldOption/
 * upsertCustomFieldValue's own SELECT validation refuses to let an
 * archived option be newly selected going forward (Section M).
 */
export async function archiveCustomFieldOption(
  organizationId: string,
  definitionId: string,
  optionId: string,
  client: PrismaClientOrTx = prisma,
): Promise<CustomFieldOptionMutationResult> {
  const ownership = await assertSelectDefinitionOwnership(client, organizationId, definitionId);
  if (!ownership.ok) {
    return ownership;
  }

  const existing = await client.customFieldOption.findFirst({ where: { id: optionId, definitionId } });
  if (!existing) {
    return { ok: false, reason: "OPTION_NOT_FOUND" };
  }
  if (existing.archivedAt !== null) {
    return { ok: true, option: existing };
  }

  const option = await client.customFieldOption.update({
    where: { id: optionId },
    data: { archivedAt: new Date() },
  });
  return { ok: true, option };
}

/** Restores an archived option (Section O). Idempotent. Its value/position/existing selections are all exactly as they were — unarchiving is a pure archivedAt flip. */
export async function unarchiveCustomFieldOption(
  organizationId: string,
  definitionId: string,
  optionId: string,
  client: PrismaClientOrTx = prisma,
): Promise<CustomFieldOptionMutationResult> {
  const ownership = await assertSelectDefinitionOwnership(client, organizationId, definitionId);
  if (!ownership.ok) {
    return ownership;
  }

  const existing = await client.customFieldOption.findFirst({ where: { id: optionId, definitionId } });
  if (!existing) {
    return { ok: false, reason: "OPTION_NOT_FOUND" };
  }
  if (existing.archivedAt === null) {
    return { ok: true, option: existing };
  }

  const option = await client.customFieldOption.update({
    where: { id: optionId },
    data: { archivedAt: null },
  });
  return { ok: true, option };
}

/**
 * Custom Fields Phase 2A (Staff UI, Section K) — the same focused,
 * O(1)-write reorder as moveCustomFieldDefinition (see that function's
 * own comment for the full swap/race-safety reasoning), scoped to one
 * definitionId's own active option list instead of an
 * organization+entityType pair.
 */
export async function moveCustomFieldOption(
  organizationId: string,
  definitionId: string,
  optionId: string,
  direction: "up" | "down",
  client: PrismaClientOrTx = prisma,
): Promise<
  | { ok: true }
  | { ok: false; reason: "DEFINITION_NOT_FOUND" | "NOT_SELECT_FIELD" | "OPTION_NOT_FOUND" | "CANNOT_MOVE" }
> {
  const runMove = async (tx: PrismaClientOrTx) => {
    const ownership = await assertSelectDefinitionOwnership(tx, organizationId, definitionId);
    if (!ownership.ok) {
      return ownership;
    }

    const target = await tx.customFieldOption.findFirst({ where: { id: optionId, definitionId, archivedAt: null } });
    if (!target) {
      return { ok: false as const, reason: "OPTION_NOT_FOUND" as const };
    }

    const neighbor = await tx.customFieldOption.findFirst({
      where: {
        definitionId,
        archivedAt: null,
        position: direction === "up" ? { lt: target.position } : { gt: target.position },
      },
      orderBy: { position: direction === "up" ? "desc" : "asc" },
    });
    if (!neighbor) {
      return { ok: false as const, reason: "CANNOT_MOVE" as const };
    }

    await tx.customFieldOption.update({ where: { id: target.id }, data: { position: neighbor.position } });
    await tx.customFieldOption.update({ where: { id: neighbor.id }, data: { position: target.position } });
    return { ok: true as const };
  };

  return client === prisma ? prisma.$transaction((tx) => runMove(tx)) : runMove(client);
}
