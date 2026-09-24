import Link from "next/link";
import { OnboardingProgressBar } from "./onboarding-progress-bar";
import { OnboardingStepIcon } from "./onboarding-step-icon";
import { DismissOnboardingButton } from "./dismiss-onboarding-button";
import { SkipStepButton } from "./skip-step-button";
import { shouldRenderOnboardingCard } from "./should-render-card";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import type { VisibleOnboardingProgress } from "@/lib/onboarding/visible-progress";

/**
 * Onboarding Redesign. Replaces the previous full 12-row checklist with a
 * short, product-oriented card: progress ("N of 5 complete") plus exactly
 * ONE primary next step (locked spec §5) — never a long list underneath.
 * Still an ordinary Dashboard card, never a wizard/modal/blocking overlay
 * (unchanged framing from the original onboarding design).
 *
 * `id`/`tabIndex={-1}` on the Dashboard's own <h1> is still the
 * DismissOnboardingButton's own focus-return target — unchanged, see that
 * component's own doc comment.
 */
export const ONBOARDING_DISMISS_RETURN_FOCUS_ID = "dashboard-heading";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

function stepLabelId(key: string): string {
  return `onboarding-next-step-${key}`;
}

export function OnboardingCard({
  progress,
  isDismissed,
}: {
  progress: VisibleOnboardingProgress;
  isDismissed: boolean;
}) {
  if (!shouldRenderOnboardingCard({ isComplete: progress.isComplete, isDismissed })) {
    return null;
  }

  const step = progress.nextStep;
  const labelId = step ? stepLabelId(step.key) : undefined;
  // A CTA is only ever shown when the current role can actually complete
  // this exact step (locked spec §8) — roleBlockedMessage is set by
  // buildVisibleOnboardingProgress() exactly when it isn't, and takes the
  // place of the normal description; never both at once.
  const showCta = Boolean(step && !step.roleBlockedMessage);

  return (
    <section aria-labelledby="onboarding-heading" className={`p-6 ${CARD_SURFACE_CLASSES}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="onboarding-heading" className="text-text-primary text-lg font-semibold tracking-tight">
            Getting started
          </h2>
          <p className="text-text-secondary mt-1 text-sm">
            A few quick steps to get your workspace up and running.
          </p>
        </div>
        <DismissOnboardingButton returnFocusId={ONBOARDING_DISMISS_RETURN_FOCUS_ID} />
      </div>

      <div className="mt-4" aria-live="polite">
        <OnboardingProgressBar
          completedCount={progress.completedCount}
          totalCount={progress.totalCount}
          percent={progress.percent}
        />
      </div>

      {step && (
        <div className="mt-6 flex items-start gap-3">
          <OnboardingStepIcon status={step.status} />
          <div className="min-w-0 flex-1">
            <p
              id={labelId}
              tabIndex={-1}
              className="text-text-primary focus:ring-focus-ring rounded text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2"
            >
              {step.label}
            </p>
            <p className="text-text-muted mt-0.5 text-sm">{step.roleBlockedMessage ?? step.description}</p>
            {(showCta || step.skippable) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {showCta && (
                  <Link href={step.targetHref} className={PRIMARY_LINK_CLASSES}>
                    Get started
                  </Link>
                )}
                {/* Skip stays available regardless of role — it never fails
                    authorization (skipOnboardingStepAction has no role
                    check, unchanged), so it's the safe way for a MEMBER to
                    move past a step they can't personally act on, rather
                    than a dead end (locked spec §2's own "otherwise ensure
                    this step cannot become a dead-end interactive action
                    for MEMBER"). */}
                {step.skippable && (
                  <SkipStepButton stepKey={step.key} label={step.label} returnFocusId={labelId!} />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
