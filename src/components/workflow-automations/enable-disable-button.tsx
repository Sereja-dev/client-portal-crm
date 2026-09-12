"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast/toast-provider";
import { isStaleServerActionError, STALE_ACTION_MESSAGE } from "@/lib/action-error";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Workflow Automations V1 — enable/disable. Both directions are
 * reversible and never execute anything by themselves (enabling an
 * automation only makes it *eligible* to fire the next time its trigger
 * happens — see dispatchWorkflowAutomations's own contract), so this
 * mirrors PauseResumeButton's own shape exactly: no ConfirmDialog,
 * useTransition + router.refresh() so this button never keeps a stale
 * local copy of the automation's real state.
 */
export function EnableDisableButton({
  automationId,
  isEnabled,
  toggleAction,
}: {
  automationId: string;
  isEnabled: boolean;
  toggleAction: (automationId: string, isEnabled: boolean) => Promise<{ ok: boolean; reason?: string }>;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  function runToggle() {
    startTransition(async () => {
      // See archive-button.tsx's own identical comment — a stale-deployment
      // Server Action failure throws before reaching a normal {ok:false}.
      try {
        const result = await toggleAction(automationId, !isEnabled);
        if (result.ok) {
          showToast(isEnabled ? "Automation disabled" : "Automation enabled");
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
    <Button type="button" variant="secondary" disabled={pending} onClick={runToggle}>
      {isEnabled ? "Disable" : "Enable"}
    </Button>
  );
}
