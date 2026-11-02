import "server-only";
import { prisma } from "@/lib/prisma";
import { shouldRenderOnboardingCard } from "@/components/onboarding/should-render-card";
import type { VisibleOnboardingProgress } from "./visible-progress";

/**
 * First-Time User Experience V2, Slice C — contextual onboarding CTA links.
 *
 * The Dashboard's raw onboarding signals are `count() > 0` booleans, so they
 * can never say "exactly one". When (and only when) the card will show a
 * Create-first-project or Create-first-task CTA the current role may act on,
 * this runs ONE bounded, organization-scoped candidate query (`take: 2`, the
 * eligibility filter applied BEFORE the take) and, if exactly one eligible
 * record exists, appends its server-verified id to the generic destination.
 * Zero or several eligible records, or any failure, keep the generic href —
 * never "newest" or "first", never from=project (that is reserved for real
 * Project Hub navigation), and never a change to the static step catalog,
 * completion signals or progress. The target forms keep their own
 * authoritative organization/permission validation.
 *
 * Eligibility uses the legacy `status` column, which stays authoritative for
 * every business rule (see Client.statusDefinitionId's schema comment): a
 * Client is ineligible when ARCHIVED; a Project when COMPLETED or CANCELLED.
 */

type Candidate = { id: string };

export type OnboardingContextFinders = {
  findEligibleClients: (organizationId: string) => Promise<Candidate[]>;
  findEligibleProjects: (organizationId: string) => Promise<Candidate[]>;
};

const defaultFinders: OnboardingContextFinders = {
  findEligibleClients: (organizationId) =>
    prisma.client.findMany({
      where: { organizationId, status: { not: "ARCHIVED" } },
      select: { id: true },
      take: 2,
    }),
  findEligibleProjects: (organizationId) =>
    prisma.project.findMany({
      where: { organizationId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
      select: { id: true },
      take: 2,
    }),
};

/** Exactly one candidate yields its id; zero or several yield null (generic link). */
export function uniqueCandidateId(candidates: readonly Candidate[]): string | null {
  return candidates.length === 1 ? candidates[0].id : null;
}

/**
 * The contextual CTA href for the onboarding card's next step, or null when
 * the card should keep the step's static `targetHref`.
 */
export async function resolveOnboardingCtaHref(
  args: { organizationId: string; progress: VisibleOnboardingProgress; isDismissed: boolean },
  finders: OnboardingContextFinders = defaultFinders,
): Promise<string | null> {
  const { organizationId, progress, isDismissed } = args;
  const step = progress.nextStep;

  if (!shouldRenderOnboardingCard({ isComplete: progress.isComplete, isDismissed })) return null;
  if (!step || !step.roleCanAct || step.roleBlockedMessage) return null;

  try {
    if (step.key === "CREATE_PROJECT") {
      const clientId = uniqueCandidateId(await finders.findEligibleClients(organizationId));
      return clientId ? `${step.targetHref}?clientId=${clientId}` : null;
    }
    if (step.key === "CREATE_TASK") {
      const projectId = uniqueCandidateId(await finders.findEligibleProjects(organizationId));
      return projectId ? `${step.targetHref}?projectId=${projectId}` : null;
    }
  } catch {
    // The contextual hint is a convenience: never break the Dashboard, and
    // never surface a raw database error — fall back to the generic link.
    console.warn("[onboarding] contextual link unavailable, using the generic destination.");
  }
  return null;
}
