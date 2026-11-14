"use client";

import { useActionState, useRef, useState } from "react";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/toast/toast-provider";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { PortalCopyLinkButton } from "./portal-copy-link-button";
import type { PortalInvitationFormState } from "@/types";
import { FormErrorMessage } from "@/components/ui/form-field";

const initialState: PortalInvitationFormState = { error: null };

export function ResendPortalInvitationForm({
  action,
  initialToken,
}: {
  action: (
    prevState: PortalInvitationFormState,
    formData: FormData,
  ) => Promise<PortalInvitationFormState>;
  initialToken: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  // Copy must always reflect the latest token — once a resend succeeds,
  // state.token holds the fresh one; until then it falls back to the prop.
  const token = state.token ?? initialToken;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-3">
        <PortalCopyLinkButton token={token} />
        <form action={formAction}>
          <button
            type="submit"
            disabled={pending}
            className={`${ACTION_LINK_CLASSES} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {pending ? "Resending…" : "Resend"}
          </button>
        </form>
      </div>
      {state.error && (
        <FormErrorMessage className="text-xs">
          {state.error}
        </FormErrorMessage>
      )}
      {state.message && !state.error && (
        <p
          role="status"
          className={`text-xs ${state.emailFailed ? "text-warning" : "text-success"}`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}

export function CancelPortalInvitationButton({
  action,
  email,
}: {
  /** A bound, zero-argument server action (cancelClientInvitationAction.bind(null, id)). */
  action: () => Promise<void>;
  email: string;
}) {
  const dialogRef = useRef<ConfirmDialogHandle>(null);
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await action();
      showToast("Invitation canceled");
    } catch {
      showToast(`Failed to cancel the invitation for ${email}.`, "error");
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
        Cancel
      </button>
      <ConfirmDialog
        ref={dialogRef}
        title="Cancel invitation"
        description={`Cancel the client portal invitation for ${email}? They won't be able to use this link to sign in.`}
        confirmLabel="Cancel invitation"
        destructive
        onConfirm={handleConfirm}
      />
    </>
  );
}

export function RemovePortalUserButton({
  action,
  portalUserName,
}: {
  /** A bound, zero-argument server action (removePortalUserAction.bind(null, id)). */
  action: () => Promise<void>;
  portalUserName: string;
}) {
  const dialogRef = useRef<ConfirmDialogHandle>(null);
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await action();
      showToast(`${portalUserName}'s portal access removed`);
    } catch {
      showToast(`Failed to remove ${portalUserName}'s portal access.`, "error");
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
        Remove access
      </button>
      <ConfirmDialog
        ref={dialogRef}
        title="Remove portal access"
        description={`Remove ${portalUserName}'s access to the client portal? They will lose access immediately.`}
        confirmLabel="Remove access"
        destructive
        onConfirm={handleConfirm}
      />
    </>
  );
}
