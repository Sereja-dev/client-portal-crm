"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import type { CustomFieldType } from "@/generated/prisma/enums";

/**
 * Custom Fields Phase 2B (Section C/D/I/S/T/U/V) — the one shared
 * "Custom fields" section embedded, identically, into ClientForm/
 * LeadForm/ProjectForm's own `<form>` (never a separate `<form>` of its
 * own — its inputs submit as part of the same FormData the entity's
 * normal fields already use, matching Section W: no separate custom-
 * field Server Action). Renders nothing at all when there are zero
 * active definitions for this entity type (Section B).
 *
 * Deliberately plain objects/records for every prop, never a Map — this
 * crosses the Server Component → Client Component boundary, which only
 * accepts JSON-serializable values (the Server Component callers convert
 * their own internal Map<definitionId, ...> via Object.fromEntries()
 * before passing it down).
 */

export type CustomFieldFormDefinitionForUI = {
  id: string;
  label: string;
  fieldType: CustomFieldType;
  required: boolean;
  options: { id: string; label: string }[];
};

export type CustomFieldFormValueForUI = {
  textValue: string | null;
  numberValue: string | null;
  dateValue: string | null;
  booleanValue: boolean | null;
  selectedOptionId: string | null;
  selectedOptionLabel: string | null;
  selectedOptionArchived: boolean;
};

export function CustomFieldsFormSection({
  definitions,
  values = {},
  errors = {},
}: {
  definitions: CustomFieldFormDefinitionForUI[];
  /** Keyed by definitionId. Absent/empty on create — every field starts blank. */
  values?: Record<string, CustomFieldFormValueForUI>;
  /** Keyed by definitionId (Section D never exposes the definition's own key/UUID as a label — this map's keys are purely an internal lookup, never rendered). */
  errors?: Record<string, string>;
}) {
  if (definitions.length === 0) {
    return null;
  }

  return (
    <fieldset className="border-border-default space-y-4 border-t pt-4">
      <legend className="text-text-primary text-base font-semibold">Custom fields</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {definitions.map((definition) => (
          <CustomFieldControl
            key={definition.id}
            definition={definition}
            value={values[definition.id]}
            error={errors[definition.id]}
          />
        ))}
      </div>
    </fieldset>
  );
}

function CustomFieldControl({
  definition,
  value,
  error,
}: {
  definition: CustomFieldFormDefinitionForUI;
  value?: CustomFieldFormValueForUI;
  error?: string;
}) {
  const fieldId = useId();
  const name = `customField_${definition.id}`;

  // CHECKBOX renders full-width (Section S) and outside FormField's own
  // label-above-control layout — a checkbox reads better with its label
  // beside it, matching every other checkbox already in this app
  // (isBilling, required, etc. in Multiple Contacts Phase 2 / Custom
  // Fields Phase 2A).
  if (definition.fieldType === "CHECKBOX") {
    return (
      <div className="sm:col-span-2">
        <div className="flex items-center gap-2">
          <input
            id={fieldId}
            name={name}
            type="checkbox"
            defaultChecked={value?.booleanValue ?? false}
            aria-invalid={!!error}
            aria-describedby={error ? `${fieldId}-error` : undefined}
            className="border-border-strong accent-accent focus-visible:ring-focus-ring h-4 w-4 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          />
          <label htmlFor={fieldId} className="text-text-secondary text-sm">
            {definition.label}
            {definition.required && (
              <span className="text-danger ml-0.5" aria-hidden="true">
                *
              </span>
            )}
          </label>
        </div>
        {error && (
          <p id={`${fieldId}-error`} role="alert" className="text-danger mt-1 text-sm">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <FormField label={definition.label} htmlFor={fieldId} required={definition.required} error={error}>
      {definition.fieldType === "TEXT" && (
        <Input
          id={fieldId}
          name={name}
          type="text"
          defaultValue={value?.textValue ?? ""}
          aria-invalid={!!error}
          aria-describedby={error ? `${fieldId}-error` : undefined}
        />
      )}
      {definition.fieldType === "NUMBER" && (
        <Input
          id={fieldId}
          name={name}
          type="text"
          inputMode="decimal"
          defaultValue={value?.numberValue ?? ""}
          aria-invalid={!!error}
          aria-describedby={error ? `${fieldId}-error` : undefined}
        />
      )}
      {definition.fieldType === "DATE" && (
        <Input
          id={fieldId}
          name={name}
          type="date"
          defaultValue={value?.dateValue ?? ""}
          aria-invalid={!!error}
          aria-describedby={error ? `${fieldId}-error` : undefined}
        />
      )}
      {definition.fieldType === "SELECT" && (
        <SelectCustomField fieldId={fieldId} name={name} definition={definition} value={value} error={error} />
      )}
    </FormField>
  );
}

/**
 * SELECT gets its own controlled component specifically for the
 * archived-option UX (Section I): if the entity's current value points
 * to an option that has since been archived, that one specific option is
 * injected into the list — labeled "(archived)" — for exactly as long as
 * it remains selected. The moment the visitor picks anything else, that
 * injected `<option>` stops rendering at all, so it can never be
 * re-selected client-side afterward (the server independently enforces
 * the same rule regardless — see decideCustomFieldValue's own comment —
 * this is purely the matching UI behavior).
 */
function SelectCustomField({
  fieldId,
  name,
  definition,
  value,
  error,
}: {
  fieldId: string;
  name: string;
  definition: CustomFieldFormDefinitionForUI;
  value?: CustomFieldFormValueForUI;
  error?: string;
}) {
  const [current, setCurrent] = useState(value?.selectedOptionId ?? "");
  const archivedCurrentStillSelected =
    !!value?.selectedOptionArchived && !!value.selectedOptionId && current === value.selectedOptionId;

  return (
    <Select
      id={fieldId}
      name={name}
      value={current}
      onChange={(event) => setCurrent(event.target.value)}
      aria-invalid={!!error}
      aria-describedby={error ? `${fieldId}-error` : undefined}
    >
      <option value="">— None —</option>
      {definition.options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
      {archivedCurrentStillSelected && (
        <option value={value.selectedOptionId ?? ""}>{value.selectedOptionLabel ?? "Unknown option"} (archived)</option>
      )}
    </Select>
  );
}
