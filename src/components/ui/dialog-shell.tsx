import type { DialogHTMLAttributes, ReactNode, Ref } from "react";
import { DIALOG_CENTER_CLASSES } from "./dialog-classes";

/**
 * Visual Design Improvement V2 — the shared visual structure already
 * repeated byte-for-byte across ConfirmDialog, ContactFormDialog,
 * TaskQuickLogDialog, and ConvertToInvoiceDialog, extracted into one
 * place. Purely presentational: this owns NO state, and does not manage
 * open/close, focus, Escape, return focus, submit logic, or backdrop
 * behavior — every one of those stays exactly where it already lived, in
 * the caller. `DialogShell` is the real native `<dialog>` element itself
 * (not a wrapping div around one), so a caller's own `ref`/`onClick`/
 * `aria-labelledby`/`aria-describedby` work exactly as they did on the
 * raw element before this existed — this is a drop-in visual swap, never
 * a new abstraction layer the browser's own top-layer/focus-trap/Escape
 * handling has to see through.
 *
 * Visual upgrade over the previous per-dialog literal classes: radius and
 * shadow now come from the Design System's own `--aqenra-radius-lg`/
 * `--aqenra-shadow-lg` tokens (globals.css) — defined since an earlier
 * phase but never consumed by any component until now. Both are already
 * Light/Dark-calibrated (Dark's own shadow is deliberately tighter/more
 * opaque, since a generic Tailwind `shadow-xl` barely registers against
 * a near-black surface — see globals.css's own Dark SEMANTIC comment).
 * Tailwind arbitrary-value syntax (`rounded-[var(--aqenra-radius-lg)]`)
 * is required here: these are plain custom properties, deliberately NOT
 * mirrored into `@theme inline` (would silently override Tailwind's own
 * reserved `--radius-lg`/`--shadow-lg` names app-wide — see globals.css's
 * own comment on why). No token value changed by this file — only which
 * components consume the already-defined ones.
 *
 * `border-border-default`/`bg-surface`/`backdrop:bg-black/40` and
 * `DIALOG_CENTER_CLASSES` (the native-centering fix) are unchanged from
 * every dialog's previous literal classes — this is additive
 * consolidation, not a restyle of those parts.
 */
type DialogMaxWidth = "sm" | "md";

const MAX_WIDTH_CLASSES: Record<DialogMaxWidth, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
};

export function DialogShell({
  ref,
  maxWidth = "sm",
  className = "",
  children,
  ...props
}: DialogHTMLAttributes<HTMLDialogElement> & {
  ref?: Ref<HTMLDialogElement>;
  /** max-w-sm (default — ConfirmDialog/TaskQuickLogDialog/ConvertToInvoiceDialog's existing width) or max-w-md (ContactFormDialog's existing, slightly wider width for its four-field form). */
  maxWidth?: DialogMaxWidth;
  children: ReactNode;
}) {
  return (
    <dialog
      ref={ref}
      className={`border-border-default bg-surface w-full rounded-[var(--aqenra-radius-lg)] border p-6 shadow-[var(--aqenra-shadow-lg)] backdrop:bg-black/40 ${MAX_WIDTH_CLASSES[maxWidth]} ${DIALOG_CENTER_CLASSES} ${className}`}
      {...props}
    >
      {children}
    </dialog>
  );
}

/** Same `text-base font-semibold` title treatment every current dialog already uses — unchanged, just shared. */
export function DialogTitle({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-text-primary text-base font-semibold">
      {children}
    </h2>
  );
}

/** Same `mt-2 text-sm` description treatment ConfirmDialog/ConvertToInvoiceDialog already use — unchanged, just shared. Optional: a dialog with no description paragraph (TaskQuickLogDialog, ContactFormDialog) simply doesn't render one. */
export function DialogDescription({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="text-text-secondary mt-2 text-sm">
      {children}
    </p>
  );
}

/** Same `flex justify-end gap-3` action-row layout every current dialog already uses — unchanged, just shared (and the `mt-6` top gap, standardized from TaskQuickLogDialog's own slightly different `pt-2` on its own wrapping div to match the other three). Button content is entirely caller-owned — this renders only the layout, never a button of its own. */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex justify-end gap-3">{children}</div>;
}
