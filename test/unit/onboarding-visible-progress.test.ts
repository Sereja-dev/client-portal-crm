import { describe, expect, it, vi } from "vitest";
import { Role } from "@/generated/prisma/enums";
import type { OnboardingStepKey } from "@/generated/prisma/enums";
import type { OnboardingRawSignals } from "@/lib/onboarding/progress";
import { VISIBLE_STEP_ORDER } from "@/lib/onboarding/visible-steps";

// visible-progress.ts imports the real "server-only" marker package (it
// also exports a DB-backed function, getVisibleOnboardingProgress) — see
// test/unit/recovery-token.test.ts's own header comment for why this
// needs neutralizing here rather than disabling the guard globally.
vi.mock("server-only", () => ({}));

const { buildVisibleOnboardingProgress } = await import("@/lib/onboarding/visible-progress");
type VisibleOnboardingStep = Awaited<ReturnType<typeof buildVisibleOnboardingProgress>>["steps"][number];

/**
 * Onboarding Redesign — the new 5-step model's own pure-function
 * coverage, mirroring test/unit/onboarding-progress.test.ts's own
 * fixture-builder shape exactly. buildOnboardingProgress()/steps.ts (the
 * legacy 11-step engine) are completely untouched by this redesign — see
 * that file's own still-passing, unmodified test suite for its coverage.
 */

function signals(overrides: Partial<OnboardingRawSignals> = {}): OnboardingRawSignals {
  return {
    hasClient: false,
    hasProject: false,
    hasTask: false,
    hasInvoice: false,
    hasSecondMember: false,
    hasPortalUser: false,
    hasCompanyProfile: false,
    hasPaymentDetails: false,
    hasDomainSettings: false,
    hasPresetApplication: false,
    actedStepKeys: new Set<OnboardingStepKey>(),
    ...overrides,
  };
}

function stepOf(steps: VisibleOnboardingStep[], key: OnboardingStepKey): VisibleOnboardingStep {
  return steps.find((s) => s.key === key)!;
}

describe("buildVisibleOnboardingProgress — structure", () => {
  it("1. the visible catalog has exactly 5 logical steps, in the approved order", () => {
    expect(VISIBLE_STEP_ORDER).toEqual(["COMPANY_PROFILE", "CREATE_CLIENT", "CREATE_PROJECT", "CREATE_TASK", "INVITE_TEAMMATE"]);
    const progress = buildVisibleOnboardingProgress(signals(), Role.OWNER);
    expect(progress.steps).toHaveLength(5);
    expect(progress.steps.map((s) => s.key)).toEqual(VISIBLE_STEP_ORDER);
  });

  it("20. WELCOME, FINISH, and every legacy admin/optional step (INDUSTRY_PRESET, PAYMENT_DETAILS, DOMAIN_SETUP, INVITE_PORTAL_USER, REVIEW_BILLING) are never rendered as a visible step", () => {
    const progress = buildVisibleOnboardingProgress(signals(), Role.OWNER);
    const keys = progress.steps.map((s) => s.key);
    for (const legacyOnly of ["WELCOME", "FINISH", "INDUSTRY_PRESET", "PAYMENT_DETAILS", "DOMAIN_SETUP", "INVITE_PORTAL_USER", "REVIEW_BILLING"]) {
      expect(keys).not.toContain(legacyOnly);
    }
  });
});

