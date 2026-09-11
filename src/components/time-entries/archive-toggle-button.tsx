"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/toast/toast-provider";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Time Tracking Phase 2A — the detail page's own archive/unarchive
 * control. Mirrors leads/lead-actions-panel.tsx's own
 * handleArchiveToggle exactly: useTransition, router.refresh() on
 * success so this button never keeps its own duplicate copy of the
 * entry's real archivedAt state, a ConfirmDialog before archiving
 * (unarchive needs no confirmation, same asymmetry Client Requests' own
 * ArchiveFormButton/UnarchiveFormButton already establish).
 */
export function ArchiveToggleButton({
  entryId,
  isArchived,
  archiveAction,
  unarchiveAction,
}: {
  entryId: string;
  isArchived: boolean;
  archiveAction: (entryId: string) => Promise<{ ok: boolean; reason?: string }>;
  unarchiveAction: (entryId: string) => Promise<{ ok: boolean; reason?: string }>;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<ConfirmDialogHandle>(null);

  function runToggle(archive: boolean) {
    startTransition(async () => {
      const result = archive ? await archiveAction(entryId) : await unarchiveAction(entryId);
      if (result.ok) {
        showToast(archive ? "Time entry archived" : "Time entry unarchived");
        router.refresh();
        return;
      }
      showToast(result.reason === "FORBIDDEN" ? "You don't have permission to do that." : GENERIC_ERROR, "error");
      router.refresh();
    });
  }

  if (isArchived) {
    return (
      <Button type="button" variant="secondary" disabled={pending} onClick={() => runToggle(false)}>
        Unarchive
      </Button>
    );
  }

  return (
    <>
      <Button type="button" variant="secondary" disabled={pending} onClick={() => dialogRef.current?.open()}>
        Archive
      </Button>
      <ConfirmDialog
        ref={dialogRef}
        title="Archive time entry"
        description="Archived time entries are hidden from the default list. You can unarchive it later."
        confirmLabel="Archive"
        onConfirm={() => runToggle(true)}
      />
    </>
  );
}
