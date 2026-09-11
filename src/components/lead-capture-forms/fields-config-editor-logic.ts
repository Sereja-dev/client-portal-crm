import { LEAD_CAPTURE_FORM_DEFAULT_LABELS, type LeadCaptureFormFieldKey, type ResolvedLeadCaptureFormFieldsConfig } from "@/lib/lead-capture-forms/fields";

/**
 * Public Lead Capture Forms Phase 2A (Staff UI) — the pure state-transition
 * logic behind FieldsConfigEditor's own visibility/reorder/serialize
 * behavior, split out specifically so it's unit-testable without a DOM/
 * component-interaction harness (this repo has none — see
 * test/unit/record-list.test.tsx's own header comment: component tests
 * here use `renderToStaticMarkup`, which can't simulate a click or
 * checkbox change at all). Mirrors src/lib/custom-statuses/select-options.ts's
 * own "extract the pure logic, unit-test that directly" precedent for
 * exactly this reason.
 */

export type FieldRow = {
  key: LeadCaptureFormFieldKey;
  visible: boolean;
  required: boolean;
  label: string;
};

/** Row order = array order. Every key from `config` is present, sorted by its own stored `order`. */
export function toFieldRows(config: ResolvedLeadCaptureFormFieldsConfig): FieldRow[] {
  return (Object.entries(config) as [LeadCaptureFormFieldKey, ResolvedLeadCaptureFormFieldsConfig[LeadCaptureFormFieldKey]][])
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([key, entry]) => ({ key, visible: entry.visible, required: entry.required, label: entry.label ?? "" }));
}

/**
 * "Hidden field can't be required" (Section: "UI should prevent invalid
 * combinations before submit") — turning Visible off always also turns
 * Required off in the same update, so that combination can never exist
 * in this editor's own state, let alone reach submit. Turning Visible
 * back on leaves Required exactly as it was (false, from the moment it
 * was cleared) — never silently re-required.
 */
export function applyVisibilityChange(rows: FieldRow[], index: number, visible: boolean): FieldRow[] {
  return rows.map((row, i) => (i === index ? { ...row, visible, required: visible ? row.required : false } : row));
}

export function applyRequiredChange(rows: FieldRow[], index: number, required: boolean): FieldRow[] {
  return rows.map((row, i) => (i === index ? { ...row, required } : row));
}

export function applyLabelChange(rows: FieldRow[], index: number, label: string): FieldRow[] {
  return rows.map((row, i) => (i === index ? { ...row, label } : row));
}

/** Deterministic adjacent swap (Section: "Staff can reorder fields") — no drag/drop, same up/down convention as MoveCustomStatusButtons. A move past either end is a no-op, returning the same array reference. */
export function moveFieldRow(rows: FieldRow[], index: number, direction: "up" | "down"): FieldRow[] {
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * The exact plain-object shape createLeadCaptureForm/updateLeadCaptureForm's
 * own `fieldsConfig` input expects — array order becomes each field's own
 * `order`, and a blank label serializes as `null` (use the default label),
 * matching validateLeadCaptureFormFieldsConfigInput's own identical
 * "blank label -> null" convention.
 */
export function serializeFieldRows(rows: FieldRow[]): Record<string, { visible: boolean; required: boolean; order: number; label: string | null }> {
  return Object.fromEntries(
    rows.map((row, index) => [
      row.key,
      { visible: row.visible, required: row.required, order: index, label: row.label.trim() || null },
    ]),
  );
}

export function defaultFieldLabel(key: LeadCaptureFormFieldKey): string {
  return LEAD_CAPTURE_FORM_DEFAULT_LABELS[key];
}
