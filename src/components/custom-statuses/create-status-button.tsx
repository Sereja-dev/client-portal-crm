"use client";

import { useId, useRef, useState } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { DIALOG_CENTER_CLASSES } from "@/components/ui/dialog-classes";
import { slugifyCustomStatusIdentifier } from "@/lib/custom-statuses/slug";
import { COLOR_OPTIONS } from "./color-options";
import { callActionWithStaleRecovery } from "@/lib/action-error";
import type { CustomStatusDefinitionFormState } from "@/types";

const initialState: CustomStatusDefinitionFormState = { error: null };

/**
 * Custom Statuses Phase 2B (Section F) — "Add status", opened from one
 * specific entity tab. Byte-for-byte mirror of custom-fields/
 * create-definition-button.tsx's own exact shape: `action` already has
 * `entityType` bound server-side by the caller (this page's Server
 * Component), so this dialog never renders an entityType form field at
 * all — nothing to lock, since it was never editable input in the first
 * place. Key is never a form field either — generated server-side from
 * the label (Section F), shown here only as a live preview so a Staff
 * member can see what it will be. isSystem is never rendered or
 * submitted anywhere in this dialog — createCustomStatusAction always
 * creates isSystem: false.
 */
export function CreateStatusButton({
  action,
  entityLabel,
  canSetDefault,
  variant = "secondary",
  label = "Add status",
}: {
  action: (
    prevState: CustomStatusDefinitionFormState,
    formData: FormData,
  ) => Promise<CustomStatusDefinitionFormState>;
  entityLabel: string;
  /** Phase 2B Completion Pass (Section B/C) — false only for LEAD: its default is locked to system NEW, so this dialog never offers a "make default" checkbox to check in the first place. */
  canSetDefault: boolean;
  variant?: "primary" | "secondary";
  label?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button type="button" variant={variant} onClick={() => dialogRef.current?.showModal()}>
        {label}
      </Button>
      <CreateStatusDialog dialogRef={dialogRef} action={action} entityLabel={entityLabel} canSetDefault={canSetDefault} />
    </>
  );
}

function CreateStatusDialog({
  dialogRef,
  action,
  entityLabel,
  canSetDefault,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  action: (
    prevState: CustomStatusDefinitionFormState,
    formData: FormData,
  ) => Promise<CustomStatusDefinitionFormState>;
  entityLabel: string;
  canSetDefault: boolean;
}) {
  const titleId = useId();
  const [statusLabel, setStatusLabel] = useState("");
  const [color, setColor] = useState<string>(COLOR_OPTIONS[0].value);

  const [state, formAction, pending] = useActionState(async (prevState: CustomStatusDefinitionFormState, formData: FormData) => {
    const result = await callActionWithStaleRecovery(() => action(prevState, formData));
    if (result.error === null && !result.fieldErrors) {
      setStatusLabel("");
      setColor(COLOR_OPTIONS[0].value);
      dialogRef.current?.close();
    }
    return result;
  }, initialState);

  const labelId = `${titleId}-label`;
  const colorId = `${titleId}-color`;
  const defaultId = `${titleId}-default`;
  const keyPreview = statusLabel.trim() ? slugifyCustomStatusIdentifier(statusLabel) : null;

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
          Add status
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
            value={statusLabel}
            onChange={(e) => setStatusLabel(e.target.value)}
            required
            maxLength={64}
            placeholder="e.g. Awaiting client"
            aria-invalid={!!state.fieldErrors?.label}
          />
          {keyPreview && (
            <p className="text-text-muted mt-1 text-xs">
              Internal key: <code className="text-text-secondary">{keyPreview}</code>
            </p>
          )}
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

        {canSetDefault ? (
          <div className="flex items-center gap-2">
            <input
              id={defaultId}
              name="isDefault"
              type="checkbox"
              className="border-border-strong accent-accent focus-visible:ring-focus-ring h-4 w-4 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            />
            <label htmlFor={defaultId} className="text-text-secondary text-sm">
              Make this the default {entityLabel.toLowerCase().replace(/s$/, "")} status
            </label>
          </div>
        ) : (
          <p className="text-text-muted text-xs">New leads always start as New.</p>
        )}

        {state.error && (
          <p role="alert" className="text-danger text-sm">
            {state.error}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="submit" loading={pending}>
            {pending ? "Creating…" : "Add status"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