describe("buildVisibleOnboardingProgress — progress fraction", () => {
  it("2a. a fresh, empty organization shows 0 of 5", () => {
    const progress = buildVisibleOnboardingProgress(signals(), Role.OWNER);
    expect(progress.completedCount).toBe(0);
    expect(progress.totalCount).toBe(5);
    expect(progress.percent).toBe(0);
    expect(progress.isComplete).toBe(false);
  });

  it("2b. two real steps complete shows 2 of 5", () => {
    const progress = buildVisibleOnboardingProgress(signals({ hasCompanyProfile: true, hasClient: true }), Role.OWNER);
    expect(progress.completedCount).toBe(2);
    expect(progress.totalCount).toBe(5);
    expect(progress.percent).toBe(40);
  });

  it("2c. all 5 complete/skipped shows 5 of 5, isComplete true", () => {
    const progress = buildVisibleOnboardingProgress(
      signals({
        hasCompanyProfile: true,
        hasClient: true,
        hasProject: true,
        hasTask: true,
        hasSecondMember: true,
      }),
      Role.OWNER,
    );
    expect(progress.completedCount).toBe(5);
    expect(progress.totalCount).toBe(5);
    expect(progress.percent).toBe(100);
    expect(progress.isComplete).toBe(true);
  });

  it("3. legacy-only acted rows (REVIEW_BILLING, DOMAIN_SETUP skipped) never affect the 5-step denominator or count", () => {
    const withLegacyActs = buildVisibleOnboardingProgress(
      signals({ actedStepKeys: new Set<OnboardingStepKey>(["REVIEW_BILLING", "DOMAIN_SETUP", "INDUSTRY_PRESET", "PAYMENT_DETAILS"]) }),
      Role.OWNER,
    );
    const withoutLegacyActs = buildVisibleOnboardingProgress(signals(), Role.OWNER);
    expect(withLegacyActs.completedCount).toBe(withoutLegacyActs.completedCount);
    expect(withLegacyActs.totalCount).toBe(5);
    expect(withLegacyActs.steps.map((s) => s.status)).toEqual(withoutLegacyActs.steps.map((s) => s.status));
  });
});

describe("buildVisibleOnboardingProgress — per-step completion", () => {
  it("4. Company Profile completes from hasCompanyProfile alone", () => {
    const progress = buildVisibleOnboardingProgress(signals({ hasCompanyProfile: true }), Role.OWNER);
    expect(stepOf(progress.steps, "COMPANY_PROFILE").status).toBe("COMPLETE");
  });

  it("5. Client completes from hasClient alone", () => {
    const progress = buildVisibleOnboardingProgress(signals({ hasClient: true }), Role.OWNER);
    expect(stepOf(progress.steps, "CREATE_CLIENT").status).toBe("COMPLETE");
  });

  it("6. Project completes from hasProject, and is blocked (dependencySatisfied: false) until Client is complete", () => {
    const blocked = buildVisibleOnboardingProgress(signals({ hasProject: true }), Role.OWNER);
    // hasProject alone (no real Client) is a synthetic case for this unit
    // test only — dependencySatisfied is computed purely from this
    // model's own CREATE_CLIENT result, independent of hasProject.
    expect(stepOf(blocked.steps, "CREATE_PROJECT").dependencySatisfied).toBe(false);

    const unblocked = buildVisibleOnboardingProgress(signals({ hasClient: true, hasProject: true }), Role.OWNER);
    expect(stepOf(unblocked.steps, "CREATE_PROJECT").status).toBe("COMPLETE");
    expect(stepOf(unblocked.steps, "CREATE_PROJECT").dependencySatisfied).toBe(true);
  });

  it("7. a real Task completes step 4 (Task-or-Invoice)", () => {
    const progress = buildVisibleOnboardingProgress(signals({ hasTask: true }), Role.OWNER);
    expect(stepOf(progress.steps, "CREATE_TASK").status).toBe("COMPLETE");
  });

  it("8. a real Invoice ALSO completes step 4, with no Task at all", () => {
    const progress = buildVisibleOnboardingProgress(signals({ hasInvoice: true }), Role.OWNER);
    expect(stepOf(progress.steps, "CREATE_TASK").status).toBe("COMPLETE");
  });

  it("9. step 4 is NOT_STARTED when neither a Task nor an Invoice exists", () => {
    const progress = buildVisibleOnboardingProgress(signals({ hasTask: false, hasInvoice: false }), Role.OWNER);
    expect(stepOf(progress.steps, "CREATE_TASK").status).toBe("NOT_STARTED");
  });

  it("10. a second (accepted) Membership completes the Invite step", () => {
    const progress = buildVisibleOnboardingProgress(signals({ hasSecondMember: true }), Role.OWNER);
    expect(stepOf(progress.steps, "INVITE_TEAMMATE").status).toBe("COMPLETE");
  });

  it("11. a Portal user ALSO completes the Invite step, with no second Membership at all", () => {
    const progress = buildVisibleOnboardingProgress(signals({ hasPortalUser: true }), Role.OWNER);
    expect(stepOf(progress.steps, "INVITE_TEAMMATE").status).toBe("COMPLETE");
  });

  it("12. Skip still works for the optional steps (Task-or-Invoice, Invite) via the existing acted-row mechanism; required steps have no skip path", () => {
    const progress = buildVisibleOnboardingProgress(
      signals({ actedStepKeys: new Set<OnboardingStepKey>(["CREATE_TASK", "INVITE_TEAMMATE"]) }),
      Role.OWNER,
    );
    expect(stepOf(progress.steps, "CREATE_TASK").status).toBe("SKIPPED");
    expect(stepOf(progress.steps, "INVITE_TEAMMATE").status).toBe("SKIPPED");
    expect(stepOf(progress.steps, "COMPANY_PROFILE").skippable).toBe(false);
    expect(stepOf(progress.steps, "CREATE_CLIENT").skippable).toBe(false);
    expect(stepOf(progress.steps, "CREATE_PROJECT").skippable).toBe(false);
  });
});

