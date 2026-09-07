"use client";

import { useId, useImperativeHandle, useRef, type ReactNode, type Ref } from "react";
import { DIALOG_CENTER_CLASSES } from "./dialog-classes";

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
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current?.close();
        }
      }}
      className={`border-border-default bg-surface w-full max-w-sm rounded-lg border p-6 shadow-xl backdrop:bg-black/40 ${DIALOG_CENTER_CLASSES}`}
    >
      <h2 id={titleId} className="text-text-primary text-base font-semibold">
        {title}
      </h2>
      <p id={descriptionId} className="text-text-secondary mt-2 text-sm">
        {description}
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="border-border-strong text-text-secondary focus-visible:ring-focus-ring rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            dialogRef.current?.close();
            onConfirm();
          }}
          // The destructive fill is a literal, deliberately theme-invariant
          // red — NOT the --danger token, which is calibrated as a text/
          // border color (legible on both Light and Dark surfaces), not a
          // solid white-on-fill button background (Dark's --danger is a
          // light coral; white text on it fails contrast — see this PR's
          // own audit notes). bg-red-600 already renders identically, and
          // legibly, regardless of the surrounding page's theme, so it
          // needs no token migration here.
          className={`rounded-md px-4 py-2 text-sm font-medium text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
            destructive
              ? "bg-red-600 hover:bg-red-700 focus-visible:ring-red-600"
              : "bg-accent hover:bg-accent-hover focus-visible:ring-focus-ring"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
