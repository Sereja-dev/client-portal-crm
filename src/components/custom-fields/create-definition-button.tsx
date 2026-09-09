"use client";

import { useId, useRef, useState } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField, FormLabel } from "@/components/ui/form-field";
import { DIALOG_CENTER_CLASSES } from "@/components/ui/dialog-classes";
import { slugifyCustomFieldIdentifier } from "@/lib/custom-fields/slug";
import { CUSTOM_FIELD_LABEL_MAX_LENGTH, FIELD_TYPE_LABELS } from "@/lib/validation/custom-field";
import type { CustomFieldType } from "@/generated/prisma/enums";
import type { CustomFieldDefinitionFormState } from "@/types";

const initialState: CustomFieldDefinitionFormState = { error: null };
const FIELD_TYPES = Object.keys(FIELD_TYPE_LABELS) as CustomFieldType[];

/**
 * Custom Fields Phase 2A (Section F/G) — "Add custom field", opened from
 * one specific entity tab. Same trigger-button-owns-its-dialogRef shape
 * as AddContactButton — `action` already has `entityType` bound
 * server-side by the caller (this page's Server Component), so this
 * dialog never renders an entityType form field at all (nothing to lock
 * — it was never editable input in the first place). `variant`/`label`
 * mirror AddContactButton's own props exactly (used both above an
 * already-populated list and as the empty state's own primary CTA).
 */
export function CreateDefinitionButton({
  action,
  entityLabel,
  variant = "secondary",
  label = "Add custom field",
}: {
  action: (
    prevState: CustomFieldDefinitionFormState,
    formData: FormData,
  ) => Promise<CustomFieldDefinitionFormState>;
  entityLabel: string;
  variant?: "primary" | "secondary";
  label?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button type="button" variant={variant} onClick={() => dialogRef.current?.showModal()}>
        {label}
      </Button>
      <CreateDefinitionDialog dialogRef={dialogRef} action={action} entityLabel={entityLabel} />
    </>
  );
}

function CreateDefinitionDialog({
  dialogRef,
  action,
  entityLabel,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  action: (
    prevState: CustomFieldDefinitionFormState,
    formData: FormData,
  ) => Promise<CustomFieldDefinitionFormState>;
  entityLabel: string;
}) {
  const titleId = useId();
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType | "">("");
  // Every option label the Staff member has typed so far — always at
  // least one blank slot rendered so there's an input to type into
  // immediately once Select is chosen. Submitted as repeated
  // name="optionLabel" fields; parseCustomFieldOptionLabels on the
  // server drops any that end up blank, so a trailing empty slot never
  // becomes a real option.
  const [optionLabels, setOptionLabels] = useState<string[]>([""]);

  const [state, formAction, pending] = useActionState(async (prevState: CustomFieldDefinitionFormState, formData: FormData) => {
    const result = await action(prevState, formData);
    if (result.error === null && !result.fieldErrors) {
      setLabel("");
      setFieldType("");
      setOptionLabels([""]);
      dialogRef.current?.close();
    }
    return result;
  }, initialState);

  const labelId = `${titleId}-label`;
  const fieldTypeId = `${titleId}-fieldType`;
  const requiredId = `${titleId}-required`;
  const keyPreview = label.trim() ? slugifyCustomFieldIdentifier(label) : null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          (event.currentTarget as HTMLDialogElement).close();
        }
      }}
      className={`border-border-default bg-surface w-full max-w-md rounded-lg border p-6 shadow-xl backdrop:bg-black/40 ${DIALOG_CENTER_CLASSES}`}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 id={titleId} className="text-text-primary text-base font-semibold">
          Add custom field
        </h2>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close"
          className="text-text-muted focus-visible:ring-focus-ring rounded p-1 hover:text-text-secondary focus:outline-none focus-visible:ring-2"
        >
          ✕
        </button>
      </div>

      <p className="text-text-muted mb-4 text-xs">
        Entity: <span className="text-text-secondary font-medium">{entityLabel}</span>
      </p>

      <form action={formAction} className="space-y-4">
        <FormField label="Label" htmlFor={labelId} required error={state.fieldErrors?.label}>
          <Input
            id={labelId}
            name="label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            maxLength={CUSTOM_FIELD_LABEL_MAX_LENGTH}
            placeholder="e.g. Account Manager"
            aria-invalid={!!state.fieldErrors?.label}
          />
          {keyPreview && (
            <p className="text-text-muted mt-1 text-xs">
              Internal key: <code className="text-text-secondary">{keyPreview}</code>
            </p>
          )}
        </FormField>

        <FormField label="Field type" htmlFor={fieldTypeId} required error={state.fieldErrors?.fieldType}>
          <Select
            id={fieldTypeId}
            name="fieldType"
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
            required
            aria-invalid={!!state.fieldErrors?.fieldType}
          >
            <option value="" disabled>
              Select a type…
            </option>
            {FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {FIELD_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </FormField>

        <div className="flex items-center gap-2">
          <input
            id={requiredId}
            name="required"
            type="checkbox"
            className="border-border-strong accent-accent focus-visible:ring-focus-ring h-4 w-4 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          />
          <label htmlFor={requiredId} className="text-text-secondary text-sm">
            Required
          </label>
        </div>
        <p className="text-text-muted -mt-2 text-xs">
          Required will be enforced once this custom field is shown on entity forms — it
          isn&apos;t enforced anywhere yet.
        </p>

        {fieldType === "SELECT" && (
          <div>
            <FormLabel htmlFor={`${titleId}-option-0`}>Options</FormLabel>
            <div className="mt-1 space-y-2">
              {optionLabels.map((value, index) => (
                <div key={index} className="flex items-center gap-2">
                  <label htmlFor={`${titleId}-option-${index}`} className="sr-only">
                    Option {index + 1}
                  </label>
                  <Input
                    id={`${titleId}-option-${index}`}
                    name="optionLabel"
                    value={value}
                    onChange={(e) => {
                      const next = [...optionLabels];
                      next[index] = e.target.value;
                      setOptionLabels(next);
                    }}
                    placeholder={`Option ${index + 1}`}
                    maxLength={CUSTOM_FIELD_LABEL_MAX_LENGTH}
                  />
                  {optionLabels.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setOptionLabels(optionLabels.filter((_, i) => i !== index))}
                      aria-label={`Remove option ${index + 1}`}
                      className="text-text-muted hover:text-danger focus-visible:ring-focus-ring shrink-0 rounded p-1 focus:outline-none focus-visible:ring-2"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setOptionLabels([...optionLabels, ""])}
              className="text-accent focus-visible:ring-focus-ring mt-2 rounded text-sm font-medium hover:underline focus:outline-none focus-visible:ring-2"
            >
              + Add option
            </button>
          </div>
        )}

        {state.error && (
          <p role="alert" className="text-danger text-sm">
            {state.error}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="submit" loading={pending}>
            {pending ? "Creating…" : "Add custom field"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
