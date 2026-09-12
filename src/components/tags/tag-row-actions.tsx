"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/toast/toast-provider";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";

/**
 * Tags V2 (Settings → Tags). Row-level action for one Tag definition —
 * mirrors custom-statuses/status-row-actions.tsx's own
 * ArchiveCustomStatusButton exactly (ConfirmDialog + toast pattern). No
 * restore/unarchive control in this scope (Section 1: "No restore in
 * this scope").
 */
export function ArchiveTagButton({
  action,
  name,
}: {
  /** A bound, zero-argument server action (archiveTagAction.bind(null, tagId)). */
  action: () => Promise<void>;
  name: string;
}) {
  const dialogRef = useRef<ConfirmDialogHandle>(null);
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await action();
      showToast(`${name} archived`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Failed to archive ${name}.`, "error");
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
        className="text-danger focus-visible:ring-danger rounded text-sm font-medium whitespace-nowrap transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Archive
      </button>
      <ConfirmDialog
        ref={dialogRef}
        title="Archive tag"
        description={
          <>
            Archive <span className="text-text-primary font-medium">{name}</span>? Clients and leads
            that already have this tag keep it, but it can no longer be added to anything new. Tags
            can&apos;t be restored once archived.
          </>
        }
        confirmLabel="Archive"
        destructive
        onConfirm={handleConfirm}
      />
    </>
  );
}
