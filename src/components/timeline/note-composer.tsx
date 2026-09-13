"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormLabel } from "@/components/ui/form-field";
import { COMMENT_BODY_MAX_LENGTH } from "@/lib/comments/validate-body";
import { callActionWithStaleRecovery } from "@/lib/action-error";
import type { TimelineNoteActionState } from "@/types";

const initialState: TimelineNoteActionState = { error: null };

/**
 * Communication Timeline Phase 2 — the one composer, reused for both
 * "add a note" and "edit this note" (the same "one composer textarea,
 * not a second form" choice src/components/comments/comment-composer.tsx's
 * own doc comment already established for the equivalent Comments case).
 * Plain multi-line textarea + submit button + useActionState; server-side
 * validation (src/lib/comments/validate-body.ts, reused as-is by
 * createTimelineNote/editTimelineNote) remains the actual source of
 * truth — the displayed character count and native `maxLength` are UX
 * conveniences only, never authorization.
 *
 * The submitted action is wrapped in callActionWithStaleRecovery
 * (src/lib/action-error.ts) — the same Dashboard-navigation-hardening
 * treatment every other useActionState-driven form in this app now gets,
 * so a stale-deployment Server Action failure surfaces as this form's own
 * inline error banner rather than an uncaught exception.
 */
export function NoteComposer({
  action,
  initialBody = "",
  submitLabel = "Add note",
  pendingLabel = "Adding…",
  cancelLabel = "Cancel",
  onCancel,
  onSuccess,
  autoFocus = false,
}: {
  action: (prevState: TimelineNoteActionState, formData: FormData) => Promise<TimelineNoteActionState>;
  initialBody?: string;
  submitLabel?: string;
  pendingLabel?: string;
  cancelLabel?: string;
  /** Rendering a Cancel button (edit mode) also means "don't clear the form on success" — the parent unmounts this composer instead. */
  onCancel?: () => void;
  onSuccess?: () => void;
  autoFocus?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    (prevState: TimelineNoteActionState, formData: FormData) => callActionWithStaleRecovery(() => action(prevState, formData)),
    initialState,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);
  const [length, setLength] = useState(initialBody.length);
  // Unique per composer instance — this component renders more than once
  // at a time on a page (the top-level "add note" composer plus any note
  // currently being edited inline), so a fixed literal id would produce
  // duplicate ids/duplicate-labeled fields in the same document.
  const bodyFieldId = useId();

  useEffect(() => {
    if (wasPending.current && !pending && state.error === null) {
      if (!onCancel) {
        formRef.current?.reset();
        // Routes the length update through the textarea's own onChange
        // handler (a real event, not a setState call inside this effect
        // body) — .reset() doesn't fire a native input/change event on
        // its own. Mirrors CommentComposer's own identical precedent.
        textareaRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
      }
      onSuccess?.();
    }
    wasPending.current = pending;
  }, [pending, state, onCancel, onSuccess]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <FormLabel htmlFor={bodyFieldId}>Note</FormLabel>
      <Textarea
        ref={textareaRef}
        id={bodyFieldId}
        name="body"
        rows={3}
        defaultValue={initialBody}
        maxLength={COMMENT_BODY_MAX_LENGTH}
        required
        autoFocus={autoFocus}
        onChange={(event) => setLength(event.target.value.length)}
        aria-invalid={!!state.error}
        aria-describedby={`${bodyFieldId}-char-count${state.error ? ` ${bodyFieldId}-error` : ""}`}
      />

      <p id={`${bodyFieldId}-char-count`} className="text-text-muted text-right text-xs">
        {length} / {COMMENT_BODY_MAX_LENGTH}
      </p>

      {state.error && (
        <p id={`${bodyFieldId}-error`} role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
        )}
      </div>
    </form>
  );
}
