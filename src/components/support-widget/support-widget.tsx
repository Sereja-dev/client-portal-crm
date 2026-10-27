"use client";

import { useActionState, useId, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { submitSupportMessageAction, type SupportMessageSubmissionState } from "@/lib/support-widget/actions";
import {
  SUPPORT_ISSUE_TYPES,
  SUPPORT_ISSUE_TYPE_LABELS,
  SUPPORT_MESSAGE_MAX_LENGTH,
  SUPPORT_MESSAGE_MIN_LENGTH,
  SUPPORT_EMAIL_MAX_LENGTH,
} from "@/lib/support-widget/validation";
import { DialogShell, DialogTitle, DialogDescription } from "@/components/ui/dialog-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormLabel, describedByIds } from "@/components/ui/form-field";
import { SupportIcon, CloseIcon } from "@/components/ui/icons";

const INITIAL_STATE: SupportMessageSubmissionState = { error: null };

/**
 * Pre-Auth Support Widget V1, Slice C. The form itself — kept as its own
 * component (not inlined in SupportWidget below) specifically so it can
 * be remounted fresh via `key` every time the dialog opens (see
 * SupportWidget's own `resetKey`), without needing a bespoke "reset"
 * API on useActionState, which doesn't offer one. A fresh mount means a
 * fresh `useActionState` call with its own real initial state — no
 * stale success/error/field-error carried over from a previous open.
 *
 * Field conventions (labels, manual role="alert" error paragraphs)
 * deliberately match LoginForm/SignupForm's own existing pattern on
 * this exact page, not FormField's richer wrapper — visual/structural
 * consistency with the two forms this widget's dialog sits alongside.
 */
function SupportWidgetForm({ onClose }: { onClose: () => void }) {
  const [state, formAction, pending] = useActionState(submitSupportMessageAction, INITIAL_STATE);
  const emailId = useId();
  const issueTypeId = useId();
  const messageId = useId();
  const messageDescriptionId = `${messageId}-description`;

  // Controlled, not uncontrolled: React's own <form action={fn}> handling
  // resets uncontrolled fields once the action settles — on success AND
  // on failure — which would otherwise silently violate "preserve the
  // entered form data and allow retry" on every rejected submission
  // (confirmed by direct reproduction before this fix: a validation
  // failure or a NOT_CONFIGURED failure both cleared every field).
  // Owning each value in React state, independent of the action's own
  // lifecycle, is what actually keeps it intact across a failed submit.
  const [email, setEmail] = useState("");
  const [issueType, setIssueType] = useState("");
  const [message, setMessage] = useState("");

  if (state.success) {
    return (
      <div className="text-center">
        <p role="status" className="text-sm text-text-primary">
          Your message has been sent. We&rsquo;ll reply to your email.
        </p>
        <Button type="button" variant="secondary" className="mt-6 w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <FormLabel htmlFor={emailId} required>
          Email address
        </FormLabel>
        <Input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          maxLength={SUPPORT_EMAIL_MAX_LENGTH}
          value={email}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby={describedByIds(state.fieldErrors?.email ? `${emailId}-error` : null)}
        />
        {state.fieldErrors?.email && (
          <p id={`${emailId}-error`} role="alert" className="text-danger mt-1 text-sm">
            {state.fieldErrors.email}
          </p>
        )}
      </div>

      <div>
        <FormLabel htmlFor={issueTypeId} required>
          Issue type
        </FormLabel>
        <Select
          id={issueTypeId}
          name="issueType"
          required
          value={issueType}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => setIssueType(event.target.value)}
          aria-invalid={Boolean(state.fieldErrors?.issueType)}
          aria-describedby={describedByIds(state.fieldErrors?.issueType ? `${issueTypeId}-error` : null)}
        >
          <option value="" disabled>
            Select an issue&hellip;
          </option>
          {SUPPORT_ISSUE_TYPES.map((value) => (
            <option key={value} value={value}>
              {SUPPORT_ISSUE_TYPE_LABELS[value]}
            </option>
          ))}
        </Select>
        {state.fieldErrors?.issueType && (
          <p id={`${issueTypeId}-error`} role="alert" className="text-danger mt-1 text-sm">
            {state.fieldErrors.issueType}
          </p>
        )}
      </div>

      <div>
        <FormLabel htmlFor={messageId} required>
          Message
        </FormLabel>
        <Textarea
          id={messageId}
          name="message"
          required
          rows={4}
          minLength={SUPPORT_MESSAGE_MIN_LENGTH}
          maxLength={SUPPORT_MESSAGE_MAX_LENGTH}
          value={message}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setMessage(event.target.value)}
          aria-invalid={Boolean(state.fieldErrors?.message)}
          aria-describedby={describedByIds(messageDescriptionId, state.fieldErrors?.message ? `${messageId}-error` : null)}
        />
        <p id={messageDescriptionId} className="text-text-muted mt-1 text-xs">
          Please describe your issue in {SUPPORT_MESSAGE_MIN_LENGTH}&ndash;{SUPPORT_MESSAGE_MAX_LENGTH} characters.
        </p>
        {state.fieldErrors?.message && (
          <p id={`${messageId}-error`} role="alert" className="text-danger mt-1 text-sm">
            {state.fieldErrors.message}
          </p>
        )}
      </div>

      {/*
        Honeypot — matches Slice B's exact Server Action contract
        (formData.get("honeypot"); src/lib/support-widget/actions.ts).
        Visually hidden off-screen (never display:none/visibility:hidden,
        a pattern some bots specifically detect and skip) and removed
        from both tab order and the accessibility tree, so no real
        visitor using a keyboard or screen reader ever encounters it.
      */}
      <div aria-hidden="true" className="absolute top-auto left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="support-widget-honeypot">Leave this field blank</label>
        <input id="support-widget-honeypot" name="honeypot" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <p className="text-text-muted text-xs">
        Please don&rsquo;t include passwords, verification codes, or other sensitive information.
      </p>

      {state.error && (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      )}

      <Button type="submit" loading={pending} className="w-full">
        {pending ? "Sending…" : "Send message"}
      </Button>

      <p className="text-text-muted text-center text-xs">
        We&rsquo;ll reply to the email address you provide. See our{" "}
        <Link href="/privacy" className="text-text-secondary hover:text-text-primary underline">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}

/**
 * Pre-Auth Support Widget V1, Slice C. Self-contained: owns the
 * floating trigger and the native `<dialog>` together, so mounting one
 * `<SupportWidget />` is the entire integration surface — see
 * auth-shell.tsx's own `showSupportWidget` prop, its only caller.
 *
 * This is asynchronous email support, never live chat: no online/
 * offline indicator, no unread badge, no message history, no
 * real-time connection of any kind — a single form, one submission,
 * one confirmation.
 */
export function SupportWidget() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Incremented each time the dialog opens, and passed as SupportWidgetForm's
  // own `key` below — forces a fresh mount (and therefore a fresh
  // useActionState call, with no stale success/error/field-error from a
  // previous open) every time, since useActionState itself exposes no
  // imperative "reset" of its own.
  const [resetKey, setResetKey] = useState(0);
  const titleId = useId();
  const descriptionId = useId();

  const handleClose = () => dialogRef.current?.close();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setResetKey((key) => key + 1);
          dialogRef.current?.showModal();
        }}
        aria-label="Contact Aqenra Support"
        // `bottom-24` (not the more typical bottom-4/6) is deliberate,
        // measured against this exact page's real content: AuthShell's
        // own footer sits at the natural bottom of a min-h-screen
        // layout, and on these short-content pages (login/signup) it
        // routinely lands within the viewport even on common mobile and
        // desktop heights — confirmed empirically to collide with a
        // smaller offset at 320/375/390x and even 1280x900. 6rem clears
        // the footer's own measured ~77px height with margin to spare,
        // at every required viewport, re-verified after this change.
        className="focus-visible:ring-focus-ring fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-[var(--aqenra-shadow-lg)] transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 sm:right-6"
      >
        <SupportIcon className="h-6 w-6" />
      </button>

      {/*
        Native <dialog> via the existing DialogShell — modal focus
        trapping, Escape-to-close, and focus-return-to-trigger on close
        are all provided by the browser itself (see DialogShell's own
        doc comment and ConfirmDialog's identical reliance on the same
        guarantees) — none of that is reimplemented here. Backdrop-click-
        to-close mirrors ConfirmDialog's own exact pattern: DialogShell
        itself is presentational only and owns no such behavior.
      */}
      <DialogShell
        ref={dialogRef}
        maxWidth="md"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(event) => {
          if (event.target === dialogRef.current) {
            handleClose();
          }
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <DialogTitle id={titleId}>Aqenra Support</DialogTitle>
            <DialogDescription id={descriptionId}>
              Having trouble signing up or signing in? Send us a message and we&rsquo;ll reply by email.
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="focus-visible:ring-focus-ring text-text-muted hover:text-text-primary shrink-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 max-h-[60vh] overflow-y-auto">
          <SupportWidgetForm key={resetKey} onClose={handleClose} />
        </div>
      </DialogShell>
    </>
  );
}
