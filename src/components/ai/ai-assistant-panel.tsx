"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CloseIcon, CheckIcon } from "@/components/ui/icons";
import { askAiAssistant, getAiAssistantErrorCopy } from "@/lib/ai/client";

export type AiAssistantPanelHandle = {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
};

/** Mirrors src/lib/ai/orchestration-limits.ts's own MAX_USER_MESSAGE_CHARS — a UI convenience only (see this component's own doc comment below), never the source of truth. */
const MAX_MESSAGE_CHARS = 2000;
/** The counter is only shown once a question is getting close to the limit — see this batch's own "do not clutter ordinary short questions" requirement. */
const CHAR_COUNTER_THRESHOLD = MAX_MESSAGE_CHARS - 200;
const COPIED_RESET_MS = 2000;

/** Capability-matched to exactly the six registered read-only tools — never a mutation-shaped suggestion (see tools/registry.ts, unchanged by this batch). */
const SUGGESTED_PROMPTS = [
  "Which clients were added recently?",
  "What tasks are due soon?",
  "Show me overdue invoices.",
  "Summarize my organization.",
] as const;

type Phase = "idle" | "submitting" | "success" | "error";

/**
 * AI Assistant staff drawer/UI batch. A native `<dialog>`-based panel —
 * mirrors search-dialog.tsx/confirm-dialog.tsx's own established shape
 * exactly (free focus trap, free Escape-to-close, free backdrop-click-to-
 * close, free focus-return-to-invoker, all from the HTML spec, zero extra
 * dependency), styled as a right-side panel at `md:` and up and a
 * full-screen sheet below it via responsive classes alone — not a second,
 * separately-built "Drawer" primitive.
 *
 * Single-turn only, by construction: `question`/`answer`/`errorMessage`
 * hold exactly ONE turn's own state, never a list/transcript. "Ask
 * another question" and closing the dialog are the only two ways back to
 * `idle`, and both fully discard the prior turn — there is no code path
 * that keeps a second turn's worth of state alive at once, matching the
 * backend's own single-turn contract (POST /api/ai/assistant never
 * receives or returns anything history-shaped).
 *
 * This file imports nothing from src/lib/ai/ except
 * ./client.ts's own askAiAssistant()/getAiAssistantErrorCopy() (a plain
 * fetch() wrapper with its own hand-written wire types — never
 * orchestrate.ts, providers/**, request-context.ts, or tools/**). See
 * this batch's own "client/server import boundary" requirement, and
 * scripts/security-checks/check-ai-assistant-security.mjs's own new
 * rules enforcing it mechanically.
 */
