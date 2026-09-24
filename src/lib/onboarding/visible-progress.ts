import "server-only";
import { Role } from "@/generated/prisma/enums";
import { getCurrentMembership } from "@/lib/current-user";
import type { OnboardingRawSignals } from "./progress";
import { getOrganizationOnboardingSignals } from "./progress";
import { VISIBLE_STEP_ORDER, VISIBLE_STEPS, type VisibleStepDefinition, type VisibleStepKey } from "./visible-steps";

/**
 * Onboarding Redesign — the short, 5-step progress model the Dashboard's
 * onboarding card now uses. A deliberately separate, additive pure
 * function (mirrors buildOnboardingProgress's own "pure, no I/O" shape in
 * ./progress.ts) built directly on the SAME OnboardingRawSignals shape —
 * never a second query, never a second row-write mechanism. Skip/
 * acknowledge state still comes from the exact same actedStepKeys set
 * (OrganizationOnboardingStep rows), so skipOnboardingStepAction("CREATE_TASK")/
 * ("INVITE_TEAMMATE") — completely unmodified — keeps working as-is.
 *
 * Role is threaded in only as much as needed to avoid an impossible CTA
 * (locked spec §8) — this module never re-implements or duplicates real
 * authorization; canActVisibleStep() below mirrors (never redefines) the
 * exact same boundaries canManageCompanyProfile()/canManageInvitations()
 * already enforce server-side. Hiding/relabeling a CTA here changes
 * nothing about what those real checks allow.
 */

export type VisibleOnboardingStepStatus = "NOT_STARTED" | "COMPLETE" | "SKIPPED";

export type VisibleOnboardingStep = {
  key: VisibleStepKey;
  label: string;
  description: string;
  status: VisibleOnboardingStepStatus;
  required: boolean;
  skippable: boolean;
  targetHref: string;
  /** False only while NOT_STARTED and blocked behind an incomplete dependency (never role-driven — role is a separate, independent signal below). */
  dependencySatisfied: boolean;
  /** True when the current role is allowed to act on this exact step (the real, server-side boundary this only ever mirrors — see file header). Always true for a step with no role restriction. */
  roleCanAct: boolean;
  /** Set only when NOT_STARTED, dependency-satisfied, and the current role cannot act — the short, non-technical explanation to show in place of a CTA that would otherwise fail authorization. */
  roleBlockedMessage: string | null;
};

export type VisibleOnboardingProgress = {
  steps: VisibleOnboardingStep[];
  completedCount: number;
  totalCount: number;
  percent: number;
  isComplete: boolean;
  /**
   * The one step to actually show (locked spec §5): the first NOT_STARTED
   * step, in canonical order, whose dependency is satisfied — regardless
   * of role. A role-blocked step is still legitimately "next" (it's real,
   * outstanding work for the organization); the card decides how to
   * present it (CTA vs. roleBlockedMessage) using that step's own
   * roleCanAct/roleBlockedMessage fields, never by skipping past it.
   */
  nextStep: VisibleOnboardingStep | null;
};

const ROLE_BLOCKED_MESSAGES: Partial<Record<VisibleStepKey, string>> = {
  COMPANY_PROFILE: "Ask your workspace owner to complete the company profile.",
  INVITE_TEAMMATE: "Ask your workspace owner or an admin to send this invite.",
};

/**
 * Mirrors (never redefines) the exact real, existing authorization
 * boundaries: canManageCompanyProfile() (src/lib/organization-setup/
 * authorization.ts, OWNER-only) for Company Profile, and the same OWNER/
 * ADMIN boundary team/actions.ts's own canManageInvitations() and
 * portal-access-actions.ts's own inline check already enforce for the
 * Invite step. Every other visible step has no role restriction at all —
 * ordinary business-record CRUD any staff role may perform.
 */
