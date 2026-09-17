"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast/toast-provider";
import { isStaleServerActionError, STALE_ACTION_MESSAGE } from "@/lib/action-error";
import { restoreCalendarEventAction } from "@/app/(dashboard)/calendar/actions";

const GENERIC_ERROR = "This event could not be restored — it may have changed elsewhere. Refreshing…";

/**
 * Calendar V1 §22 — the one action available on the archived-events view
 * (locked architecture: "a minimal way to view/restore archived events
 * without turning Calendar into a full admin table"). No confirmation
 * dialog — restoring is the inverse of a reversible archive, matching
 * ContractLifecycleControls' own identical "Restore" button, which also
 * has no confirmation step.
 */
export function RestoreCalendarEventButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      try {
        const result = await restoreCalendarEventAction(eventId);
        if (result.ok) {
          showToast("Event restored");
          router.refresh();
          return;
        }
        showToast(GENERIC_ERROR, "error");
        router.refresh();
      } catch (err) {
        showToast(isStaleServerActionError(err) ? STALE_ACTION_MESSAGE : GENERIC_ERROR, "error");
      }
    });
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={run}
      className="text-accent focus-visible:ring-focus-ring rounded text-sm font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50"
    >
      Restore
    </button>
  );
}
