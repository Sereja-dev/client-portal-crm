import "server-only";
import type { CustomFieldDefinition, CustomStatusDefinition } from "@/generated/prisma/client";
import type { CustomFieldEntityType, CustomStatusEntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import { assertStatusDefinitionOwnership } from "@/lib/custom-statuses/resolution";
import {
  normalizeTextValue,
  normalizeNumberValue,
  normalizeDateValue,
  normalizeCheckboxValue,
  normalizeSelectValue,
} from "@/lib/custom-fields/validation";

/**
 * Workflow Automations Phase 1 — the one place a Custom Status/Custom
 * Field reference embedded in automation `conditions`/`actions` JSON is
 * ever checked against the database. Never trusts organizationId,
 * entityType, or archival state from the caller-supplied configuration
 * itself — every check re-derives them from a fresh, organization-scoped
 * database read (Section K's own "a foreign-org id is indistinguishable
 * from a nonexistent one" doctrine, applied identically here).
 *
 * Reuses this codebase's own existing tenant-isolation helpers rather
 * than duplicating that logic: assertStatusDefinitionOwnership
 * (src/lib/custom-statuses/resolution.ts) for Custom Statuses, and the
 * same `findFirst({ id, organizationId, entityType })` shape that
 * function and src/lib/custom-fields/values.ts's own (unexported)
 * findOwnedDefinition already establish for Custom Fields (no exported
 * single-definition getter exists there yet — only listCustomFieldDefinitions —
 * so this module adds the smallest possible equivalent, in the same
 * established shape, rather than either duplicating a private helper or
 * exporting one solely for this caller).
 */

export type CustomStatusReferenceResult =
  | { ok: true; definition: CustomStatusDefinition }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "ARCHIVED" };

/**
 * Validates a CustomStatusDefinition reference for a *future* action
 * (never yet executed) — organization, entity type, and non-archived are
 * all required. An archived definition can never be newly selected here,
 * matching this codebase's existing "archived means retired, not merely
 * hidden" convention (CustomStatusDefinition.archivedAt's own doc
 * comment); it remains a valid *historical* reference on an
 * already-existing action, but this function is only ever called at
 * config-write time, when every action reference is by definition new.
 */
export async function validateCustomStatusReference(
  organizationId: string,
  entityType: CustomStatusEntityType,
  definitionId: string,
  client: PrismaClientOrTx = prisma,
): Promise<CustomStatusReferenceResult> {
  const definition = await assertStatusDefinitionOwnership({ organizationId, entityType, definitionId }, client);
  if (!definition) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (definition.archivedAt !== null) {
    return { ok: false, reason: "ARCHIVED" };
  }
  return { ok: true, definition };
}

export type CustomFieldReferenceResult =
  | { ok: true; definition: CustomFieldDefinition }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "ARCHIVED" };

/** Same organization+entityType-scoped shape as validateCustomStatusReference above, for CustomFieldDefinition. */
export async function validateCustomFieldReference(
  organizationId: string,
  entityType: CustomFieldEntityType,
  definitionId: string,
  client: PrismaClientOrTx = prisma,
): Promise<CustomFieldReferenceResult> {
  const definition = await client.customFieldDefinition.findFirst({
    where: { id: definitionId, organizationId, entityType },
  });
  if (!definition) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (definition.archivedAt !== null) {
    return { ok: false, reason: "ARCHIVED" };
  }
  return { ok: true, definition };
}

export type CustomFieldValueCompatibilityResult =
  | { ok: true; normalizedValue: string | number | boolean }
  | { ok: false; error: string };

/**
 * Checks a proposed action value against the target CustomFieldDefinition's
 * own fieldType, reusing this codebase's existing pure per-type
 * normalizers (src/lib/custom-fields/validation.ts) for TEXT/NUMBER/DATE/
 * CHECKBOX exactly as upsertCustomFieldValue itself does. SELECT is the
 * one type that needs a database read (the option must belong to this
 * exact definition and not be archived) — same rule upsertCustomFieldValue
 * enforces, re-implemented here read-only since Phase 1 never writes a
 * CustomFieldValue row.
 *
 * A `null`/empty-clearing value (valid for a live upsert) is deliberately
 * rejected here — "clear this field" is a different action semantic this
 * phase does not define; every V1 SET_CUSTOM_FIELD_VALUE action must
 * carry a real, present value.
 */
export async function checkCustomFieldValueCompatibility(
  definition: CustomFieldDefinition,
  rawValue: unknown,
  client: PrismaClientOrTx = prisma,
): Promise<CustomFieldValueCompatibilityResult> {
  switch (definition.fieldType) {
    case "TEXT": {
      const result = normalizeTextValue(rawValue);
      if (!result.ok) return { ok: false, error: result.error };
      if (result.value === null) return { ok: false, error: "value must not be empty." };
      return { ok: true, normalizedValue: result.value };
    }
    case "NUMBER": {
      const result = normalizeNumberValue(rawValue);
      if (!result.ok) return { ok: false, error: result.error };
      if (result.value === null) return { ok: false, error: "value must not be empty." };
      return { ok: true, normalizedValue: result.value };
    }
    case "DATE": {
      const result = normalizeDateValue(rawValue);
      if (!result.ok) return { ok: false, error: result.error };
      if (result.value === null) return { ok: false, error: "value must not be empty." };
      return { ok: true, normalizedValue: result.value.toISOString() };
    }
    case "CHECKBOX": {
      const result = normalizeCheckboxValue(rawValue);
      if (!result.ok) return { ok: false, error: result.error };
      if (result.value === null) return { ok: false, error: "value must not be empty." };
      return { ok: true, normalizedValue: result.value };
    }
    case "SELECT": {
      const result = normalizeSelectValue(rawValue);
      if (!result.ok) return { ok: false, error: result.error };
      if (result.value === null) return { ok: false, error: "value must not be empty." };
      const option = await client.customFieldOption.findFirst({
        where: { id: result.value, definitionId: definition.id },
      });
      if (!option) {
        return { ok: false, error: "value must be a valid option id for this field." };
      }
      if (option.archivedAt !== null) {
        return { ok: false, error: "this option is archived and cannot be newly selected." };
      }
      return { ok: true, normalizedValue: option.id };
    }
    default: {
      const exhaustiveCheck: never = definition.fieldType;
      throw new Error(`checkCustomFieldValueCompatibility: unhandled fieldType ${String(exhaustiveCheck)}`);
    }
  }
}
