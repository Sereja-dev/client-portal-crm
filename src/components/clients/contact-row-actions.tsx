"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/toast/toast-provider";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { ContactFormDialog } from "./contact-form-dialog";
import type { ContactFormDefaults } from "./contact-form";
import type { ClientContactFormState } from "@/types";

/** Multiple Contacts Phase 2 — small semantic badges, same visual language as StatusBadge's own tone pairs (a subtle-background + readable-foreground token pair, never a literal color), but not routed through STATUS_TONES itself: Primary/Billing aren't a status enum value, just a boolean flag each contact either has or doesn't. */
export function PrimaryBadge() {
  return (
    <span className="bg-success-subtle text-success inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
      Primary
    </span>
  );
}

export function BillingBadge() {
  return (
    <span className="bg-info-subtle text-info inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
      Billing
    </span>
  );
}

export function EditContactButton({
  action,
  defaultValues,
  isPrimaryContact,
}: {
  action: (
    prevState: ClientContactFormState,
    formData: FormData,
  ) => Promise<ClientContactFormState>;
  defaultValues: ContactFormDefaults;
  isPrimaryContact: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className={ACTION_LINK_CLASSES}
      >
        Edit
      </button>
      <ContactFormDialog
        dialogRef={dialogRef}
        title="Edit contact"
        mode="edit"
        action={action}
        defaultValues={defaultValues}
        isPrimaryContact={isPrimaryContact}
      />
    </>
  );
}

export function SetPrimaryButton({
  action,
  contactName,
}: {
  /** A bound, zero-argument server action (setPrimaryContactAction.bind(null, clientId, contactId)). */
  action: () => Promise<void>;
  contactName: string;
}) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await action();
      showToast(`${contactName} is now the primary contact`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Failed to set ${contactName} as primary.`, "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={handleClick}
      className={`${ACTION_LINK_CLASSES} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      Set primary
    </button>
  );
}

export function ArchiveContactButton({
  action,
  contactName,
  isPrimaryContact,
}: {
  /** A bound, zero-argument server action (archiveContactAction.bind(null, contactId, clientId)). */
  action: () => Promise<void>;
  contactName: string;
  isPrimaryContact: boolean;
}) {
  const dialogRef = useRef<ConfirmDialogHandle>(null);
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await action();
      showToast(`${contactName} archived`);
    } catch {
      showToast(`Failed to archive ${contactName}.`, "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => dialogRef.current?.open()}
        className="text-danger focus-visible:ring-danger rounded text-sm font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Archive
      </button>
      <ConfirmDialog
        ref={dialogRef}
        title="Archive contact"
        description={
          isPrimaryContact
            ? `Archive ${contactName}? They're hidden from the active list, but the record is retained. This client will temporarily have no primary contact until you set a new one.`
            : `Archive ${contactName}? They're hidden from the active list, but the record is retained.`
        }
        confirmLabel="Archive"
        destructive
        onConfirm={handleConfirm}
      />
    </>
  );
}

export function UnarchiveContactButton({
  action,
  contactName,
}: {
  /** A bound, zero-argument server action (unarchiveContactAction.bind(null, contactId, clientId)). */
  action: () => Promise<void>;
  contactName: string;
}) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await action();
      // Deliberately not "made primary" — unarchiving never restores
      // primary status (see unarchiveClientContact's own comment).
      showToast(`${contactName} restored to active contacts`);
    } catch {
      showToast(`Failed to restore ${contactName}.`, "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={handleClick}
      className={`${ACTION_LINK_CLASSES} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      Unarchive
    </button>
  );
}
