"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/toast/toast-provider";
import { acceptPortalContractAction } from "@/app/portal/(app)/contracts/actions";
import { isStaleServerActionError, STALE_ACTION_MESSAGE } from "@/lib/action-error";

const RATE_LIMIT_MESSAGE = "Too many requests. Please try again later.";
const GENERIC_ERROR = "This contract could not be updated. It may have changed. Refreshing…";

/**
 * Contracts Portal V1 §16/§20/§26 — the only decision surface a Client
 * Portal identity ever sees for an eligible SENT Contract. Mirrors
 * PortalQuoteDecisionControls' own exact shape (ConfirmDialog +
 * useTransition + inline stale-action handling, since
 * acceptPortalContractAction's own result shape isn't the
 * `{error: string | null}` callActionWithStaleRecovery requires).
 *
 * Copy is deliberately truthful and non-e-signature (locked architecture
 * §16/§33): it names the decision and states plainly what does NOT
 * happen. Only ever rendered by the page for a Contract that is
 * currently, actually eligible (stored status SENT, not archived) — but
 * the real enforcement is entirely server-side
 * (acceptPortalContractAction -> acceptContractByPortal's own re-fetch
 * and guarded updateMany); this component never assumes its own
 * render-time eligibility check stays true by the time the confirmation
 * is clicked.
 */
export function PortalContractAcceptControls({
  contractId,
  contractNumber,
}: {
  contractId: string;
  contractNumber: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const acceptDialogRef = useRef<ConfirmDialogHandle>(null);

  function runAccept() {
    startTransition(async () => {
      try {
        const result = await acceptPortalContractAction(contractId);
        if (result.ok) {
          showToast("Contract accepted");
          router.refresh();
          return;
        }
        if (result.reason === "rate_limited") {
          showToast(RATE_LIMIT_MESSAGE, "error");
        } else {
          showToast(GENERIC_ERROR, "error");
          router.refresh();
        }
      } catch (error) {
        if (isStaleServerActionError(error)) {
          showToast(STALE_ACTION_MESSAGE, "error");
          return;
        }
        throw error;
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" disabled={pending} loading={pending} onClick={() => acceptDialogRef.current?.open()}>
        Accept contract
      </Button>

      <ConfirmDialog
        ref={acceptDialogRef}
        title="Accept contract"
        description={`You're accepting contract ${contractNumber}. This decision will be visible to the business. This does not create a certified electronic signature.`}
        confirmLabel="Accept contract"
        onConfirm={runAccept}
      />
    </div>
  );
}
