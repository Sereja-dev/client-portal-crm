"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/toast/toast-provider";
import { approvePortalQuoteAction, declinePortalQuoteAction } from "@/app/portal/(app)/quotes/actions";
import { formatCurrency } from "@/lib/format";
import { isStaleServerActionError, STALE_ACTION_MESSAGE } from "@/lib/action-error";

const RATE_LIMIT_MESSAGE = "Too many requests. Please try again later.";
const GENERIC_ERROR = "This quote could not be updated — it may have changed. Refreshing…";

/**
 * Quotes / Estimates Phase 4 §I/§J — the only decision surface a Client
 * Portal identity ever sees for an eligible SENT Quote. Both actions
 * require an explicit confirmation first (a native <dialog>, same
 * ConfirmDialog primitive Staff already uses) — the copy is deliberately
 * narrow: it names the decision and the amount, and never implies an
 * Invoice will be created, a payment will occur, or any signature/
 * contract event is happening (§I) — because none of those things happen
 * here. Decline never asks for a reason — Quote.declineReason does not
 * exist in the schema (§G), and this phase does not add it.
 *
 * Only ever rendered by the page for a Quote that is currently, actually
 * eligible (status SENT, not expired, not archived, not converted) — but
 * the real enforcement is still entirely server-side
 * (approvePortalQuoteAction/declinePortalQuoteAction's own re-fetch and
 * guarded updateMany); this component never assumes its own render-time
 * eligibility check stays true by the time the user clicks through the
 * dialog.
 */
export function PortalQuoteDecisionControls({
  quoteId,
  quoteNumber,
  total,
  currency,
}: {
  quoteId: string;
  quoteNumber: string;
  total: number;
  currency: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const approveDialogRef = useRef<ConfirmDialogHandle>(null);
  const declineDialogRef = useRef<ConfirmDialogHandle>(null);

  const formattedTotal = formatCurrency(total, currency);

  // Portal stale Server Action hardening — approvePortalQuoteAction/
  // declinePortalQuoteAction resolve a plain { ok, reason } result, not
  // the { error: string | null } shape callActionWithStaleRecovery
  // requires, so a stale-deployment failure is classified inline here
  // instead: only the literal Next.js "Failed to find Server Action"
  // shape (isStaleServerActionError) is intercepted and surfaced via the
  // existing toast UX; anything else — including a real auth redirect
  // from getCurrentPortalUser()'s own session-loss check — is rethrown
  // unchanged and still propagates exactly as it did before this catch
  // existed. No retry is attempted either way; the action above has
  // already run at most once per click.
  function runApprove() {
    startTransition(async () => {
      try {
        const result = await approvePortalQuoteAction(quoteId);
        if (result.ok) {
          showToast("Quote approved");
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

  function runDecline() {
    startTransition(async () => {
      try {
        const result = await declinePortalQuoteAction(quoteId);
        if (result.ok) {
          showToast("Quote declined");
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
      <Button type="button" disabled={pending} loading={pending} onClick={() => approveDialogRef.current?.open()}>
        Approve quote
      </Button>
      <Button
        type="button"
        variant="dangerOutline"
        disabled={pending}
        onClick={() => declineDialogRef.current?.open()}
      >
        Decline quote
      </Button>

      <ConfirmDialog
        ref={approveDialogRef}
        title="Approve quote"
        description={`You're approving quote ${quoteNumber} for ${formattedTotal}. This decision will be visible to the business. It does not create an invoice or process any payment.`}
        confirmLabel="Approve quote"
        onConfirm={runApprove}
      />
      <ConfirmDialog
        ref={declineDialogRef}
        title="Decline quote"
        description={`You're declining quote ${quoteNumber} for ${formattedTotal}. This decision will be visible to the business — they may revise and resend it.`}
        confirmLabel="Decline quote"
        destructive
        onConfirm={runDecline}
      />
    </div>
  );
}
