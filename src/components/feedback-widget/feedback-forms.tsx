"use client";

import { useActionState, useEffect, useId, useState, type ChangeEvent } from "react";
import { usePathname } from "next/navigation";
import {
  submitBugReportAction,
  submitStaffSupportAction,
  type BugReportState,
  type StaffSupportState,
} from "@/lib/feedback-widget/actions";
import {
  BUG_ACTUAL_MAX_LENGTH,
  BUG_DESCRIPTION_MAX_LENGTH,
  BUG_DESCRIPTION_MIN_LENGTH,
  BUG_EXPECTED_MAX_LENGTH,
  BUG_STEPS_MAX_LENGTH,
  BUG_STEPS_MIN_LENGTH,
  BUG_TITLE_MAX_LENGTH,
  BUG_TITLE_MIN_LENGTH,
  FEEDBACK_SUBJECT_MAX_LENGTH,
  FEEDBACK_SUBJECT_MIN_LENGTH,
  FEEDBACK_SUPPORT_MESSAGE_MAX_LENGTH,
  FEEDBACK_SUPPORT_MESSAGE_MIN_LENGTH,
} from "@/lib/feedback-widget/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormLabel, describedByIds } from "@/components/ui/form-field";

/**
 * Authenticated Staff Feedback Widget — the two forms. Same building blocks as
 * the pre-auth support widget (Input/Textarea/FormLabel/Button, useActionState,
 * the off-screen honeypot). Nothing here supplies identity: the account and
 * workspace are shown for reassurance only and are resolved again, from the
 * session, on the server.
 */

function newSubmissionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function Honeypot({ id }: { id: string }) {
  return (
    <div aria-hidden="true" className="absolute top-auto left-[-9999px] h-0 w-0 overflow-hidden">
      <label htmlFor={id}>Leave this field blank</label>
      <input id={id} name="honeypot" type="text" tabIndex={-1} autoComplete="off" />
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-danger mt-1 text-sm">
      {message}
    </p>
  );
}

function SentNotice({ children, onAnother }: { children: React.ReactNode; onAnother: () => void }) {
  return (
    <div className="text-center">
      <p role="status" className="text-text-primary text-sm">
        {children}
      </p>
      <Button type="button" variant="secondary" className="mt-6 w-full" onClick={onAnother}>
        Send another
      </Button>
    </div>
  );
}

const INITIAL_SUPPORT: StaffSupportState = { error: null };
const INITIAL_BUG: BugReportState = { error: null };

export function SupportForm({ accountEmail, workspaceName }: { accountEmail: string; workspaceName: string }) {
  const [formKey, setFormKey] = useState(0);
  return <SupportFormInner key={formKey} accountEmail={accountEmail} workspaceName={workspaceName} onAnother={() => setFormKey((k) => k + 1)} />;
}

