"use client";

import { useId, type RefObject } from "react";
import { DIALOG_CENTER_CLASSES } from "@/components/ui/dialog-classes";
import { ContactForm, type ContactFormDefaults } from "./contact-form";
import type { ClientContactFormState } from "@/types";

/**
 * Multiple Contacts Phase 2 (Staff UI). A form-holding sibling of
 * ConfirmDialog (src/components/ui/confirm-dialog.tsx) — same native
 * `<dialog>` + DIALOG_CENTER_CLASSES foundation (modal focus trapping,
 * Escape-to-close, backdrop all from the browser, no extra dependency).
 * Deliberately presentational only, no imperative handle of its own —
 * every caller (add-contact-button.tsx, edit-contact-button.tsx) owns its
 * trigger button and dialogRef together in one place, the exact same
 * shape RemovePortalUserButton/CancelPortalInvitationButton already
 * establish (src/components/client-portal/portal-invitation-actions.tsx)
 * — never a separately reusable "smart" dialog that has to coordinate
 * with a trigger living in a different component. Slightly wider
 * (max-w-md, not ConfirmDialog's max-w-sm) to comfortably fit four text
 * fields plus two checkboxes. Closes itself automatically on a successful
 * submit (ContactForm's own onSuccess callback) — never on a validation
 * error, so the visitor doesn't lose their in-progress input.
 */
export function ContactFormDialog({
  dialogRef,
  title,
  mode,
  action,
  defaultValues,
  isPrimaryContact,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  title: string;
  mode: "add" | "edit";
  action: (
    prevState: ClientContactFormState,
    formData: FormData,
  ) => Promise<ClientContactFormState>;
  defaultValues?: ContactFormDefaults;
  isPrimaryContact?: boolean;
}) {
  const titleId = useId();

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
          {title}
        </h2>
        <button
          type="button"
          onClick={(event) => (event.currentTarget.closest("dialog") as HTMLDialogElement | null)?.close()}
          aria-label="Close"
          className="text-text-muted focus-visible:ring-focus-ring rounded p-1 hover:text-text-secondary focus:outline-none focus-visible:ring-2"
        >
          ✕
        </button>
      </div>
      <ContactForm
        mode={mode}
        action={action}
        defaultValues={defaultValues}
        isPrimaryContact={isPrimaryContact}
        onSuccess={() => dialogRef.current?.close()}
      />
    </dialog>
  );
}