function canActVisibleStep(key: VisibleStepKey, role: Role): boolean {
  if (key === "COMPANY_PROFILE") {
    return role === Role.OWNER;
  }
  if (key === "INVITE_TEAMMATE") {
    return role === Role.OWNER || role === Role.ADMIN;
  }
  return true;
}

function isStepDoneByData(key: VisibleStepKey, signals: OnboardingRawSignals): boolean {
  switch (key) {
    case "COMPANY_PROFILE":
      return signals.hasCompanyProfile;
    case "CREATE_CLIENT":
      return signals.hasClient;
    case "CREATE_PROJECT":
      return signals.hasProject;
    case "CREATE_TASK":
      // Task-or-Invoice (locked spec §2 step 4) — either satisfies it.
      return signals.hasTask || signals.hasInvoice;
    case "INVITE_TEAMMATE":
      // Invite-teammate-or-client (locked spec §2 step 5) — either satisfies it.
      return signals.hasSecondMember || signals.hasPortalUser;
  }
}

export function buildVisibleOnboardingProgress(signals: OnboardingRawSignals, role: Role): VisibleOnboardingProgress {
  const resultsByKey = {} as Record<VisibleStepKey, VisibleOnboardingStep>;

  for (const key of VISIBLE_STEP_ORDER) {
    const def: VisibleStepDefinition = VISIBLE_STEPS[key];
    const roleCanAct = canActVisibleStep(key, role);

    let status: VisibleOnboardingStepStatus;
    if (isStepDoneByData(key, signals)) {
      status = "COMPLETE";
    } else if (def.skippable && signals.actedStepKeys.has(key)) {
      status = "SKIPPED";
    } else {
      status = "NOT_STARTED";
    }

    const depKey = def.dependsOn;
    const dependencySatisfied = !depKey || resultsByKey[depKey]?.status === "COMPLETE";

    const roleBlockedMessage =
      status === "NOT_STARTED" && dependencySatisfied && !roleCanAct ? (ROLE_BLOCKED_MESSAGES[key] ?? null) : null;

    resultsByKey[key] = {
      key,
      label: def.label,
      description: def.description,
      status,
      required: def.required,
      skippable: def.skippable,
      targetHref: def.targetHref,
      dependencySatisfied,
      roleCanAct,
      roleBlockedMessage,
    };
  }

  const steps = VISIBLE_STEP_ORDER.map((key) => resultsByKey[key]);
  const completedCount = steps.filter((s) => s.status === "COMPLETE" || s.status === "SKIPPED").length;
  const totalCount = steps.length;
  const percent = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);
  const isComplete = steps.every((s) => s.status === "COMPLETE" || s.status === "SKIPPED");
  const nextStep = steps.find((s) => s.status === "NOT_STARTED" && s.dependencySatisfied) ?? null;

  return { steps, completedCount, totalCount, percent, isComplete, nextStep };
}

/**
 * The DB-backed entry point the Dashboard page uses. Reuses the exact
 * same raw-signal query getOrganizationOnboardingProgress() itself calls
 * (getOrganizationOnboardingSignals, ./progress.ts) — one Promise.all,
 * shared with the legacy 11-step computation, never a duplicate query.
 */
export async function getVisibleOnboardingProgress(
  organizationId: string,
  role: Role,
): Promise<VisibleOnboardingProgress> {
  const signals = await getOrganizationOnboardingSignals(organizationId);
  return buildVisibleOnboardingProgress(signals, role);
}

/**
 * Convenience wrapper mirroring getCurrentOrganizationOnboardingProgress()
 * in ./progress.ts exactly — resolves organizationId AND role server-side
 * via getCurrentMembership(), never accepted as parameters, so a caller
 * can never read another organization's progress or masquerade a role.
 */
export async function getCurrentVisibleOnboardingProgress(): Promise<VisibleOnboardingProgress> {
  const { organizationId, membership } = await getCurrentMembership();
  return getVisibleOnboardingProgress(organizationId, membership.role);
}