describe("buildVisibleOnboardingProgress — nextStep (exactly one primary step)", () => {
  it("13. nextStep is a single step (or null), never a list", () => {
    const progress = buildVisibleOnboardingProgress(signals(), Role.OWNER);
    expect(progress.nextStep).not.toBeNull();
    expect(Array.isArray(progress.nextStep)).toBe(false);
    expect(progress.nextStep!.key).toBe("COMPANY_PROFILE");
  });

  it("14a. dependency ordering: Project is never nextStep while Client is incomplete — Client (or Company Profile before it) is", () => {
    const progress = buildVisibleOnboardingProgress(signals({ hasCompanyProfile: true }), Role.OWNER);
    expect(progress.nextStep!.key).toBe("CREATE_CLIENT");
  });

  it("14b. once Client is done, Project becomes nextStep", () => {
    const progress = buildVisibleOnboardingProgress(signals({ hasCompanyProfile: true, hasClient: true }), Role.OWNER);
    expect(progress.nextStep!.key).toBe("CREATE_PROJECT");
  });

  it("14c. once the first 3 required steps are done, Task-or-Invoice becomes nextStep", () => {
    const progress = buildVisibleOnboardingProgress(
      signals({ hasCompanyProfile: true, hasClient: true, hasProject: true }),
      Role.OWNER,
    );
    expect(progress.nextStep!.key).toBe("CREATE_TASK");
  });

  it("14d. skipping Task-or-Invoice advances nextStep to Invite", () => {
    const progress = buildVisibleOnboardingProgress(
      signals({
        hasCompanyProfile: true,
        hasClient: true,
        hasProject: true,
        actedStepKeys: new Set<OnboardingStepKey>(["CREATE_TASK"]),
      }),
      Role.OWNER,
    );
    expect(progress.nextStep!.key).toBe("INVITE_TEAMMATE");
  });

  it("nextStep is null once every step is complete/skipped", () => {
    const progress = buildVisibleOnboardingProgress(
      signals({ hasCompanyProfile: true, hasClient: true, hasProject: true, hasTask: true, hasSecondMember: true }),
      Role.OWNER,
    );
    expect(progress.nextStep).toBeNull();
    expect(progress.isComplete).toBe(true);
  });
});

