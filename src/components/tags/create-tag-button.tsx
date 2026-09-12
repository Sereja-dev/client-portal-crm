"use client";

import { useId, useRef, useState } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { DIALOG_CENTER_CLASSES } from "@/components/ui/dialog-classes";
import { COLOR_OPTIONS } from "@/components/custom-statuses/color-options";
import type { TagFormState } from "@/types";

const initialState: TagFormState = { error: null };

/**
 * Tags V2 (Settings → Tags) — "Add tag". Byte-for-byte mirror of
 * custom-statuses/create-status-button.tsx's own exact shape, minus the
 * entityType/key/default concepts a Tag has none of (Tags carry no
 * entityType at all — see Tag's own schema doc comment). COLOR_OPTIONS is
 * imported directly from Custom Statuses rather than duplicated: Tag.color
 * deliberately reuses the CustomStatusColor enum itself (Phase 1's own
 * documented choice), so this is the same fixed six-tone label set, not a
 * parallel copy of it.
 */
export function CreateTagButton({
  action,
}: {
  action: (prevState: TagFormState, formData: FormData) => Promise<TagFormState>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button type="button" onClick={() => dialogRef.current?.showModal()}>
        Add tag
      </Button>
      <CreateTagDialog dialogRef={dialogRef} action={action} />
    </>
  );
}

function CreateTagDialog({
  dialogRef,
  action,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  action: (prevState: TagFormState, formData: FormData) => Promise<TagFormState>;
}) {
  const titleId = useId();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(COLOR_OPTIONS[0].value);

  const [state, formAction, pending] = useActionState(async (prevState: TagFormState, formData: FormData) => {
    const result = await action(prevState, formData);
    if (result.error === null && !result.fieldErrors) {
      setName("");
      setColor(COLOR_OPTIONS[0].value);
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
          Add tag
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
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            placeholder="e.g. VIP"
            aria-invalid={!!state.fieldErrors?.name}
          />
        </FormField>

        <FormField label="Color" htmlFor={colorId} required>
          <Select id={colorId} name="color" value={color} onChange={(e) => setColor(e.target.value)} required>
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
            {pending ? "Creating…" : "Add tag"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
