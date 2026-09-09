import { CustomFieldType } from "@/generated/prisma/enums";
import type { CustomFieldType as CustomFieldTypeValue } from "@/generated/prisma/enums";

/**
 * Custom Fields Phase 2A (Staff UI). Mirrors src/lib/validation/
 * client-contact.ts's own conventions exactly: the same trim-then-check
 * shape, the same bounded max-length-per-field discipline. FormData
 * parsing only — the Custom Fields *value* typed-column validation
 * (TEXT/NUMBER/DATE/CHECKBOX/SELECT normalization) already lives in
 * src/lib/custom-fields/validation.ts and is untouched by this file,
 * which only ever validates a Definition's or Option's own *label* and
 * *fieldType*, never a value.
 */

// A definition/option label is a short field name ("Account Manager",
// "Priority"), not a freeform note — capped the same order of magnitude
// as CONTACT_ROLE_MAX_LENGTH's own "short descriptor" cap.
export const CUSTOM_FIELD_LABEL_MAX_LENGTH = 100;

export const CUSTOM_FIELD_TYPES = Object.values(CustomFieldType);

export type CustomFieldDefinitionFieldErrors = Partial<Record<"label" | "fieldType", string>>;
export type CustomFieldOptionFieldErrors = Partial<Record<"label", string>>;

function isValidFieldType(value: unknown): value is CustomFieldTypeValue {
  return typeof value === "string" && (CUSTOM_FIELD_TYPES as readonly string[]).includes(value);
}

/**
 * createDefinitionAction's own form parser. `fieldType` is required here
 * (Section G: "Field type REQUIRED") and only ever read on CREATE —
 * updateDefinitionAction never parses a fieldType at all (see that
 * action's own comment for why: fieldType is immutable after creation).
 */
export function parseCustomFieldDefinitionCreateForm(formData: FormData): {
  values: { label: string; fieldType: CustomFieldTypeValue | null; required: boolean };
  fieldErrors: CustomFieldDefinitionFieldErrors;
} {
  const label = String(formData.get("label") ?? "").trim();
  const fieldTypeRaw = formData.get("fieldType");
  const required = formData.get("required") === "on";

  const fieldErrors: CustomFieldDefinitionFieldErrors = {};

  if (!label) {
    fieldErrors.label = "Label is required.";
  } else if (label.length > CUSTOM_FIELD_LABEL_MAX_LENGTH) {
    fieldErrors.label = `Must be ${CUSTOM_FIELD_LABEL_MAX_LENGTH} characters or fewer.`;
  }

  let fieldType: CustomFieldTypeValue | null = null;
  if (!isValidFieldType(fieldTypeRaw)) {
    fieldErrors.fieldType = "Select a field type.";
  } else {
    fieldType = fieldTypeRaw;
  }

  return { values: { label, fieldType, required }, fieldErrors };
}

/**
 * updateDefinitionAction's own form parser — label/required only.
 * Deliberately has no fieldType parsing at all: even a crafted form
 * field named "fieldType" is never read here, so there is no code path
 * through this parser that could ever reach updateCustomFieldDefinition
 * with a type change (Section Q/G).
 */
export function parseCustomFieldDefinitionUpdateForm(formData: FormData): {
  values: { label: string; required: boolean };
  fieldErrors: CustomFieldDefinitionFieldErrors;
} {
  const label = String(formData.get("label") ?? "").trim();
  const required = formData.get("required") === "on";

  const fieldErrors: CustomFieldDefinitionFieldErrors = {};
  if (!label) {
    fieldErrors.label = "Label is required.";
  } else if (label.length > CUSTOM_FIELD_LABEL_MAX_LENGTH) {
    fieldErrors.label = `Must be ${CUSTOM_FIELD_LABEL_MAX_LENGTH} characters or fewer.`;
  }

  return { values: { label, required }, fieldErrors };
}

/** Every non-empty `optionLabel` field in the Create dialog's dynamic SELECT-option list, in DOM/submission order — trimmed, blanks dropped. Order here becomes each option's initial position (Phase 1's createCustomFieldOption assigns position = current max + 1 in call order). */
export function parseCustomFieldOptionLabels(formData: FormData): string[] {
  return formData
    .getAll("optionLabel")
    .map((raw) => String(raw).trim())
    .filter((label) => label.length > 0 && label.length <= CUSTOM_FIELD_LABEL_MAX_LENGTH);
}

/** Shared by both createOptionAction (Edit dialog's own "Add option" row) and updateOptionAction (rename). */
export function parseCustomFieldOptionForm(formData: FormData): {
  values: { label: string };
  fieldErrors: CustomFieldOptionFieldErrors;
} {
  const label = String(formData.get("label") ?? "").trim();

  const fieldErrors: CustomFieldOptionFieldErrors = {};
  if (!label) {
    fieldErrors.label = "Label is required.";
  } else if (label.length > CUSTOM_FIELD_LABEL_MAX_LENGTH) {
    fieldErrors.label = `Must be ${CUSTOM_FIELD_LABEL_MAX_LENGTH} characters or fewer.`;
  }

  return { values: { label }, fieldErrors };
}

/** Human-readable labels for CustomFieldType — used everywhere a field type is shown or selected in the UI, never the raw enum value. */
export const FIELD_TYPE_LABELS: Record<CustomFieldTypeValue, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  DATE: "Date",
  CHECKBOX: "Checkbox",
  SELECT: "Select",
};
