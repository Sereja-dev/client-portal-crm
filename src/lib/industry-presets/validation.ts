import {
  INDUSTRY_PRESET_CATALOG,
  INDUSTRY_PRESET_KEYS,
  listIndustryPresets,
  type IndustryPresetDefinition,
} from "./catalog";

/**
 * Industry Presets V1 — catalog validation (locked spec §16). Pure,
 * dependency-free checks over the compile-time catalog constant itself;
 * no database, no runtime validation package (locked spec: "do not add a
 * runtime validation package merely for this" — compile-time typing plus
 * these small helpers is the whole strategy). test/unit/industry-presets/
 * catalog.test.ts asserts `validateIndustryPresetCatalog()` returns an
 * empty array — the one place every rule below is actually exercised.
 */

const ALLOWED_ENTITY_TYPES = new Set(["CLIENT", "LEAD", "PROJECT"]);

function checkPreset(preset: IndustryPresetDefinition, errors: string[]): void {
  const prefix = `[${preset.key}]`;

  if (!Number.isInteger(preset.version) || preset.version <= 0) {
    errors.push(`${prefix} version must be a positive integer, got ${String(preset.version)}`);
  }

  // Status keys unique within the same entityType (cross-entityType reuse
  // of a key string is fine -- CustomStatusDefinition's own real DB
  // constraint is (organizationId, entityType, key), never a bare key).
  const statusKeysByEntity = new Map<string, Set<string>>();
  for (const status of preset.statuses) {
    if (!ALLOWED_ENTITY_TYPES.has(status.entityType)) {
      errors.push(`${prefix} status "${status.key}" has disallowed entityType "${status.entityType}"`);
    }
    const set = statusKeysByEntity.get(status.entityType) ?? new Set<string>();
    if (set.has(status.key)) {
      errors.push(`${prefix} duplicate status key "${status.key}" for entityType ${status.entityType}`);
    }
    set.add(status.key);
    statusKeysByEntity.set(status.entityType, set);
  }

  // Field keys unique within the same entityType, same rule as statuses.
  const fieldKeysByEntity = new Map<string, Set<string>>();
  for (const field of preset.fields) {
    if (!ALLOWED_ENTITY_TYPES.has(field.entityType)) {
      errors.push(`${prefix} field "${field.key}" has disallowed entityType "${field.entityType}"`);
    }
    const set = fieldKeysByEntity.get(field.entityType) ?? new Set<string>();
    if (set.has(field.key)) {
      errors.push(`${prefix} duplicate field key "${field.key}" for entityType ${field.entityType}`);
    }
    set.add(field.key);
    fieldKeysByEntity.set(field.entityType, set);

    if (field.required !== false) {
      errors.push(`${prefix} field "${field.key}" must be required: false`);
    }

    if (field.fieldType === "SELECT") {
      if (!field.options || field.options.length === 0) {
        errors.push(`${prefix} SELECT field "${field.key}" must declare at least one option`);
      } else {
        const labels = new Set<string>();
        const values = new Set<string>();
        for (const option of field.options) {
          if (!option.label.trim()) {
            errors.push(`${prefix} field "${field.key}" has an empty option label`);
          }
          if (!option.value.trim()) {
            errors.push(`${prefix} field "${field.key}" has an empty option value`);
          }
          if (labels.has(option.label)) {
            errors.push(`${prefix} field "${field.key}" has a duplicate option label "${option.label}"`);
          }
          if (values.has(option.value)) {
            errors.push(`${prefix} field "${field.key}" has a duplicate option value "${option.value}"`);
          }
          labels.add(option.label);
          values.add(option.value);
        }
      }
    } else if (field.options && field.options.length > 0) {
      errors.push(`${prefix} non-SELECT field "${field.key}" (${field.fieldType}) must not declare options`);
    }
  }

  // Tag normalized names unique within the preset -- same trim+lowercase
  // rule the real Tag domain uses (src/lib/tags/normalize.ts), checked
  // here without importing that "server-only" module into this plain,
  // isomorphic validation file.
  const normalizedTagNames = new Set<string>();
  for (const tag of preset.tags) {
    const normalized = tag.name.trim().toLowerCase();
    if (!normalized) {
      errors.push(`${prefix} tag has an empty name`);
    }
    if (normalizedTagNames.has(normalized)) {
      errors.push(`${prefix} duplicate tag (normalized) name "${normalized}"`);
    }
    normalizedTagNames.add(normalized);
  }
}

/**
 * Returns every rule violation found in the catalog, or an empty array
 * when the catalog is fully valid. Checks (locked spec §16):
 *  - exactly the four locked preset keys exist
 *  - preset keys unique (guaranteed by the Record type itself, checked
 *    defensively anyway in case a future edit ever widens the type)
 *  - every preset version is a positive integer
 *  - status keys unique within the same preset+entityType
 *  - custom-field keys unique within the same preset+entityType
 *  - tag normalized names unique within a preset
 *  - SELECT fields have non-empty, unique-label, unique-value options
 *  - non-SELECT fields carry no options
 *  - every custom field is required: false
 *  - only CLIENT/LEAD/PROJECT entity types appear anywhere
 */
export function validateIndustryPresetCatalog(): string[] {
  const errors: string[] = [];

  const expectedKeys = ["freelancer", "creative_agency", "marketing_agency", "general_services"];
  const actualKeys = Object.keys(INDUSTRY_PRESET_CATALOG);
  if (actualKeys.length !== expectedKeys.length || !expectedKeys.every((k) => actualKeys.includes(k))) {
    errors.push(`catalog must contain exactly the four locked preset keys, got: ${actualKeys.join(", ")}`);
  }

  const seenKeys = new Set<string>();
  for (const key of INDUSTRY_PRESET_KEYS) {
    if (seenKeys.has(key)) {
      errors.push(`duplicate preset key "${key}"`);
    }
    seenKeys.add(key);
  }

  for (const preset of listIndustryPresets()) {
    checkPreset(preset, errors);
  }

  return errors;
}
