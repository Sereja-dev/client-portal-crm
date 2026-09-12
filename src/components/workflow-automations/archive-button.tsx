"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/toast/toast-provider";
import { isStaleServerActionError, STALE_ACTION_MESSAGE } from "@/lib/action-error";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Workflow Automations V1 — archive. Terminal in V1 (no un-archive path
 * anywhere in the Phase 1 domain layer), so this always confirms first —
 * matching ArchiveButton (Recurring Invoices)'s own identical
 * ConfirmDialog convention. Archiving never deletes the row, its
 * historical WorkflowAutomationRun rows, or any resulting entity state
 * (Custom Status/Field value) it already produced.
 */
export function WorkflowAutomationArchiveButton({
  automationId,
  archiveAction,
}: {
  automationId: string;
  archiveAction: (automationId: string) => Promise<{ ok: boolean; reason?: string }>;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<ConfirmDialogHandle>(null);

  function runArchive() {
    startTransition(async () => {
      // A stale-deployment Server Action failure (see src/lib/action-error.ts's
      // own doc comment) throws before ever reaching a normal {ok:false}
      // return — without this catch, that would surface as an uncaught
      // exception in this transition (the nearest error boundary), not a
      // toast.
      try {
        const result = await archiveAction(automationId);
        if (result.ok) {
          showToast("Automation archived");
          router.refresh();
          return;
        }
        showToast(result.reason === "FORBIDDEN" ? "You don't have permission to do that." : GENERIC_ERROR, "error");
        router.refresh();
      } catch (err) {
        showToast(isStaleServerActionError(err) ? STALE_ACTION_MESSAGE : GENERIC_ERROR, "error");
      }
    });
  }

  return (
    <>
      <Button type="button" variant="dangerOutline" disabled={pending} onClick={() => dialogRef.current?.open()}>
        Archive
      </Button>
      <ConfirmDialog
        ref={dialogRef}
        title="Archive workflow automation"
        description="Archiving stops this automation from ever running again. This cannot be undone — it cannot be resumed afterward. Its run history and any changes it already made are not affected."
        confirmLabel="Archive"
        destructive
        onConfirm={runArchive}
      />
    </>
  );
}
