import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { CustomFieldEntityType, CustomFieldType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import { listCustomFieldDefinitions } from "./definitions";
import { listCustomFieldOptions } from "./options";
import { listCustomFieldValues, upsertCustomFieldValue, clearCustomFieldValue } from "./values";
import { normalizeTextValue, normalizeNumberValue, normalizeDateValue, normalizeSelectValue } from "./validation";

/**
 * Custom Fields Phase 2B — reusable Client/Lead/Project entity-form
 * integration helpers (Section N). Every piece of this module is called
 * identically by all three entities' create/edit Server Actions — this
 * is the ONE place TEXT/NUMBER/DATE/CHECKBOX/SELECT form-field parsing,
 * required enforcement, and archived-SELECT-option handling live, so
 * none of it is duplicated three times. Deliberately NOT a generic form
 * framework: every function here is specific to "one CustomFieldValue
 * per active definition, submitted as `customField_<definitionId>`" —
 * nothing more abstract than that.
 *
 * Reuses Phase 1's own pure normalizers (validation.ts) and domain
 * mutations (values.ts) throughout rather than re-implementing typed-value
 * logic — this module only adds what Phase 1 deliberately left out:
 * required enforcement, FormData parsing/naming, and archived-option
 * form semantics (Section G/I/J of this phase's own spec).
 */

export type CustomFieldFormOption = { id: string; label: string };

export type CustomFieldFormDefinition = {
  id: string;
  label: string;
  fieldType: CustomFieldType;
  required: boolean;
  /** Active options only, position order — SELECT definitions only, empty array otherwise. Never includes an archived option; see CustomFieldFormValue.selectedOptionArchived for how an entity's own historical archived selection is represented instead. */
  options: CustomFieldFormOption[];
};

/**
 * Every ACTIVE definition for one organization+entityType, in position
 * order, with SELECT definitions' active options resolved (Section B/C:
 * "definitions appear in deterministic position order"; Section H:
 * archived definitions never render in create/edit forms at all — this
 * only ever calls listCustomFieldDefinitions with its own default
 * `includeArchived: false`).
 */
export async function getActiveCustomFieldFormDefinitions(
  organizationId: string,
  entityType: CustomFieldEntityType,
  client: PrismaClientOrTx = prisma,
): Promise<CustomFieldFormDefinition[]> {
  const definitions = await listCustomFieldDefinitions(organizationId, entityType, {}, client);

  return Promise.all(
    definitions.map(async (definition) => {
      let options: CustomFieldFormOption[] = [];
      if (definition.fieldType === "SELECT") {
        const result = await listCustomFieldOptions(organizationId, definition.id, {}, client);
        options = Array.isArray(result) ? result.map((o) => ({ id: o.id, label: o.label })) : [];
      }
      return {
        id: definition.id,
        label: definition.label,
        fieldType: definition.fieldType,
        required: definition.required,
        options,
      };
    }),
  );
}

export type CustomFieldFormValue = {
  textValue: string | null;
  numberValue: string | null;
  dateValue: string | null;
  booleanValue: boolean | null;
  selectedOptionId: string | null;
  /**
   * Resolved even when the selected option is archived (Section I: "show
   * the currently selected archived option, visibly mark it") — looked
   * up directly by id when it isn't among the definition's own active
   * options list.
   */
  selectedOptionLabel: string | null;
  selectedOptionArchived: boolean;
};

/**
 * The entity's current values for exactly the given (already-active)
 * definitions, keyed by definitionId — used to prefill an edit form.
 * `entityId` must already have been ownership-verified by the caller
 * (every edit page in this app already re-verifies id+organizationId
 * before rendering); this is a read scoped by organizationId+entityId,
 * matching listCustomFieldValues's own contract.
 */
export async function getCustomFieldFormValues(
  organizationId: string,
  entityType: CustomFieldEntityType,
  entityId: string,
  definitions: CustomFieldFormDefinition[],
  client: PrismaClientOrTx = prisma,
): Promise<Map<string, CustomFieldFormValue>> {
  const result = await listCustomFieldValues(organizationId, entityType, entityId, client);
  const map = new Map<string, CustomFieldFormValue>();
  if (!result.ok) {
    return map;
  }

  for (const value of result.values) {
    const definition = definitions.find((d) => d.id === value.definitionId);
    let selectedOptionLabel: string | null = null;
    let selectedOptionArchived = false;

    if (definition?.fieldType === "SELECT" && value.selectedOptionId) {
      const activeOption = definition.options.find((o) => o.id === value.selectedOptionId);
      if (activeOption) {
        selectedOptionLabel = activeOption.label;
      } else {
        // Not among the active options — either archived, or (never in
        // practice, since options are never hard-deleted per Phase 1)
        // gone entirely. Resolved directly so the edit form can show
        // "Label (archived)" rather than a bare, unlabeled id.
        const archivedOption = await client.customFieldOption.findUnique({
          where: { id: value.selectedOptionId },
          select: { label: true, archivedAt: true },
        });
        selectedOptionLabel = archivedOption?.label ?? null;
        selectedOptionArchived = archivedOption?.archivedAt != null;
      }
    }

    map.set(value.definitionId, {
      textValue: value.textValue,
      numberValue: value.numberValue !== null ? value.numberValue.toString() : null,
      // Date-only semantics (Section C) — sliced to YYYY-MM-DD from the
      // stored UTC-midnight timestamp, matching normalizeDateValue's own
      // storage convention, so an <input type="date"> round-trips with
      // no timezone shift.
      dateValue: value.dateValue ? value.dateValue.toISOString().slice(0, 10) : null,
      booleanValue: value.booleanValue,
      selectedOptionId: value.selectedOptionId,
      selectedOptionLabel,
      selectedOptionArchived,
    });
  }

  return map;
}

/**
 * Extracts exactly the `customField_<definitionId>` FormData entries for
 * the given (already-DB-loaded) active definitions — Section J: "never
 * trust arbitrary FormData names." A crafted `customField_<foreign-or-
 * hidden-definition-id>` field is simply never read, because the key it
 * would need to match never appears in `definitions` (which was loaded
 * fresh from the database, scoped to this organization+entityType, by
 * the caller). Returns `null` for any definition the FormData genuinely
 * has no entry for.
 */
export function parseCustomFieldFormValues(
  formData: FormData,
  definitions: CustomFieldFormDefinition[],
): Map<string, FormDataEntryValue | null> {
  const map = new Map<string, FormDataEntryValue | null>();
  for (const definition of definitions) {
    map.set(definition.id, formData.get(`customField_${definition.id}`));
  }
  return map;
}

type FieldDecision = { ok: true; action: "set" | "clear" | "skip" } | { ok: false; error: string };

/**
 * The one place every field-type's required-enforcement rule lives
 * (Section G), and the one place the archived-SELECT-option "unchanged
 * stays valid" rule lives (Section I). Returns which of set/clear/skip
 * this field needs — "skip" means don't touch the CustomFieldValue row
 * at all (either it was never set and remains empty, or — SELECT only —
 * the submitted value is byte-identical to what's already stored, which
 * matters specifically because re-submitting an unchanged *archived*
 * selectedOptionId would otherwise be rejected by upsertCustomFieldValue's
 * own "an archived option can never be newly selected" rule).
 */
function decideCustomFieldValue(
  definition: CustomFieldFormDefinition,
  raw: FormDataEntryValue | null,
  existing: CustomFieldFormValue | undefined,
): FieldDecision {
  const hadValue =
    existing !== undefined &&
    (existing.textValue !== null ||
      existing.numberValue !== null ||
      existing.dateValue !== null ||
      existing.booleanValue !== null ||
      existing.selectedOptionId !== null);

  switch (definition.fieldType) {
    case "TEXT": {
      const result = normalizeTextValue(typeof raw === "string" ? raw : null);
      if (!result.ok) return { ok: false, error: result.error };
      if (result.value === null) {
        if (definition.required) return { ok: false, error: "This field is required." };
        return { ok: true, action: hadValue ? "clear" : "skip" };
      }
      return { ok: true, action: "set" };
    }
    case "NUMBER": {
      const result = normalizeNumberValue(typeof raw === "string" ? raw : null);
      if (!result.ok) return { ok: false, error: result.error };
      if (result.value === null) {
        if (definition.required) return { ok: false, error: "This field is required." };
        return { ok: true, action: hadValue ? "clear" : "skip" };
      }
      // Zero is a valid, present value (Section G) — normalizeNumberValue
      // already returns 0 here, never null, so this branch is reached and
      // treated as "set" exactly like any other real number.
      return { ok: true, action: "set" };
    }
    case "DATE": {
      const result = normalizeDateValue(typeof raw === "string" ? raw : null);
      if (!result.ok) return { ok: false, error: result.error };
      if (result.value === null) {
        if (definition.required) return { ok: false, error: "This field is required." };
        return { ok: true, action: hadValue ? "clear" : "skip" };
      }
      return { ok: true, action: "set" };
    }
    case "CHECKBOX": {
      // A native checkbox has no "empty" state at all — checked submits
      // "on", unchecked submits nothing. Both are fully determinate
      // answers, never an absence, so CHECKBOX's own required rule can
      // never actually reject a real submission (Section G: "do NOT
      // interpret required checkbox as 'must be checked'" — both true
      // and false are always valid once required).
      const checked = raw === "on";
      if (definition.required) {
        // Required — always persists the explicit boolean, true or
        // false, never clears: "false is a legitimate explicit answer,"
        // so an org that requires this field wants a real value stored
        // either way, not silence.
        return { ok: true, action: "set" };
      }
      // Optional — unchecked is indistinguishable from "never touched"
      // via a plain checkbox, so it's treated as "no explicit value"
      // (clear), matching every other optional-checkbox convention
      // already in this app (e.g. isBilling, ClientContact).
      return { ok: true, action: checked ? "set" : hadValue ? "clear" : "skip" };
    }
    case "SELECT": {
      const result = normalizeSelectValue(typeof raw === "string" ? raw : null);
      if (!result.ok) return { ok: false, error: result.error };
      const submitted = result.value;
      const existingOptionId = existing?.selectedOptionId ?? null;

      if (submitted === null) {
        if (definition.required) return { ok: false, error: "This field is required." };
        return { ok: true, action: existingOptionId ? "clear" : "skip" };
      }

      if (submitted === existingOptionId) {
        // Unchanged — including an existing selection that has since
        // become archived (Section I: "keeping the current historical
        // value unchanged" must always succeed, required or not). Never
        // re-validated against the active-options list, and never
        // re-written — upsertCustomFieldValue would otherwise reject a
        // resubmitted archived id via its own "archived option can never
        // be newly selected" rule, which must not apply to a value that
        // was never actually changed.
        return { ok: true, action: "skip" };
      }

      // A genuinely new/changed selection — must be one of the
      // definition's own ACTIVE options (Section I: an archived option
      // is never offered as a new choice; Section K: must belong to this
      // definition). upsertCustomFieldValue re-verifies this same fact
      // independently at write time — this is the pre-check that
      // produces a field-level error instead of a raw domain rejection.
      if (!definition.options.some((o) => o.id === submitted)) {
        return { ok: false, error: "Select a valid option." };
      }
      return { ok: true, action: "set" };
    }
    default: {
      const exhaustiveCheck: never = definition.fieldType;
      throw new Error(`decideCustomFieldValue: unhandled fieldType ${String(exhaustiveCheck)}`);
    }
  }
}

export type CustomFieldFormFieldErrors = Record<string, string>;

/**
 * Validates every active definition's submitted raw value — pure,
 * read-only (definitions/existingValues are already-loaded data, no new
 * DB access here). Returns either every field's persistence decision
 * (still unwritten) or a definitionId-keyed error map. Called BEFORE any
 * entity create/update write (Section E/F/L/M: "do not create/partially
 * update the entity if custom field validation fails").
 */
export function validateCustomFieldFormValues(
  definitions: CustomFieldFormDefinition[],
  rawValues: Map<string, FormDataEntryValue | null>,
  existingValues: Map<string, CustomFieldFormValue> = new Map(),
): { ok: true; decisions: Map<string, "set" | "clear" | "skip"> } | { ok: false; fieldErrors: CustomFieldFormFieldErrors } {
  const decisions = new Map<string, "set" | "clear" | "skip">();
  const fieldErrors: CustomFieldFormFieldErrors = {};

  for (const definition of definitions) {
    const raw = rawValues.get(definition.id) ?? null;
    const existing = existingValues.get(definition.id);
    const decision = decideCustomFieldValue(definition, raw, existing);
    if (!decision.ok) {
      fieldErrors[definition.id] = decision.error;
      continue;
    }
    decisions.set(definition.id, decision.action);
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return { ok: true, decisions };
}

/**
 * Writes every decided field inside the caller's own already-open
 * transaction (Section E/F/N: "create/update entity + values in one
 * Prisma transaction"). Must be called only after
 * validateCustomFieldFormValues returned `ok: true` for these exact
 * definitions/rawValues — every write here delegates to Phase 1's own
 * upsertCustomFieldValue/clearCustomFieldValue (never reimplemented),
 * which independently re-verify org/entity/definition ownership at
 * write time regardless of this module's own pre-checks (defense in
 * depth, the same discipline every other domain call in this app
 * already follows).
 */
export async function persistCustomFieldValuesInTransaction(
  tx: Prisma.TransactionClient,
  {
    organizationId,
    entityType,
    entityId,
    definitions,
    rawValues,
    decisions,
  }: {
    organizationId: string;
    entityType: CustomFieldEntityType;
    entityId: string;
    definitions: CustomFieldFormDefinition[];
    rawValues: Map<string, FormDataEntryValue | null>;
    decisions: Map<string, "set" | "clear" | "skip">;
  },
): Promise<void> {
  for (const definition of definitions) {
    const action = decisions.get(definition.id);
    if (!action || action === "skip") continue;

    if (action === "clear") {
      await clearCustomFieldValue(organizationId, entityType, entityId, definition.id, tx);
      continue;
    }

    const raw = rawValues.get(definition.id) ?? null;
    const rawForUpsert = definition.fieldType === "CHECKBOX" ? raw === "on" : raw;
    const result = await upsertCustomFieldValue(organizationId, entityType, entityId, definition.id, rawForUpsert, tx);
    if (!result.ok) {
      // Should be unreachable — validateCustomFieldFormValues already
      // confirmed this exact write will succeed. Surfaced loudly rather
      // than silently swallowed, so a genuine race (e.g. the option was
      // archived by a concurrent request between validation and this
      // write) rolls back the whole transaction instead of committing a
      // half-written entity.
      throw new Error(`Unexpected custom field write failure for definition ${definition.id}: ${result.reason}`);
    }
  }
}
