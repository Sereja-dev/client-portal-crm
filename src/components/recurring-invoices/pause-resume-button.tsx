"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast/toast-provider";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Recurring Invoices Phase 2A — pause/resume. Both directions are
 * reversible (matching the finalized design's own explicit "no confirm
 * required" for this pair), so this mirrors ArchiveToggleButton's own
 * shape minus the ConfirmDialog: useTransition + router.refresh() so this
 * button never keeps a stale local copy of the schedule's real status.
 */
export function PauseResumeButton({
  recurringInvoiceId,
  isPaused,
  pauseAction,
  resumeAction,
}: {
  recurringInvoiceId: string;
  isPaused: boolean;
  pauseAction: (recurringInvoiceId: string) => Promise<{ ok: boolean; reason?: string }>;
  resumeAction: (recurringInvoiceId: string) => Promise<{ ok: boolean; reason?: string }>;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  function runToggle(pause: boolean) {
    startTransition(async () => {
      const result = pause ? await pauseAction(recurringInvoiceId) : await resumeAction(recurringInvoiceId);
      if (result.ok) {
        showToast(pause ? "Schedule paused" : "Schedule resumed");
        router.refresh();
        return;
      }
      showToast(result.reason === "FORBIDDEN" ? "You don't have permission to do that." : GENERIC_ERROR, "error");
      router.refresh();
    });
  }

  return (
    <Button type="button" variant="secondary" disabled={pending} onClick={() => runToggle(!isPaused)}>
      {isPaused ? "Resume" : "Pause"}
    </Button>
  );
}
