"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { InviteAcceptState } from "@/types";

const initialState: InviteAcceptState = { error: null };

export function AcceptInvitationForm({
  action,
}: {
  /** A bound, zero-argument server action (acceptInvitationAction.bind(null, token)). */
  action: () => Promise<InviteAcceptState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction}>
      {state.error && (
        <p role="alert" className="text-danger mb-3 text-sm">
          {state.error}
        </p>
      )}
      <Button type="submit" loading={pending} className="w-full">
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
    </form>
  );
}
