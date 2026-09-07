"use client";

import { useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Textarea } from "@/components/ui/textarea";
import { FormLabel } from "@/components/ui/form-field";
import { LEAD_LOST_REASON_MAX_LENGTH } from "@/lib/validation/lead";

export type MarkLeadLostDialogHandle = { open: () => void };

/**
 * A dedicated dialog, not a reuse of the generic <ConfirmDialog> — that
 * component's `description` renders inside a <p>, which cannot legally
 * contain a <textarea> (browsers close the <p> early, and a <textarea>
 * placed inside its aria-describedby target reads oddly to a screen
 * reader regardless). Mirrors ConfirmDialog's exact markup/classes
 * otherwise (same <dialog> element, same backdrop, same button styling)
 * so it reads as the same dialog pattern, not a parallel one — the only
 * real difference is a proper, separately-labeled Textarea.
 */
export function MarkLeadLostDialog({
  ref,
  onConfirm,
}: {
  ref?: Ref<MarkLeadLostDialogHandle>;
  onConfirm: (lostReason: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const fieldId = useId();
  const [reason, setReason] = useState("");

  useImperativeHandle(ref, () => ({
    open: () => {
      setReason("");
      dialogRef.current?.showModal();
    },
  }));

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current?.close();
        }
      }}
      className="border-border-default bg-surface w-full max-w-sm rounded-lg border p-6 shadow-xl backdrop:bg-black/40"
    >
      <h2 id={titleId} className="text-text-primary text-base font-semibold">
        Mark lead lost
      </h2>
      <p className="text-text-secondary mt-2 text-sm">
        This moves the lead to the Lost stage. You can reactivate it later by moving it to another stage.
      </p>
      <div className="mt-4">
        <FormLabel htmlFor={fieldId}>Reason (optional)</FormLabel>
        <Textarea
          id={fieldId}
          rows={3}
          maxLength={LEAD_LOST_REASON_MAX_LENGTH}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="border-border-strong text-text-secondary focus-visible:ring-focus-ring rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            dialogRef.current?.close();
            onConfirm(reason);
          }}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
        >
          Mark lost
        </button>
      </div>
    </dialog>
  );
}
