import "server-only";
import type { Prisma, CustomFieldValue } from "@/generated/prisma/client";
import type { CustomFieldEntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import { assertCustomFieldEntityOwnership } from "./entity-ownership";
import {
  normalizeTextValue,
  normalizeNumberValue,
  normalizeDateValue,
  normalizeCheckboxValue,
  normalizeSelectValue,
} from "./validation";

/**
 * Custom Fields Phase 1 — Value domain layer (Section J/K/M/N). Every
 * mutation here re-fetches the definition by organizationId, validates
 * the target entity exists in the same organization, and validates
 * entityType matches definition.entityType — never trusting a
 * caller-provided organization/entity-type/entity relationship (Section
 * K). A foreign-org id is indistinguishable from a nonexistent one.
 */

export type CustomFieldValueMutationResult =
  | { ok: true; value: CustomFieldValue | null } // null = value cleared / never set
  | { ok: false; reason: "DEFINITION_NOT_FOUND" | "ENTITY_NOT_FOUND" }
  | { ok: false; reason: "INVALID_VALUE"; error: string }
  | { ok: false; reason: "OPTION_NOT_FOUND" | "ARCHIVED_OPTION" };

/** Every definition+entityType pair together — never trusts either alone (Section K). Returns null if not found or if entityType doesn't match. */
async function findOwnedDefinition(
  client: PrismaClientOrTx,
  organizationId: string,
  entityType: CustomFieldEntityType,
  definitionId: string,
) {
  return client.customFieldDefinition.findFirst({
    where: { id: definitionId, organizationId, entityType },
  });
}

/**
 * Every CustomFieldValue row for one entity instance. Verifies the
 * entity itself exists in this organization before reading (Section K) —
 * a foreign-org or nonexistent entityId returns ENTITY_NOT_FOUND rather
 * than a silently-empty list, so a caller can distinguish "no custom
 * field values yet" from "you don't have access to this entity."
 */
export async function listCustomFieldValues(
  organizationId: string,
  entityType: CustomFieldEntityType,
  entityId: string,
  client: PrismaClientOrTx = prisma,
): Promise<{ ok: true; values: CustomFieldValue[] } | { ok: false; reason: "ENTITY_NOT_FOUND" }> {
  const owned = await assertCustomFieldEntityOwnership({ organizationId, entityType, entityId }, client);
  if (!owned) {
    return { ok: false, reason: "ENTITY_NOT_FOUND" };
  }

  const values = await client.customFieldValue.findMany({
    where: { organizationId, entityId },
  });
  return { ok: true, values };
}

/**
 * Creates, updates, or clears one entity's value for one definition
 * (Section J: at most one CustomFieldValue per definitionId+entityId,
 * DB-enforced by the unique index). Normalizes `rawValue` according to
 * `definition.fieldType` (Section M); a normalized result of `null`
 * (an intentionally empty TEXT, or an absent NUMBER/DATE/CHECKBOX/SELECT)
 * clears the value — deletes the row entirely rather than writing a
 * meaningless all-null row (Section M/N), consistent with the CHECK
 * constraint added in this feature's own migration.
 *
 * SELECT gets one extra DB-dependent check beyond validation.ts's own
 * pure format check: the selected option must belong to THIS definition,
 * and an archived option can never be newly selected (Section M/O) — an
 * option already selected before it was archived is left untouched by
 * this rule; it's only a fresh selection of an archived option that's
 * refused.
 */
export async function upsertCustomFieldValue(
  organizationId: string,
  entityType: CustomFieldEntityType,
  entityId: string,
  definitionId: string,
  rawValue: unknown,
  client: PrismaClientOrTx = prisma,
): Promise<CustomFieldValueMutationResult> {
  const definition = await findOwnedDefinition(client, organizationId, entityType, definitionId);
  if (!definition) {
    return { ok: false, reason: "DEFINITION_NOT_FOUND" };
  }

  const owned = await assertCustomFieldEntityOwnership({ organizationId, entityType, entityId }, client);
  if (!owned) {
    return { ok: false, reason: "ENTITY_NOT_FOUND" };
  }

  const columns: {
    textValue: string | null;
    numberValue: number | null;
    dateValue: Date | null;
    booleanValue: boolean | null;
    selectedOptionId: string | null;
  } = {
    textValue: null,
    numberValue: null,
    dateValue: null,
    booleanValue: null,
    selectedOptionId: null,
  };
  let isClear = false;

  switch (definition.fieldType) {
    case "TEXT": {
      const result = normalizeTextValue(rawValue);
      if (!result.ok) return { ok: false, reason: "INVALID_VALUE", error: result.error };
      if (result.value === null) isClear = true;
      else columns.textValue = result.value;
      break;
    }
    case "NUMBER": {
      const result = normalizeNumberValue(rawValue);
      if (!result.ok) return { ok: false, reason: "INVALID_VALUE", error: result.error };
      if (result.value === null) isClear = true;
      else columns.numberValue = result.value;
      break;
    }
    case "DATE": {
      const result = normalizeDateValue(rawValue);
      if (!result.ok) return { ok: false, reason: "INVALID_VALUE", error: result.error };
      if (result.value === null) isClear = true;
      else columns.dateValue = result.value;
      break;
    }
    case "CHECKBOX": {
      const result = normalizeCheckboxValue(rawValue);
      if (!result.ok) return { ok: false, reason: "INVALID_VALUE", error: result.error };
      if (result.value === null) isClear = true;
      else columns.booleanValue = result.value;
      break;
    }
    case "SELECT": {
      const result = normalizeSelectValue(rawValue);
      if (!result.ok) return { ok: false, reason: "INVALID_VALUE", error: result.error };
      if (result.value === null) {
        isClear = true;
      } else {
        const option = await client.customFieldOption.findFirst({
          where: { id: result.value, definitionId },
        });
        if (!option) {
          return { ok: false, reason: "OPTION_NOT_FOUND" };
        }
        if (option.archivedAt !== null) {
          return { ok: false, reason: "ARCHIVED_OPTION" };
        }
        columns.selectedOptionId = option.id;
      }
      break;
    }
    default: {
      const exhaustiveCheck: never = definition.fieldType;
      throw new Error(`upsertCustomFieldValue: unhandled fieldType ${String(exhaustiveCheck)}`);
    }
  }

  if (isClear) {
    await client.customFieldValue.deleteMany({ where: { organizationId, definitionId, entityId } });
    return { ok: true, value: null };
  }

  const value = await client.customFieldValue.upsert({
    where: { definitionId_entityId: { definitionId, entityId } },
    create: { organizationId, definitionId, entityId, ...columns },
    update: { ...columns },
  });
  return { ok: true, value };
}

/**
 * Explicit clear (Section M/K) — deletes this entity's CustomFieldValue
 * row for this definition, if any. Idempotent: clearing an entity that
 * already has no value for this definition is a no-op success, not an
 * error. Re-verifies definition+entityType and entity ownership exactly
 * like upsertCustomFieldValue, even though the delete itself is already
 * scoped by organizationId — defense in depth, and so a caller gets the
 * same DEFINITION_NOT_FOUND/ENTITY_NOT_FOUND distinction either function
 * would give for a bad id.
 */
export async function clearCustomFieldValue(
  organizationId: string,
  entityType: CustomFieldEntityType,
  entityId: string,
  definitionId: string,
  client: PrismaClientOrTx = prisma,
): Promise<{ ok: true } | { ok: false; reason: "DEFINITION_NOT_FOUND" | "ENTITY_NOT_FOUND" }> {
  const definition = await findOwnedDefinition(client, organizationId, entityType, definitionId);
  if (!definition) {
    return { ok: false, reason: "DEFINITION_NOT_FOUND" };
  }

  const owned = await assertCustomFieldEntityOwnership({ organizationId, entityType, entityId }, client);
  if (!owned) {
    return { ok: false, reason: "ENTITY_NOT_FOUND" };
  }

  await client.customFieldValue.deleteMany({ where: { organizationId, definitionId, entityId } });
  return { ok: true };
}

/**
 * Delete-cleanup helper (Section P) — the direct structural analog of
 * deleteAttachmentsForParent (src/lib/attachments/attachment-mutations.ts),
 * simplified for this table: no external Storage object and no per-row
 * Activity requirement (Section R — no Activity schema/behavior churn in
 * Phase 1), so a single deleteMany with an OR-by-entityId list suffices
 * instead of Attachments' own per-row loop.
 *
 * Must be called from inside the caller's own transaction, alongside the
 * parent entity's own delete, so a failure anywhere rolls everything
 * back together — see deleteClientAction/deleteProjectAction's own
 * wiring. `entityIds` deliberately has no accompanying entityType:
 * CustomFieldValue never stores entityType on its own row (only its
 * parent CustomFieldDefinition does — see that model's own schema
 * comment), so a plain organizationId + entityId-in-list filter is both
 * sufficient and exactly as precise as the schema itself is.
 */
export async function deleteCustomFieldValuesForEntities(
  tx: Prisma.TransactionClient,
  { organizationId, entityIds }: { organizationId: string; entityIds: string[] },
): Promise<void> {
  if (entityIds.length === 0) return;

  await tx.customFieldValue.deleteMany({
    where: { organizationId, entityId: { in: entityIds } },
  });
}
