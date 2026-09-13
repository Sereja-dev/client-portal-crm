"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormLabel } from "@/components/ui/form-field";
import { COMMENT_BODY_MAX_LENGTH } from "@/lib/comments/validate-body";
import { callActionWithStaleRecovery } from "@/lib/action-error";
import type { ClientRequestMessageFormState } from "@/types";

const initialState: ClientRequestMessageFormState = { error: null };

/**
 * Client Requests / Tickets Phase 2A — simplified mirror of
 * comments/comment-composer.tsx: plain textarea + Send, useActionState,
 * server-side validation (validateCommentBody, reused as-is by
 * messages.ts) is the actual source of truth. No mentions, no edit mode
 * (messages are immutable — this composer is only ever used for "new
 * message", never reused for editing).
 *
 * Shared between Staff (app/(dashboard)/requests/[id]/page.tsx) and
 * Portal (app/portal/(app)/requests/[id]/page.tsx) — both callers'
 * actions resolve to the exact same ClientRequestMessageFormState shape,
 * so wrapping the submitted action in callActionWithStaleRecovery
 * (src/lib/action-error.ts) here benefits both identically rather than
 * forking this component. Same stale-deployment-recovery treatment
 * note-composer.tsx already gives Timeline's own composer.
 */
export function MessageComposer({
  action,
}: {
  action: (prevState: ClientRequestMessageFormState, formData: FormData) => Promise<ClientRequestMessageFormState>;
}) {
  const [state, formAction, pending] = useActionState(
    (prevState: ClientRequestMessageFormState, formData: FormData) => callActionWithStaleRecovery(() => action(prevState, formData)),
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);
  const bodyFieldId = useId();

  useEffect(() => {
    if (wasPending.current && !pending && state.error === null) {
      formRef.current?.reset();
    }
    wasPending.current = pending;
  }, [pending, state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <FormLabel htmlFor={bodyFieldId}>Add a message</FormLabel>
      <Textarea
        id={bodyFieldId}
        name="body"
        rows={3}
        maxLength={COMMENT_BODY_MAX_LENGTH}
        required
        aria-invalid={!!state.error}
        aria-describedby={state.error ? `${bodyFieldId}-error` : undefined}
      />

      {state.error && (
        <p id={`${bodyFieldId}-error`} role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      )}

      <Button type="submit" loading={pending}>
        {pending ? "Sending…" : "Send"}
      </Button>
    </form>
  );
}
