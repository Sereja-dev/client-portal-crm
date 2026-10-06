"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { useToast } from "@/components/toast/toast-provider";
import { archiveContractAction, restoreContractAction } from "@/app/(dashboard)/contracts/actions";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Tables Improvement Slice B — the narrow Contract-list-row counterpart
 * to ContractLifecycleControls' own Archive/Restore pair. That detail-
 * page component also renders Send/Accept/Terminate together in one
 * block, which this slice's own locked row-action hierarchy must NOT
 * surface on the list (Preview/Send/Accept/Terminate stay canonical
 * Contract-detail-only actions) — so this component exists purely to
 * isolate Archive/Restore for the list's own RowActionMenu, never to
 * reimplement or branch the mutation itself.
 *
 * Zero duplicated domain logic: archiveContractAction/restoreContractAction
 * are the exact existing Server Actions (actions.ts -> service.ts),
 * unmodified — same organization-scoped resolution, same lifecycle-
 * agnostic/idempotent archive semantics, same tenant isolation. The
 * confirmation copy is deliberately byte-identical to
 * ContractLifecycleControls' own existing dialog text — never a second,
 * independently-worded description of the same mutation.
 */
export function ContractArchiveRestoreAction({
  contractId,
  isArchived,
}: {
  contractId: string;
  isArchived: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<ConfirmDialogHandle>(null);

  function runArchiveOrRestore(): void {
    startTransition(async () => {
      const result = isArchived ? await restoreContractAction(contractId) : await archiveContractAction(contractId);
      if (result.ok) {
        showToast(isArchived ? "Contract restored" : "Contract archived");
        router.refresh();
        return;
      }
      showToast(GENERIC_ERROR, "error");
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => dialogRef.current?.open()}
        className={`${ACTION_LINK_CLASSES} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {isArchived ? "Restore" : "Archive"}
      </button>
      <ConfirmDialog
        ref={dialogRef}
        title={isArchived ? "Restore contract" : "Archive contract"}
        description={
          isArchived
            ? "This contract will reappear in the active list. Its status and history are not affected."
            : "This contract will be hidden from the active list. Its status and history are not affected, and it can be restored at any time."
        }
        confirmLabel={isArchived ? "Restore" : "Archive"}
        onConfirm={runArchiveOrRestore}
      />
    </>
  );
}
