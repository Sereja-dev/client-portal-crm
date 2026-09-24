"use client";

import { useTransition } from "react";
import { useToast } from "@/components/toast/toast-provider";
import { startWithSampleDataAction } from "@/app/(dashboard)/actions";
import { Button } from "@/components/ui/button";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";

/**
 * Demo Vs Real Workspace Separation §9. Deliberately its own small,
 * independent section — never a new OnboardingStepKey/step in
 * src/lib/onboarding/steps.ts's own closed, Prisma-enum-backed catalog
 * (that machinery tracks required/optional setup progress; sample data is
 * neither — it's an explicit, opt-in alternative path a real user may
 * skip entirely). Rendered only when the Dashboard page's own
 * server-resolved `eligible` prop says so (isEligibleForSampleData() —
 * not empty/already-demo), so this never appears once a real workspace
 * has any business data, and this component itself never determines its
 * own eligibility (no client-side guess, no organizationId, no isDemo
 * check here at all).
 *
 * Never the default path: no auto-seed anywhere in this app calls
 * startWithSampleDataAction — the only way it ever runs is this exact
 * button being clicked, matching §9's explicit "must require explicit
 * action" requirement.
 */
export function StartWithSampleData({ eligible }: { eligible: boolean }) {
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

  if (!eligible) return null;

  function handleClick() {
    startTransition(async () => {
      const result = await startWithSampleDataAction();
      if (!result.ok) {
        showToast(result.message, "error");
        return;
      }
      showToast("Sample data added — this workspace is now marked as a demo.", "success");
    });
  }

  return (
    <section aria-labelledby="start-with-sample-data-heading" className={`p-6 ${CARD_SURFACE_CLASSES}`}>
      <h2 id="start-with-sample-data-heading" className="text-text-primary text-sm font-semibold">
        Want to explore first?
      </h2>
      <p className="text-text-secondary mt-1 text-sm">
        Add a small set of sample clients, a project, tasks, and an invoice so you can see how everything fits
        together. This workspace will be clearly marked as a demo.
      </p>
      <Button
        type="button"
        variant="secondary"
        loading={isPending}
        onClick={handleClick}
        className="mt-4"
      >
        {isPending ? "Adding sample data…" : "Start with sample data"}
      </Button>
    </section>
  );
}
