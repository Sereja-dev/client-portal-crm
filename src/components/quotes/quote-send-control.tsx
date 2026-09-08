"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast/toast-provider";
import { sendQuoteAction } from "@/app/(dashboard)/quotes/actions";

const RATE_LIMIT_MESSAGE = "Too many requests. Please try again later.";

/**
 * Quotes / Estimates Phase 3 (Staff UI) §H — rendered only for a DRAFT
 * Quote, directly beside the still-editable QuoteForm (never inside
 * QuoteLifecycleControls — see that component's own header comment for
 * why). Labeled "Mark as sent," not "Send," and the helper text below it
 * says explicitly that no email is delivered — sendQuoteAction only ever
 * flips DRAFT -> SENT and snapshots a recipient name/email it resolves
 * itself; it never calls Resend or generates a PDF (both out of this
 * phase's scope). `disabled` lets the caller (the edit page, via the same
 * `dirty` state InvoiceDraftPanel's own Issue/Send controls already key
 * off) block sending while the form has unsaved local edits still showing.
 */
export function QuoteSendControl({ quoteId, disabled = false }: { quoteId: string; disabled?: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await sendQuoteAction(quoteId);
      if (result.ok) {
        showToast("Quote marked as sent");
        router.refresh();
        return;
      }
      if (result.reason === "rate_limited") {
        showToast(RATE_LIMIT_MESSAGE, "error");
      } else {
        showToast(
          "This quote could not be marked as sent — check its valid-until date, or it may have changed elsewhere.",
          "error",
        );
        router.refresh();
      }
    });
  }

  return (
    <div className="border-border-default mt-6 border-t pt-6">
      <Button type="button" disabled={disabled || pending} loading={pending} onClick={run}>
        Mark as sent
      </Button>
      <p className="text-text-muted mt-2 text-xs">
        This only updates the quote&rsquo;s own status — it does not send an email. Save any unsaved changes first.
      </p>
    </div>
  );
}
