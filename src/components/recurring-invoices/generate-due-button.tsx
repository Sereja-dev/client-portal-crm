"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast/toast-provider";
import type { GenerateDueInvoiceActionResult } from "@/app/(dashboard)/recurring-invoices/actions";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Recurring Invoices Phase 2A — the manual "Generate due invoice" trigger.
 * A thin UI wrapper only: every outcome (generated/skipped_completed/
 * skipped_claimed/failed) is decided entirely by the unchanged Phase 1
 * generateRecurringInvoiceOccurrence() via generateDueInvoiceAction() —
 * this component never re-implements or second-guesses that decision, it
 * only translates the already-safe result into a toast message. No raw
 * failureReason/DB error ever reaches this component — the Server Action
 * itself only ever returns the bounded outcome union below.
 *
 * router.refresh() after every outcome (not just success) so the page's
 * own server-rendered eligibility check (isRecurringInvoiceDueToday) and
 * the generated-invoice history table both reflect the real, current
 * state — never a stale local assumption.
 */
export function GenerateDueButton({
  recurringInvoiceId,
  generateAction,
}: {
  recurringInvoiceId: string;
  generateAction: (recurringInvoiceId: string) => Promise<GenerateDueInvoiceActionResult>;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await generateAction(recurringInvoiceId);

      if (!result.ok) {
        showToast(result.reason === "FORBIDDEN" ? "You don't have permission to do that." : GENERIC_ERROR, "error");
        router.refresh();
        return;
      }

      switch (result.outcome) {
        case "generated":
          showToast("Invoice generated — see it in the history below.");
          break;
        case "skipped_completed":
          showToast("This occurrence was already generated — no duplicate was created.");
          break;
        case "skipped_claimed":
          showToast("Generation is already in progress for this schedule. Try again in a moment.");
          break;
        case "failed":
          showToast("Couldn't generate an invoice number for this occurrence. Check the prefix and try again.", "error");
          break;
      }
      router.refresh();
    });
  }

  return (
    <Button type="button" disabled={pending} onClick={handleClick}>
      {pending ? "Generating…" : "Generate due invoice"}
    </Button>
  );
}
