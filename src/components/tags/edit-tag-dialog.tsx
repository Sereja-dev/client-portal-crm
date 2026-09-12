"use client";

import { useActionState, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { DIALOG_CENTER_CLASSES } from "@/components/ui/dialog-classes";
import { COLOR_OPTIONS } from "@/components/custom-statuses/color-options";
import type { CustomStatusColor } from "@/generated/prisma/enums";
import type { TagFormState } from "@/types";

const initialState: TagFormState = { error: null };

/**
 * Tags V2 (Settings → Tags) — "Edit tag" (rename + recolor). Byte-for-byte
 * mirror of custom-statuses/edit-status-dialog.tsx's own exact shape,
 * minus the entityType/key/default concepts (see CreateTagButton's own
 * identical comment). Only ever rendered for a non-archived Tag — the
 * settings list never offers this for an archived one (no un-archive
 * path in this scope), enforced independently server-side too.
 */
export function EditTagButton({
  name,
  color,
  action,
}: {
  name: string;
  color: CustomStatusColor | null;
  action: (prevState: TagFormState, formData: FormData) => Promise<TagFormState>;
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
      <EditTagDialog dialogRef={dialogRef} defaultName={name} defaultColor={color ?? "NEUTRAL"} action={action} />
    </>
  );
}

function EditTagDialog({
  dialogRef,
  defaultName,
  defaultColor,
  action,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  defaultName: string;
  defaultColor: CustomStatusColor;
  action: (prevState: TagFormState, formData: FormData) => Promise<TagFormState>;
}) {
  const titleId = useId();
  const [state, formAction, pending] = useActionState(async (prevState: TagFormState, formData: FormData) => {
    const result = await action(prevState, formData);
    if (result.error === null && !result.fieldErrors) {
      dialogRef.current?.close();
    }
    return result;
  }, initialState);

  const nameId = `${titleId}-name`;
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
          Edit tag
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

      <form action={formAction} className="space-y-4">
        <FormField label="Name" htmlFor={nameId} required error={state.fieldErrors?.name}>
          <Input
            id={nameId}
            name="name"
            defaultValue={defaultName}
            required
            maxLength={100}
            aria-invalid={!!state.fieldErrors?.name}
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

        <div className="flex justify-end gap-3 pt-2">
          <Button type="submit" loading={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
