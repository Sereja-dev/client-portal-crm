"use client";

import { useActionState, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { DIALOG_CENTER_CLASSES } from "@/components/ui/dialog-classes";
import { COLOR_OPTIONS } from "./color-options";
import { SetDefaultButton } from "./status-row-actions";
import { callActionWithStaleRecovery } from "@/lib/action-error";
import type { CustomStatusColor } from "@/generated/prisma/enums";
import type { CustomStatusDefinitionFormState } from "@/types";

const initialState: CustomStatusDefinitionFormState = { error: null };

/**
 * Custom Statuses Phase 2B (Section G) — "Edit status". Only ever
 * rendered for a CUSTOM, non-archived definition (Section E/G: system
 * statuses are never editable, and the settings list never offers this
 * button for one — enforced independently server-side too, see
 * actions.ts's own comment). Label and color are the only editable
 * fields; entityType/key/isSystem are shown read-only. "Set default" is
 * its own explicit action inside this dialog (Section G: "Default state
 * via explicit Set default action if cleaner") rather than a checkbox on
 * this same submit, since setting the default is a separate, immediate,
 * non-reversible-by-resubmit operation, not part of the label/color
 * form's own draft state.
 */
export function EditStatusButton({
  label,
  color,
  entityLabel,
  entityKey,
  isDefault,
  canSetDefault,
  action,
  setDefaultAction,
}: {
  label: string;
  color: CustomStatusColor | null;
  entityLabel: string;
  entityKey: string;
  isDefault: boolean;
  /** Phase 2B Completion Pass (Section B/C) — false only for LEAD: its default is locked to system NEW, so a custom LEAD status (never default itself) never gets a "Set default" control here either. */
  canSetDefault: boolean;
  action: (
    prevState: CustomStatusDefinitionFormState,
    formData: FormData,
  ) => Promise<CustomStatusDefinitionFormState>;
  /** A bound, zero-argument server action (setDefaultCustomStatusAction.bind(null, entityType, definitionId)). */
  setDefaultAction: () => Promise<void>;
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
      <EditStatusDialog
        dialogRef={dialogRef}
        defaultLabel={label}
        defaultColor={color ?? "NEUTRAL"}
        entityLabel={entityLabel}
        entityKey={entityKey}
        isDefault={isDefault}
        canSetDefault={canSetDefault}
        action={action}
        setDefaultAction={setDefaultAction}
      />
    </>
  );
}

function EditStatusDialog({
  dialogRef,
  defaultLabel,
  defaultColor,
  entityLabel,
  entityKey,
  isDefault,
  canSetDefault,
  action,
  setDefaultAction,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  defaultLabel: string;
  defaultColor: CustomStatusColor;
  entityLabel: string;
  entityKey: string;
  isDefault: boolean;
  canSetDefault: boolean;
  action: (
    prevState: CustomStatusDefinitionFormState,
    formData: FormData,
  ) => Promise<CustomStatusDefinitionFormState>;
  setDefaultAction: () => Promise<void>;
}) {
  const titleId = useId();
  const [state, formAction, pending] = useActionState(async (prevState: CustomStatusDefinitionFormState, formData: FormData) => {
    const result = await callActionWithStaleRecovery(() => action(prevState, formData));
    if (result.error === null && !result.fieldErrors) {
      dialogRef.current?.close();
    }
    return result;
  }, initialState);

  const labelId = `${titleId}-label`;
  const colorId = `${titleId}-color`;

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
          Edit status
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
        <div className="col-span-2">
          <dt className="inline font-medium">Internal key: </dt>
          <dd className="text-text-secondary inline">
            <code>{entityKey}</code>
          </dd>
        </div>
      </dl>
      <p className="text-text-muted mb-4 text-xs">
        Entity and internal key can&apos;t be changed after a status is created —
        renaming the label below never changes the internal key.
      </p>

      <form action={formAction} className="space-y-4">
        <FormField label="Label" htmlFor={labelId} required error={state.fieldErrors?.label}>
          <Input
            id={labelId}
            name="label"
            defaultValue={defaultLabel}
            required
            maxLength={64}
            aria-invalid={!!state.fieldErrors?.label}
          />
        </FormField>

        <FormField label="Color" htmlFor={colorId} required>
          <Select id={colorId} name="color" defaultValue={defaultColor} required>
            {COLOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>

        {state.error && (
          <p role="alert" className="text-danger text-sm">
            {state.error}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          {isDefault ? (
            <span className="text-text-muted text-xs">This is the current default.</span>
          ) : canSetDefault ? (
            <SetDefaultButton action={setDefaultAction} label={defaultLabel} />
          ) : (
            <span />
          )}
          <Button type="submit" loading={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
