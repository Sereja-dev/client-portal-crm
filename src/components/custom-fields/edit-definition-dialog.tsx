"use client";

import { useActionState, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { DIALOG_CENTER_CLASSES } from "@/components/ui/dialog-classes";
import { CUSTOM_FIELD_LABEL_MAX_LENGTH, FIELD_TYPE_LABELS } from "@/lib/validation/custom-field";
import { OptionManager, type OptionRow } from "./option-manager";
import type { CustomFieldType } from "@/generated/prisma/enums";
import type { CustomFieldDefinitionFormState, CustomFieldOptionFormState } from "@/types";

const initialState: CustomFieldDefinitionFormState = { error: null };

/**
 * Custom Fields Phase 2A (Section H) — "Edit custom field". Same
 * trigger-button-owns-its-dialogRef shape as EditContactButton. Only
 * label/required are ever editable form fields here — entityType,
 * fieldType, and key are shown read-only (Section H: "not editable
 * unless Phase 1 architecture explicitly intended otherwise" — it
 * doesn't). For a SELECT definition, the full OptionManager renders
 * below the metadata form (Section J) — a separate set of per-option
 * Server Actions, not part of this dialog's own label/required
 * `<form>` submit at all.
 */
export function EditDefinitionButton({
  definitionId,
  label,
  required,
  fieldType,
  entityLabel,
  entityKey,
  action,
  options,
  addOptionAction,
}: {
  definitionId: string;
  label: string;
  required: boolean;
  fieldType: CustomFieldType;
  entityLabel: string;
  entityKey: string;
  action: (
    prevState: CustomFieldDefinitionFormState,
    formData: FormData,
  ) => Promise<CustomFieldDefinitionFormState>;
  options: OptionRow[];
  addOptionAction: (
    prevState: CustomFieldOptionFormState,
    formData: FormData,
  ) => Promise<CustomFieldOptionFormState>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="text-text-secondary hover:text-text-primary focus-visible:ring-focus-ring rounded text-sm font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      >
        Edit
      </button>
      <EditDefinitionDialog
        dialogRef={dialogRef}
        definitionId={definitionId}
        defaultLabel={label}
        defaultRequired={required}
        fieldType={fieldType}
        entityLabel={entityLabel}
        entityKey={entityKey}
        action={action}
        options={options}
        addOptionAction={addOptionAction}
      />
    </>
  );
}

function EditDefinitionDialog({
  dialogRef,
  defaultLabel,
  defaultRequired,
  fieldType,
  entityLabel,
  entityKey,
  action,
  options,
  addOptionAction,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  definitionId: string;
  defaultLabel: string;
  defaultRequired: boolean;
  fieldType: CustomFieldType;
  entityLabel: string;
  entityKey: string;
  action: (
    prevState: CustomFieldDefinitionFormState,
    formData: FormData,
  ) => Promise<CustomFieldDefinitionFormState>;
  options: OptionRow[];
  addOptionAction: (
    prevState: CustomFieldOptionFormState,
    formData: FormData,
  ) => Promise<CustomFieldOptionFormState>;
}) {
  const titleId = useId();
  const [state, formAction, pending] = useActionState(async (prevState: CustomFieldDefinitionFormState, formData: FormData) => {
    const result = await action(prevState, formData);
    if (result.error === null && !result.fieldErrors) {
      dialogRef.current?.close();
    }
    return result;
  }, initialState);

  const labelId = `${titleId}-label`;
  const requiredId = `${titleId}-required`;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          (event.currentTarget as HTMLDialogElement).close();
        }
      }}
      className={`border-border-default bg-surface w-full max-w-xl rounded-lg border p-6 shadow-xl backdrop:bg-black/40 ${DIALOG_CENTER_CLASSES}`}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 id={titleId} className="text-text-primary text-base font-semibold">
          Edit custom field
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

      <dl className="text-text-muted mb-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div>
          <dt className="inline font-medium">Entity: </dt>
          <dd className="text-text-secondary inline">{entityLabel}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Type: </dt>
          <dd className="text-text-secondary inline">{FIELD_TYPE_LABELS[fieldType]}</dd>
        </div>
        <div className="col-span-2">
          <dt className="inline font-medium">Internal key: </dt>
          <dd className="text-text-secondary inline">
            <code>{entityKey}</code>
          </dd>
        </div>
      </dl>
      <p className="text-text-muted mb-4 text-xs">
        Entity, type, and internal key can&apos;t be changed after a custom field is
        created — renaming the label below never changes the internal key.
      </p>

      <form action={formAction} className="space-y-4">
        <FormField label="Label" htmlFor={labelId} required error={state.fieldErrors?.label}>
          <Input
            id={labelId}
            name="label"
            defaultValue={defaultLabel}
            required
            maxLength={CUSTOM_FIELD_LABEL_MAX_LENGTH}
            aria-invalid={!!state.fieldErrors?.label}
          />
        </FormField>

        <div className="flex items-center gap-2">
          <input
            id={requiredId}
            name="required"
            type="checkbox"
            defaultChecked={defaultRequired}
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

        {state.error && (
          <p role="alert" className="text-danger text-sm">
            {state.error}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="submit" loading={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>

      {fieldType === "SELECT" && <OptionManager options={options} addOptionAction={addOptionAction} />}
    </dialog>
  );
}
