"use client";

import { useId, useImperativeHandle, useRef, type ReactNode, type Ref } from "react";
import { Button } from "./button";
import { DialogShell, DialogTitle, DialogDescription, DialogActions } from "./dialog-shell";

export type ConfirmDialogHandle = {
  open: () => void;
};

/**
 * An accessible confirmation dialog built on the native <dialog> element —
 * modal focus trapping, Escape-to-close, and backdrop are all provided by
 * the browser, no extra dependency needed. Opened imperatively via a ref
 * so any trigger (a plain button, a table row action, etc.) can control it.
 *
 * `description` is `ReactNode`, not `string` — every existing caller
 * already passes a plain string (a string is a valid ReactNode, so this
 * is a purely additive widening, no existing call site changes) — widened
 * so a caller that needs to embed inline-styled content (e.g. an
 * organization identity summary with its own wrap-safety class) can do so
 * without a second, separately-wired description element: this one <p>
 * is already the dialog's own aria-describedby target, so anything placed
 * here is automatically part of the dialog's accessible description.
 */
export function ConfirmDialog({
  ref,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
}: {
  ref?: Ref<ConfirmDialogHandle>;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useImperativeHandle(ref, () => ({
    open: () => dialogRef.current?.showModal(),
  }));

  return (
    <DialogShell
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current?.close();
        }
      }}
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogDescription id={descriptionId}>{description}</DialogDescription>
      <DialogActions>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="border-border-strong text-text-secondary focus-visible:ring-focus-ring rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          {cancelLabel}
        </button>
        {destructive ? (
          // Visual Design Improvement V1 — migrated off the previous
          // literal bg-red-600/hover:bg-red-700/focus-visible:ring-red-600
          // to the shared Button `danger` variant (button.tsx), backed by
          // the new dedicated --danger-button/-hover tokens (globals.css)
          // rather than --danger itself (calibrated as text/border, not a
          // solid fill — see that variant's own comment). The one visible
          // delta from before: the focus ring is now the same shared
          // --focus-ring every other Button variant already uses, instead
          // of a one-off red ring — a normalization, not a regression
          // (still clearly visible in both Light and Dark).
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              dialogRef.current?.close();
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        ) : (
          <button
            type="button"
            onClick={() => {
              dialogRef.current?.close();
              onConfirm();
            }}
            className="focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            {confirmLabel}
          </button>
        )}
      </DialogActions>
    </DialogShell>
  );
}
