import { describe, expect, it, vi } from "vitest";
import { Role } from "@/generated/prisma/enums";
import type { OnboardingRawSignals } from "@/lib/onboarding/progress";
import { VISIBLE_STEPS } from "@/lib/onboarding/visible-steps";

vi.mock("server-only", () => ({}));

const { buildVisibleOnboardingProgress } = await import("@/lib/onboarding/visible-progress");
const { resolveOnboardingCtaHref, uniqueCandidateId } = await import("@/lib/onboarding/next-step-context");

// First-Time User Experience V2, Slice C — the pure decision: one eligible
// record -> its id on the generic href; zero/several/failure -> generic;
// never newest/first, never from=project, no query when not applicable.

const ORG = "00000000-0000-4000-8000-0000000000aa";
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

function signals(overrides: Partial<OnboardingRawSignals> = {}): OnboardingRawSignals {
  return {
    hasClient: false,
    hasProject: false,
    hasTask: false,
    hasInvoice: false,
    hasSecondMember: false,
    hasPortalUser: false,
    hasCompanyProfile: true,
    hasPaymentDetails: false,
    hasDomainSettings: false,
    hasPresetApplication: false,
    actedStepKeys: new Set(),
    ...overrides,
  };
}

const atProjectStep = (role: Role = Role.OWNER, extra: Partial<OnboardingRawSignals> = {}) =>
  buildVisibleOnboardingProgress(signals({ hasClient: true, ...extra }), role);
const atTaskStep = (role: Role = Role.OWNER) => buildVisibleOnboardingProgress(signals({ hasClient: true, hasProject: true }), role);

function finders(clients: { id: string }[] = [], projects: { id: string }[] = []) {
  return {
    findEligibleClients: vi.fn(async () => clients),
    findEligibleProjects: vi.fn(async () => projects),
  };
}

describe("uniqueCandidateId", () => {
  it("is the id only for exactly one candidate", () => {
    expect(uniqueCandidateId([])).toBeNull();
    expect(uniqueCandidateId([{ id: ID_A }])).toBe(ID_A);
    expect(uniqueCandidateId([{ id: ID_A }, { id: ID_B }])).toBeNull();
  });
});

describe("resolveOnboardingCtaHref — Create first project", () => {
  it("zero eligible clients -> generic", async () => {
    expect(await resolveOnboardingCtaHref({ organizationId: ORG, progress: atProjectStep(), isDismissed: false }, finders([]))).toBeNull();
  });

  it("exactly one eligible client -> its id", async () => {
    const f = finders([{ id: ID_A }]);
    expect(await resolveOnboardingCtaHref({ organizationId: ORG, progress: atProjectStep(), isDismissed: false }, f)).toBe(`/projects/new?clientId=${ID_A}`);
    expect(f.findEligibleClients).toHaveBeenCalledExactlyOnceWith(ORG);
    expect(f.findEligibleProjects).not.toHaveBeenCalled();
  });

  it("several eligible clients -> generic (never newest/first)", async () => {
    expect(
      await resolveOnboardingCtaHref({ organizationId: ORG, progress: atProjectStep(), isDismissed: false }, finders([{ id: ID_A }, { id: ID_B }])),
    ).toBeNull();
  });
});

describe("resolveOnboardingCtaHref — Create first task", () => {
  it("zero eligible projects -> generic", async () => {
    expect(await resolveOnboardingCtaHref({ organizationId: ORG, progress: atTaskStep(), isDismissed: false }, finders())).toBeNull();
  });

  it("exactly one eligible project -> its id, and never from=project", async () => {
    const f = finders([], [{ id: ID_A }]);
    const href = await resolveOnboardingCtaHref({ organizationId: ORG, progress: atTaskStep(), isDismissed: false }, f);
    expect(href).toBe(`/tasks/new?projectId=${ID_A}`);
    expect(href).not.toContain("from=");
    expect(f.findEligibleProjects).toHaveBeenCalledExactlyOnceWith(ORG);
    expect(f.findEligibleClients).not.toHaveBeenCalled();
  });

  it("several eligible projects -> generic", async () => {
    expect(await resolveOnboardingCtaHref({ organizationId: ORG, progress: atTaskStep(), isDismissed: false }, finders([], [{ id: ID_A }, { id: ID_B }]))).toBeNull();
  });
});

describe("resolveOnboardingCtaHref — when no query may run", () => {
  it("complete onboarding, dismissed onboarding, other steps and role-blocked steps never query", async () => {
    const f = finders([{ id: ID_A }], [{ id: ID_A }]);
    const complete = buildVisibleOnboardingProgress(
      signals({ hasClient: true, hasProject: true, hasTask: true, hasSecondMember: true }),
      Role.OWNER,
    );
    const atClientStep = buildVisibleOnboardingProgress(signals(), Role.OWNER);
    const atCompanyStepMember = buildVisibleOnboardingProgress(signals({ hasCompanyProfile: false }), Role.MEMBER);

    expect(complete.isComplete).toBe(true);
    expect(await resolveOnboardingCtaHref({ organizationId: ORG, progress: complete, isDismissed: false }, f)).toBeNull();
    expect(await resolveOnboardingCtaHref({ organizationId: ORG, progress: atProjectStep(), isDismissed: true }, f)).toBeNull();
    expect(atClientStep.nextStep?.key).toBe("CREATE_CLIENT");
    expect(await resolveOnboardingCtaHref({ organizationId: ORG, progress: atClientStep, isDismissed: false }, f)).toBeNull();
    expect(atCompanyStepMember.nextStep?.roleBlockedMessage).toBeTruthy();
    expect(await resolveOnboardingCtaHref({ organizationId: ORG, progress: atCompanyStepMember, isDismissed: false }, f)).toBeNull();

    expect(f.findEligibleClients).not.toHaveBeenCalled();
    expect(f.findEligibleProjects).not.toHaveBeenCalled();
  });

  it("a MEMBER (no role restriction on these steps) still gets the contextual link", async () => {
    expect(
      await resolveOnboardingCtaHref({ organizationId: ORG, progress: atProjectStep(Role.MEMBER), isDismissed: false }, finders([{ id: ID_A }])),
    ).toBe(`/projects/new?clientId=${ID_A}`);
  });
});

describe("resolveOnboardingCtaHref — failure", () => {
  it("a failing query falls back to the generic link without throwing or leaking the error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failing = {
      findEligibleClients: vi.fn(async () => {
        throw new Error("connection string postgres://secret");
      }),
      findEligibleProjects: vi.fn(),
    };

    expect(await resolveOnboardingCtaHref({ organizationId: ORG, progress: atProjectStep(), isDismissed: false }, failing)).toBeNull();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
    warn.mockRestore();
  });
});

describe("static catalog is unchanged", () => {
  it("step identity, generic hrefs and copy stay exactly as before", () => {
    expect(VISIBLE_STEPS.CREATE_PROJECT.targetHref).toBe("/projects/new");
    expect(VISIBLE_STEPS.CREATE_TASK.targetHref).toBe("/tasks/new");
    expect(VISIBLE_STEPS.CREATE_PROJECT.label).toBe("Create your first project");
    expect(VISIBLE_STEPS.CREATE_TASK.label).toBe("Create a task or invoice");
    expect(VISIBLE_STEPS.CREATE_TASK.description).toBe(
      "Add a task to track your work, or create an invoice — either one moves you forward.",
    );
    expect(atTaskStep().nextStep?.targetHref).toBe("/tasks/new");
  });
});
