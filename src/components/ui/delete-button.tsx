"use client";

import { useRef, useState } from "react";
import { TrashIcon } from "@/components/ui/icons";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/toast/toast-provider";

/**
 * A void-returning action's success is unconditional (every existing
 * caller); a result-aware action can report a controlled failure instead
 * of throwing (Invoice's DRAFT-only guard, e.g.). `message` is optional
 * and additive (Quotes / Estimates Phase 2) — when a blocked delete can
 * be caused by more than one kind of dependent (e.g. Client: Invoice OR
 * Quote), the action itself picks the exact wording and this component
 * prefers it over the caller's own single static `conflictMessage` prop;
 * every existing caller that never supplies `message` is unaffected.
 */
export type DeleteButtonActionResult = void | { ok: boolean; message?: string };

export function DeleteButton({
  action,
  itemName,
  confirmTitle,
  confirmDescription,
  successMessage,
  conflictMessage = `Failed to delete ${itemName}.`,
}: {
  /** A bound, zero-argument server action (e.g. deleteClientAction.bind(null, id)). May resolve void (existing behavior, unconditional success) or { ok: boolean } (a controlled guard result). */
  action: () => Promise<DeleteButtonActionResult>;
  itemName: string;
  confirmTitle: string;
  confirmDescription: string;
  successMessage: string;
  /** Shown instead of successMessage when a result-aware action resolves { ok: false }. Defaults to the same generic text the catch branch already used. */
  conflictMessage?: string;
}) {
  const dialogRef = useRef<ConfirmDialogHandle>(null);
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      const result = await action();
      if (result && "ok" in result && !result.ok) {
        showToast(result.message ?? conflictMessage, "error");
      } else {
        showToast(successMessage);
      }
    } catch {
      showToast(`Failed to delete ${itemName}.`, "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => dialogRef.current?.open()}
        // text-danger, not a literal red: a TEXT color, calibrated to stay
        // legible on both Light and Dark surfaces (see globals.css's Dark
        // SEMANTIC comment) — unlike a solid white-on-fill button
        // background, which --danger is NOT designed for (see Button's own
        // dangerOutline/Design System Phase 2 notes). hover relies on the
        // existing hover:underline for feedback rather than a second
        // darker-red shade (none exists as a token), keeping this a
        // single-color, theme-safe treatment.
        className="text-danger focus-visible:ring-danger inline-flex items-center gap-1 rounded text-sm font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <TrashIcon className="h-3.5 w-3.5" />
        Delete
      </button>
      <ConfirmDialog
        ref={dialogRef}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel="Delete"
        destructive
        onConfirm={handleConfirm}
      />
    </>
  );
}
