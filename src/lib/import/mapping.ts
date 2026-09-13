import type { ImportFieldDefinition } from "./fields";

/**
 * CSV Import Phase 2 — column mapping: CSV column index -> Aqenra field
 * key. Keyed by column INDEX, never by header text — a CSV's header row
 * can contain duplicate/blank column names (csv-parse exposes them
 * as-is, with no de-duplication of its own), so index is the only
 * collision-free way to identify "this specific column."
 */
export type ImportMappingEntry<Key extends string> = { columnIndex: number; field: Key };
export type ImportMapping<Key extends string> = ImportMappingEntry<Key>[];

export type MappingValidationError =
  | { code: "duplicate_target"; field: string }
  | { code: "duplicate_column"; columnIndex: number }
  | { code: "unknown_field"; field: string }
  | { code: "column_out_of_range"; columnIndex: number }
  | { code: "missing_required_field"; field: string };

/**
 * Validates a submitted mapping against this entity's own fixed,
 * server-defined field list — the only defense that actually matters
 * here, since it is what makes "mapping cannot target system/internal
 * fields" true regardless of what a client sends: `fields` never
 * contains a Tags/Custom Fields/Status/Stage/assignee/id/timestamp key
 * (see fields.ts), so no submitted mapping can ever resolve to one.
 *
 * Also enforces the wizard's own stated invariants: one CSV column maps
 * to at most one Aqenra field (duplicate_column), one Aqenra field
 * receives at most one CSV column (duplicate_target), every required
 * field (Name) must be present, and every column index must be within
 * the CSV's own actual header length (a stale mapping submitted against
 * a since-changed file is rejected rather than silently misapplied).
 */
export function validateImportMapping<Key extends string>(
  mapping: ImportMapping<Key>,
  fields: readonly ImportFieldDefinition<Key>[],
  headerCount: number,
): { ok: true } | { ok: false; error: MappingValidationError } {
  const validFieldKeys = new Set(fields.map((f) => f.key));
  const seenColumns = new Set<number>();
  const seenFields = new Set<Key>();

  for (const entry of mapping) {
    if (!Number.isInteger(entry.columnIndex) || entry.columnIndex < 0 || entry.columnIndex >= headerCount) {
      return { ok: false, error: { code: "column_out_of_range", columnIndex: entry.columnIndex } };
    }
    if (!validFieldKeys.has(entry.field)) {
      return { ok: false, error: { code: "unknown_field", field: String(entry.field) } };
    }
    if (seenColumns.has(entry.columnIndex)) {
      return { ok: false, error: { code: "duplicate_column", columnIndex: entry.columnIndex } };
    }
    if (seenFields.has(entry.field)) {
      return { ok: false, error: { code: "duplicate_target", field: String(entry.field) } };
    }
    seenColumns.add(entry.columnIndex);
    seenFields.add(entry.field);
  }

  for (const field of fields) {
    if (field.required && !seenFields.has(field.key)) {
      return { ok: false, error: { code: "missing_required_field", field: field.key } };
    }
  }

  return { ok: true };
}

/** Lowercases and strips everything but letters/digits — "Full Name", "full_name", and "FULLNAME" all normalize to the same "fullname" key, matched against each field's own headerAliases. */
export function normalizeHeaderName(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * One auto-suggested mapping entry per CSV header that unambiguously
 * matches exactly one field's own headerAliases — never a fuzzy/
 * best-guess match (Section 7's own explicit "do not use fuzzy guessing
 * that silently maps ambiguous columns"). A header that matches no
 * field, or that would collide with a field already suggested for an
 * earlier column, is simply left unmapped — the wizard's own UI always
 * lets every suggestion be reviewed/edited before it's ever submitted,
 * so an intentionally conservative miss here is always safe.
 */
export function suggestImportMapping<Key extends string>(
  headers: string[],
  fields: readonly ImportFieldDefinition<Key>[],
): ImportMapping<Key> {
  const suggestions: ImportMapping<Key> = [];
  const claimedFields = new Set<Key>();

  headers.forEach((header, columnIndex) => {
    const normalized = normalizeHeaderName(header);
    if (!normalized) return;
    const match = fields.find((f) => !claimedFields.has(f.key) && f.headerAliases.includes(normalized));
    if (match) {
      suggestions.push({ columnIndex, field: match.key });
      claimedFields.add(match.key);
    }
  });

  return suggestions;
}