export function AiAssistantPanel({ ref }: { ref?: Ref<AiAssistantPanelHandle> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const counterId = useId();
  const errorId = useId();

  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [question, setQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // AbortController/generation pair — a fresh controller per submit, and
  // a monotonically-incrementing generation counter so a response that
  // arrives after a NEWER request has already started (or after the
  // panel was reset) is silently ignored rather than clobbering more
  // current state. See this batch's own "stale response ignored"
  // requirement.
  const abortControllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearCopiedTimeout() {
    if (copiedTimeoutRef.current) {
      clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = null;
    }
  }

  /**
   * The one reset path — reached both from the dialog's own native
   * `close` event (whether triggered by Escape, backdrop click, or the
   * explicit close button) and from unmount. Aborting any in-flight
   * request here, unconditionally, is what makes "close while a request
   * is pending" always safe and never leaves a stray fetch running
   * against unmounted state.
   */
  function resetState() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    generationRef.current += 1;
    clearCopiedTimeout();
    setDraft("");
    setPhase("idle");
    setQuestion(null);
    setAnswer(null);
    setErrorMessage(null);
    setCopied(false);
  }

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      clearCopiedTimeout();
    };
  }, []);

  useImperativeHandle(ref, () => ({
    open: () => {
      dialogRef.current?.showModal();
      // showModal() itself doesn't move focus into the dialog's own
      // content on every browser — explicitly focusing the textarea
      // matches search-dialog.tsx's own identical precedent.
      textareaRef.current?.focus();
    },
    close: () => dialogRef.current?.close(),
    isOpen: () => dialogRef.current?.open ?? false,
  }));

  async function submit() {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || phase === "submitting") return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const generation = ++generationRef.current;

    setPhase("submitting");
    setQuestion(trimmed);
    setDraft("");
    setAnswer(null);
    setErrorMessage(null);
    setCopied(false);

    try {
      const result = await askAiAssistant(trimmed, controller.signal);
      if (generationRef.current !== generation) return; // superseded by a newer request or a reset — ignore
      if (result.ok) {
        setPhase("success");
        setAnswer(result.answer);
      } else {
        setPhase("error");
        setErrorMessage(getAiAssistantErrorCopy(result.status));
      }
    } catch (error) {
      // A deliberate cancellation (close/unmount/a newer submit) must
      // never render as an error — see this batch's own "aborted request
      // handling" requirement.
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      if (generationRef.current !== generation) return;
      setPhase("error");
      setErrorMessage(getAiAssistantErrorCopy(0));
    } finally {
      if (generationRef.current === generation) {
        abortControllerRef.current = null;
      }
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
    // Shift+Enter: default textarea newline behavior, left untouched.
    // Escape is deliberately never handled here — it must reach the
    // native <dialog>'s own cancel/close handling unimpeded.
  }

  function askAnotherQuestion() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    generationRef.current += 1;
    clearCopiedTimeout();
    setDraft("");
    setPhase("idle");
    setQuestion(null);
    setAnswer(null);
    setErrorMessage(null);
    setCopied(false);
    // Deferred a tick so the composer has actually mounted (it's
    // conditionally rendered only in the idle phase) before focus is
    // requested — mirrors notification-bell.tsx's own established
    // "defer past this render's own DOM update" pattern.
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  async function handleCopy() {
    if (!answer) return;
    try {
      await navigator.clipboard.writeText(answer);
      setCopied(true);
      clearCopiedTimeout();
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      // Clipboard permission/availability failure — never logged, never
      // surfaced as a hard error; the control simply stays in its normal
      // (non-"Copied") state.
    }
  }

  const showCounter = draft.length > CHAR_COUNTER_THRESHOLD;
  const canSubmit = draft.trim().length > 0;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={resetState}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current?.close();
        }
      }}
      // Mobile-first: full-bleed, no border/radius, h-dvh (not 100vh, so
      // mobile browser chrome/keyboard never clips content). At `md:`
      // and up: a right-anchored panel — max-w-md wide, full height,
      // never layout-pushing (an overlay, exactly like search-dialog.tsx).
      //
      // `open:flex`/`open:flex-col` — NOT a bare `flex`/`flex-col` — is
      // load-bearing, not stylistic: search-dialog.tsx/confirm-dialog.tsx
      // never set `display` at all on their own <dialog>, relying entirely
      // on the browser's own `dialog:not([open]) { display: none; }` UA
      // rule. This dialog genuinely needs `display: flex` for its own
      // internal header/body/footer column layout once open — but setting
      // that unconditionally (a real bug, caught by this batch's own E2E
      // suite: a "closed" dialog with `display: flex` is still full-size
      // and covers/intercepts clicks on whatever is behind it, including
      // its own trigger) would override that UA rule, since a class
      // selector's specificity beats the UA stylesheet's type selector.
      // Tailwind v4's own `open:` variant (targeting `&[open]`) is exactly
      // the fix: the flex layout only ever applies once `showModal()` has
      // actually set the `open` attribute.
      className="border-border-default bg-surface m-0 h-dvh max-h-none w-full max-w-none border-0 p-0 shadow-xl open:flex open:flex-col backdrop:bg-black/40 md:inset-y-0 md:left-auto md:ml-auto md:h-dvh md:max-h-dvh md:w-full md:max-w-md md:border-l"
    >
      <div className="border-border-default flex shrink-0 items-center justify-between border-b px-4 py-3">
        <h2 id={titleId} className="text-text-primary text-base font-semibold">
          AI Assistant
        </h2>
        <button
          type="button"
          aria-label="Close AI Assistant"
          onClick={() => dialogRef.current?.close()}
          className="text-text-secondary focus-visible:ring-focus-ring rounded-md p-1.5 transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
        {phase === "idle" && (
          <div className="flex flex-col gap-4">
            <p className="text-text-secondary text-sm">Ask about your organization&rsquo;s clients, projects, tasks, or invoices.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setDraft(prompt)}
                  className="border-border-strong text-text-secondary focus-visible:ring-focus-ring rounded-full border px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {phase !== "idle" && question && (
          <div className="flex flex-col gap-4">
            <p className="text-text-primary text-sm font-medium">{question}</p>

            {phase === "submitting" && (
              <p role="status" aria-live="polite" className="text-text-secondary text-sm">
                Thinking…
              </p>
            )}

            {phase === "success" && answer && (
              <div className="border-border-default bg-surface-muted rounded-lg border p-3">
                <p className="text-text-primary text-sm whitespace-pre-wrap">{answer}</p>
              </div>
            )}

            {phase === "error" && errorMessage && (
              <p id={errorId} role="alert" className="text-danger text-sm">
                {errorMessage}
              </p>
            )}

            {phase === "success" && (
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => void handleCopy()}>
                  {copied ? (
                    <>
                      <CheckIcon className="h-4 w-4" />
                      Copied
                    </>
                  ) : (
                    "Copy"
                  )}
                </Button>
                <Button type="button" variant="secondary" onClick={askAnotherQuestion}>
                  Ask another question
                </Button>
              </div>
            )}

            {phase === "error" && (
              <Button type="button" variant="secondary" onClick={askAnotherQuestion}>
                Ask another question
              </Button>
            )}
          </div>
        )}
      </div>

      {phase === "idle" && (
        <div className="border-border-default shrink-0 border-t px-4 py-3">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder="Ask a question…"
            enterKeyHint="send"
            rows={3}
            aria-describedby={showCounter ? counterId : undefined}
            className="mt-0 resize-none"
          />
          <div className="mt-2 flex items-center justify-between">
            {showCounter ? (
              <span id={counterId} className="text-text-muted text-xs">
                {draft.length} / {MAX_MESSAGE_CHARS}
              </span>
            ) : (
              <span />
            )}
            <Button type="button" variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
              Ask
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