describe("buildVisibleOnboardingProgress — role-aware CTA (locked spec §8)", () => {
  it("15. OWNER gets an actionable Company Profile CTA — roleCanAct true, no blocked message", () => {
    const progress = buildVisibleOnboardingProgress(signals(), Role.OWNER);
    const step = stepOf(progress.steps, "COMPANY_PROFILE");
    expect(step.roleCanAct).toBe(true);
    expect(step.roleBlockedMessage).toBeNull();
  });

  it("16a. ADMIN does not get an actionable Company Profile CTA — shows owner-required messaging instead", () => {
    const progress = buildVisibleOnboardingProgress(signals(), Role.ADMIN);
    const step = stepOf(progress.steps, "COMPANY_PROFILE");
    expect(step.roleCanAct).toBe(false);
    expect(step.roleBlockedMessage).toBe("Ask your workspace owner to complete the company profile.");
  });

  it("16b. MEMBER does not get an actionable Company Profile CTA either", () => {
    const progress = buildVisibleOnboardingProgress(signals(), Role.MEMBER);
    const step = stepOf(progress.steps, "COMPANY_PROFILE");
    expect(step.roleCanAct).toBe(false);
    expect(step.roleBlockedMessage).not.toBeNull();
  });

  it("17. MEMBER does not get an actionable Invite CTA — shows role-required messaging instead", () => {
    const progress = buildVisibleOnboardingProgress(
      signals({ hasCompanyProfile: true, hasClient: true, hasProject: true, hasTask: true }),
      Role.MEMBER,
    );
    const step = stepOf(progress.steps, "INVITE_TEAMMATE");
    expect(step.roleCanAct).toBe(false);
    expect(step.roleBlockedMessage).not.toBeNull();
  });

  it("18. OWNER and ADMIN both get an actionable Invite CTA", () => {
    for (const role of [Role.OWNER, Role.ADMIN]) {
      const progress = buildVisibleOnboardingProgress(signals(), role);
      const step = stepOf(progress.steps, "INVITE_TEAMMATE");
      expect(step.roleCanAct).toBe(true);
      expect(step.roleBlockedMessage).toBeNull();
    }
  });

  it("Client/Project/Task-or-Invoice steps are actionable by every role — no role restriction invented for them", () => {
    for (const role of [Role.OWNER, Role.ADMIN, Role.MEMBER]) {
      const progress = buildVisibleOnboardingProgress(signals(), role);
      expect(stepOf(progress.steps, "CREATE_CLIENT").roleCanAct).toBe(true);
      expect(stepOf(progress.steps, "CREATE_PROJECT").roleCanAct).toBe(true);
      expect(stepOf(progress.steps, "CREATE_TASK").roleCanAct).toBe(true);
    }
  });

  it("roleBlockedMessage is only ever set while NOT_STARTED — a completed/skipped step never shows it, even for a role that couldn't have acted on it", () => {
    const progress = buildVisibleOnboardingProgress(signals({ hasCompanyProfile: true }), Role.MEMBER);
    expect(stepOf(progress.steps, "COMPANY_PROFILE").status).toBe("COMPLETE");
    expect(stepOf(progress.steps, "COMPANY_PROFILE").roleBlockedMessage).toBeNull();
  });
});

describe("buildVisibleOnboardingProgress — demo/sample-data interaction (locked spec §9)", () => {
  it("19. the exact signal shape src/lib/onboarding/sample-data.ts produces (Client+Project+Task, nothing else) yields 3 of 5, never falsely completing Company Profile or Invite", () => {
    // Mirrors createSampleWorkspaceData()'s own real output exactly: 2
    // Clients, 1 Project, 3 Tasks, 1 Invoice — no OrganizationProfile, no
    // second Membership, no PortalUser row.
    const progress = buildVisibleOnboardingProgress(
      signals({ hasClient: true, hasProject: true, hasTask: true, hasInvoice: true }),
      Role.OWNER,
    );
    expect(progress.completedCount).toBe(3);
    expect(progress.totalCount).toBe(5);
    expect(stepOf(progress.steps, "CREATE_CLIENT").status).toBe("COMPLETE");
    expect(stepOf(progress.steps, "CREATE_PROJECT").status).toBe("COMPLETE");
    expect(stepOf(progress.steps, "CREATE_TASK").status).toBe("COMPLETE");
    expect(stepOf(progress.steps, "COMPANY_PROFILE").status).toBe("NOT_STARTED");
    expect(stepOf(progress.steps, "INVITE_TEAMMATE").status).toBe("NOT_STARTED");
    expect(progress.nextStep!.key).toBe("COMPANY_PROFILE");
  });
});
