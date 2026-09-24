/**
 * Onboarding Redesign — narrowed from the original OnboardingProgressSummary
 * shape to just the two booleans this decision has ever actually needed,
 * so it works identically for both the legacy full progress model and the
 * new VisibleOnboardingProgress model without depending on either one's
 * full shape. The card is fully absent (not collapsed, not hidden-via-CSS)
 * once dismissed or complete — unchanged behavior from the original
 * design. Extracted as a pure function so OnboardingCard's visibility
 * rule stays unit-testable directly.
 */
export function shouldRenderOnboardingCard(progress: { isComplete: boolean; isDismissed: boolean }): boolean {
  return !progress.isDismissed && !progress.isComplete;
}
