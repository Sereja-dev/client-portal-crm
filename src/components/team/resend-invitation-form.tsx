"use client";

import { useActionState } from "react";
import { CopyLinkButton } from "./copy-link-button";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import type { InvitationFormState } from "@/types";

const initialState: InvitationFormState = { error: null };

export function ResendInvitationForm({
  action,
  initialToken,
  initialExpired,
}: {
  action: (
    prevState: InvitationFormState,
    formData: FormData,
  ) => Promise<InvitationFormState>;
  initialToken: string;
  /**
   * Team expired-invitation UX remediation. Server-computed once by the
   * Server Component parent (isInvitationExpired(invitation.expiresAt,
   * now) — never Date.now() in this client component, which would risk
   * disagreeing with the server's own value and double as a hydration
   * mismatch). A successful resend always issues a fresh future
   * expiresAt, so the same `state.token` presence that already signals
   * "a resend just succeeded" (see the token fallback immediately below)
   * doubles as the signal that the row is no longer expired — exactly
   * the same established pattern, extended to a second field, not a new
   * one.
   */
  initialExpired: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  // Copy must always reflect the latest token — once a resend succeeds,
  // state.token holds the fresh one; until then it falls back to the prop.
  const token = state.token ?? initialToken;
  const expired = state.token ? false : initialExpired;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-3">
        {!expired && <CopyLinkButton token={token} />}
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
        <p role="alert" className="text-danger text-xs">
          {state.error}
        </p>
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
