import { describe, expect, it } from "vitest";
import { shouldRenderOnboardingCard } from "@/components/onboarding/should-render-card";

/**
 * Onboarding Redesign — step-row-actions.ts (and its own test coverage
 * here) was removed along with the full 12-row checklist it rendered;
 * see test/unit/onboarding-visible-progress.test.ts for the new 5-step
 * model's own coverage. shouldRenderOnboardingCard's own signature was
 * narrowed (src/components/onboarding/should-render-card.ts) to the two
 * booleans this decision has ever actually needed, so it works
 * identically for both the legacy and new progress models — these tests
 * exercise it directly against that narrow shape, not a full model.
 */

describe("shouldRenderOnboardingCard", () => {
  it("an incomplete, non-dismissed organization renders the card", () => {
    expect(shouldRenderOnboardingCard({ isComplete: false, isDismissed: false })).toBe(true);
  });

  it("a complete organization hides the card", () => {
    expect(shouldRenderOnboardingCard({ isComplete: true, isDismissed: false })).toBe(false);
  });

  it("a dismissed organization hides the card even if incomplete", () => {
    expect(shouldRenderOnboardingCard({ isComplete: false, isDismissed: true })).toBe(false);
  });

  it("a complete AND dismissed organization hides the card", () => {
    expect(shouldRenderOnboardingCard({ isComplete: true, isDismissed: true })).toBe(false);
  });
});
