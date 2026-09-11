"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/toast/toast-provider";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Recurring Invoices Phase 2A — archive. Irreversible in V1 (no
 * un-archive path anywhere in the Phase 1 domain layer), so this always
 * confirms first — matching ArchiveToggleButton's own archive-only
 * ConfirmDialog convention.
 */
export function ArchiveButton({
  recurringInvoiceId,
  archiveAction,
}: {
  recurringInvoiceId: string;
  archiveAction: (recurringInvoiceId: string) => Promise<{ ok: boolean; reason?: string }>;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<ConfirmDialogHandle>(null);

  function runArchive() {
    startTransition(async () => {
      const result = await archiveAction(recurringInvoiceId);
      if (result.ok) {
        showToast("Schedule archived");
        router.refresh();
        return;
      }
      showToast(result.reason === "FORBIDDEN" ? "You don't have permission to do that." : GENERIC_ERROR, "error");
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant="secondary" disabled={pending} onClick={() => dialogRef.current?.open()}>
        Archive
      </Button>
      <ConfirmDialog
        ref={dialogRef}
        title="Archive recurring invoice"
        description="Archiving stops all future generation. This cannot be undone — the schedule cannot be resumed afterward. Already-generated invoices are not affected."
        confirmLabel="Archive"
        destructive
        onConfirm={runArchive}
      />
    </>
  );
}
