"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/toast/toast-provider";
import {
  sendContractAction,
  acceptContractByStaffAction,
  terminateContractAction,
  archiveContractAction,
  restoreContractAction,
} from "@/app/(dashboard)/contracts/actions";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Contracts Phase 2 (Staff UI) §23–§28 — every lifecycle/archive action
 * on the Contract detail page, each gated by the exact stored-status/
 * archivedAt combination the locked domain rules require (never the
 * derived display status — locked architecture §26: an EXPIRED-display
 * ACCEPTED Contract must still show Terminate). Every confirmation is
 * truthful about what actually happens (no email claim for Send, no
 * signature claim for Record acceptance, termination framed as a
 * lifecycle change, not deletion) — matching InvoiceIssueControls' own
 * ConfirmDialog pattern.
 */
export function ContractLifecycleControls({
  contractId,
  status,
  archivedAt,
}: {
  contractId: string;
  status: "DRAFT" | "SENT" | "ACCEPTED" | "TERMINATED";
  archivedAt: Date | null;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  const sendDialogRef = useRef<ConfirmDialogHandle>(null);
  const acceptDialogRef = useRef<ConfirmDialogHandle>(null);
  const terminateDialogRef = useRef<ConfirmDialogHandle>(null);
  const archiveDialogRef = useRef<ConfirmDialogHandle>(null);

  const isArchived = archivedAt !== null;

  function runSend() {
    startTransition(async () => {
      const result = await sendContractAction(contractId);
      if (result.ok) {
        showToast("Contract sent");
        router.refresh();
        return;
      }
      if (result.reason === "INVALID_SIGNATORY") {
        showToast("The intended signatory is no longer available or active — edit the contract before sending.", "error");
        return;
      }
      showToast("This contract could not be sent — it may have changed elsewhere. Refreshing…", "error");
      router.refresh();
    });
  }

  function runAccept() {
    startTransition(async () => {
      const result = await acceptContractByStaffAction(contractId);
      if (result.ok) {
        showToast("Acceptance recorded");
        router.refresh();
        return;
      }
      showToast("This contract could not be marked as accepted — it may have changed elsewhere. Refreshing…", "error");
      router.refresh();
    });
  }

  function runTerminate() {
    startTransition(async () => {
      const result = await terminateContractAction(contractId);
      if (result.ok) {
        showToast("Contract terminated");
        router.refresh();
        return;
      }
      showToast("This contract could not be terminated — it may have changed elsewhere. Refreshing…", "error");
      router.refresh();
    });
  }

  function runArchive() {
    startTransition(async () => {
      const result = archivedAt === null ? await archiveContractAction(contractId) : await restoreContractAction(contractId);
      if (result.ok) {
        showToast(archivedAt === null ? "Contract archived" : "Contract restored");
        router.refresh();
        return;
      }
      showToast(GENERIC_ERROR, "error");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-3">
      {status === "DRAFT" && !isArchived && (
        <>
          <Button type="button" disabled={pending} loading={pending} onClick={() => sendDialogRef.current?.open()}>
            Send contract
          </Button>
          <ConfirmDialog
            ref={sendDialogRef}
            title="Send contract"
            description="This will mark the contract as sent and freeze its document content. No email will be sent automatically."
            confirmLabel="Send contract"
            onConfirm={runSend}
          />
        </>
      )}

      {status === "SENT" && !isArchived && (
        <>
          <Button type="button" variant="secondary" disabled={pending} loading={pending} onClick={() => acceptDialogRef.current?.open()}>
            Record acceptance
          </Button>
          <ConfirmDialog
            ref={acceptDialogRef}
            title="Record acceptance"
            description="Record that this contract was accepted. This does not create a certified electronic signature, and does not assert that the intended signatory personally accepted it."
            confirmLabel="Record acceptance"
            onConfirm={runAccept}
          />
        </>
      )}

      {status === "ACCEPTED" && (
        <>
          <Button type="button" variant="dangerOutline" disabled={pending} loading={pending} onClick={() => terminateDialogRef.current?.open()}>
            Terminate contract
          </Button>
          <ConfirmDialog
            ref={terminateDialogRef}
            title="Terminate contract"
            description="This ends the contract. It is a lifecycle change, not a deletion — the document and its history remain visible. This cannot be undone."
            confirmLabel="Terminate contract"
            destructive
            onConfirm={runTerminate}
          />
        </>
      )}

      <Button type="button" variant="secondary" disabled={pending} loading={pending} onClick={() => archiveDialogRef.current?.open()}>
        {isArchived ? "Restore" : "Archive"}
      </Button>
      <ConfirmDialog
        ref={archiveDialogRef}
        title={isArchived ? "Restore contract" : "Archive contract"}
        description={
          isArchived
            ? "This contract will reappear in the active list. Its status and history are not affected."
            : "This contract will be hidden from the active list. Its status and history are not affected, and it can be restored at any time."
        }
        confirmLabel={isArchived ? "Restore" : "Archive"}
        onConfirm={runArchive}
      />
    </div>
  );
}