function SupportFormInner({ accountEmail, workspaceName, onAnother }: { accountEmail: string; workspaceName: string; onAnother: () => void }) {
  const [state, formAction, pending] = useActionState(submitStaffSupportAction, INITIAL_SUPPORT);
  const [submissionId] = useState(newSubmissionId);
  const subjectId = useId();
  const messageId = useId();
  const messageHelpId = `${messageId}-help`;
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  if (state.success) {
    return (
      <SentNotice onAnother={onAnother}>
        Your message has been sent to Aqenra Support. We&rsquo;ll reply to {accountEmail}.
      </SentNotice>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-text-muted text-xs">
        Sending as {accountEmail} &middot; {workspaceName}. We&rsquo;ll reply by email.
      </p>
      <input type="hidden" name="submissionId" value={submissionId} />
      <div>
        <FormLabel htmlFor={subjectId} required>
          Subject
        </FormLabel>
        <Input
          id={subjectId}
          name="subject"
          required
          minLength={FEEDBACK_SUBJECT_MIN_LENGTH}
          maxLength={FEEDBACK_SUBJECT_MAX_LENGTH}
          value={subject}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setSubject(event.target.value)}
          aria-invalid={Boolean(state.fieldErrors?.subject)}
          aria-describedby={describedByIds(state.fieldErrors?.subject ? `${subjectId}-error` : null)}
        />
        <FieldError id={`${subjectId}-error`} message={state.fieldErrors?.subject} />
      </div>
      <div>
        <FormLabel htmlFor={messageId} required>
          Message
        </FormLabel>
        <Textarea
          id={messageId}
          name="message"
          required
          rows={5}
          minLength={FEEDBACK_SUPPORT_MESSAGE_MIN_LENGTH}
          maxLength={FEEDBACK_SUPPORT_MESSAGE_MAX_LENGTH}
          value={message}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setMessage(event.target.value)}
          aria-invalid={Boolean(state.fieldErrors?.message)}
          aria-describedby={describedByIds(messageHelpId, state.fieldErrors?.message ? `${messageId}-error` : null)}
        />
        <p id={messageHelpId} className="text-text-muted mt-1 text-xs">
          {FEEDBACK_SUPPORT_MESSAGE_MIN_LENGTH}&ndash;{FEEDBACK_SUPPORT_MESSAGE_MAX_LENGTH} characters.
        </p>
        <FieldError id={`${messageId}-error`} message={state.fieldErrors?.message} />
      </div>
      <Honeypot id={`${messageId}-hp`} />
      <p className="text-text-muted text-xs">Please don&rsquo;t include passwords, verification codes, or other sensitive information.</p>
      {state.error && (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      )}
      <Button type="submit" loading={pending} className="w-full">
        {pending ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}

export function BugReportForm({ accountEmail, workspaceName }: { accountEmail: string; workspaceName: string }) {
  const [formKey, setFormKey] = useState(0);
  return <BugReportFormInner key={formKey} accountEmail={accountEmail} workspaceName={workspaceName} onAnother={() => setFormKey((k) => k + 1)} />;
}

function BugReportFormInner({ accountEmail, workspaceName, onAnother }: { accountEmail: string; workspaceName: string; onAnother: () => void }) {
  const [state, formAction, pending] = useActionState(submitBugReportAction, INITIAL_BUG);
  const [submissionId] = useState(newSubmissionId);
  const pathname = usePathname();
  const ids = { title: useId(), description: useId(), steps: useId(), expected: useId(), actual: useId() };
  const [values, setValues] = useState({ title: "", description: "", steps: "", expected: "", actual: "" });
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);

  // Viewport size is part of the disclosed diagnostics; kept current so the
  // hidden inputs below always carry what the disclosure text shows.
  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const set = (key: keyof typeof values) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  if (state.success) {
    return <SentNotice onAnother={onAnother}>Thanks &mdash; your bug report has been sent. We&rsquo;ll follow up at {accountEmail} if we need more detail.</SentNotice>;
  }

  const errors = state.fieldErrors;
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="submissionId" value={submissionId} />
      <input type="hidden" name="route" value={pathname ?? ""} />
      <input type="hidden" name="viewportWidth" value={viewport?.width ?? ""} />
      <input type="hidden" name="viewportHeight" value={viewport?.height ?? ""} />
      <div>
        <FormLabel htmlFor={ids.title} required>
          Short issue title
        </FormLabel>
        <Input
          id={ids.title}
          name="title"
          required
          minLength={BUG_TITLE_MIN_LENGTH}
          maxLength={BUG_TITLE_MAX_LENGTH}
          value={values.title}
          onChange={set("title")}
          aria-invalid={Boolean(errors?.title)}
          aria-describedby={describedByIds(errors?.title ? `${ids.title}-error` : null)}
        />
        <FieldError id={`${ids.title}-error`} message={errors?.title} />
      </div>
      <div>
        <FormLabel htmlFor={ids.description} required>
          What went wrong?
        </FormLabel>
        <Textarea
          id={ids.description}
          name="description"
          required
          rows={3}
          minLength={BUG_DESCRIPTION_MIN_LENGTH}
          maxLength={BUG_DESCRIPTION_MAX_LENGTH}
          value={values.description}
          onChange={set("description")}
          aria-invalid={Boolean(errors?.description)}
          aria-describedby={describedByIds(errors?.description ? `${ids.description}-error` : null)}
        />
        <FieldError id={`${ids.description}-error`} message={errors?.description} />
      </div>
      <div>
        <FormLabel htmlFor={ids.steps} required>
          Steps to reproduce
        </FormLabel>
        <Textarea
          id={ids.steps}
          name="steps"
          required
          rows={3}
          minLength={BUG_STEPS_MIN_LENGTH}
          maxLength={BUG_STEPS_MAX_LENGTH}
          value={values.steps}
          onChange={set("steps")}
          aria-invalid={Boolean(errors?.steps)}
          aria-describedby={describedByIds(errors?.steps ? `${ids.steps}-error` : null)}
        />
        <FieldError id={`${ids.steps}-error`} message={errors?.steps} />
      </div>
      <div>
        <FormLabel htmlFor={ids.expected}>Expected behavior (optional)</FormLabel>
        <Textarea
          id={ids.expected}
          name="expected"
          rows={2}
          maxLength={BUG_EXPECTED_MAX_LENGTH}
          value={values.expected}
          onChange={set("expected")}
          aria-invalid={Boolean(errors?.expected)}
          aria-describedby={describedByIds(errors?.expected ? `${ids.expected}-error` : null)}
        />
        <FieldError id={`${ids.expected}-error`} message={errors?.expected} />
      </div>
      <div>
        <FormLabel htmlFor={ids.actual}>Actual behavior (optional)</FormLabel>
        <Textarea
          id={ids.actual}
          name="actual"
          rows={2}
          maxLength={BUG_ACTUAL_MAX_LENGTH}
          value={values.actual}
          onChange={set("actual")}
          aria-invalid={Boolean(errors?.actual)}
          aria-describedby={describedByIds(errors?.actual ? `${ids.actual}-error` : null)}
        />
        <FieldError id={`${ids.actual}-error`} message={errors?.actual} />
      </div>
      <Honeypot id={`${ids.title}-hp`} />
      <div className="border-border-default bg-surface-recessed text-text-secondary rounded-md border p-3 text-xs">
        <p className="text-text-primary font-medium">What we send with your report</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>
            This page&rsquo;s path: <span className="text-text-primary break-all">{pathname ?? "(unavailable)"}</span> (never its search terms or contents)
          </li>
          <li>The time you send it</li>
          <li>
            Your browser and device details{viewport ? ` and screen size (${viewport.width} × ${viewport.height})` : ""}
          </li>
          <li>
            Your account email ({accountEmail}) and workspace ({workspaceName}), so we can follow up
          </li>
        </ul>
        <p className="mt-2">
          We never include passwords, cookies, session tokens, what you&rsquo;ve typed into forms, or your customers&rsquo; data.
        </p>
      </div>
      {state.error && (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      )}
      <Button type="submit" loading={pending} className="w-full">
        {pending ? "Sending…" : "Send bug report"}
      </Button>
    </form>
  );
}
