import type { OnboardingStepKey } from "@/generated/prisma/enums";

/**
 * Onboarding Redesign — the short, product-oriented 4-of-5-numbered set
 * of steps the Dashboard's onboarding card now shows, replacing the
 * previous 11/12-row technical checklist for THIS one surface only. Every
 * key here is a real, existing OnboardingStepKey (COMPANY_PROFILE,
 * CREATE_CLIENT, CREATE_PROJECT, CREATE_TASK, INVITE_TEAMMATE) — reused
 * verbatim so skip/acknowledge actions keep writing to the exact same
 * OrganizationOnboardingStep rows the legacy engine already uses; no new
 * Prisma enum value, no new persisted state (locked spec §2/§4).
 *
 * The legacy catalog (./steps.ts, ONBOARDING_STEPS/ONBOARDING_STEP_ORDER)
 * is completely untouched — it still backs the original 11-step
 * computation for every other consumer (Platform Admin's organization
 * detail view, Analytics' OrganizationActivitySection). This is a
 * deliberately separate, additive presentation layer, not a replacement.
 */

/**
 * The exact 5 legacy OnboardingStepKey values this redesign reuses —
 * never the full 12-key union. Derived via Extract<>, not retyped as a
 * standalone literal union, so a future rename/removal of any of these 5
 * keys in the real Prisma enum (./steps.ts's own OnboardingStepKey) fails
 * to compile here rather than silently drifting.
 */
export type VisibleStepKey = Extract<
  OnboardingStepKey,
  "COMPANY_PROFILE" | "CREATE_CLIENT" | "CREATE_PROJECT" | "CREATE_TASK" | "INVITE_TEAMMATE"
>;

export const VISIBLE_STEP_ORDER: readonly VisibleStepKey[] = [
  "COMPANY_PROFILE",
  "CREATE_CLIENT",
  "CREATE_PROJECT",
  "CREATE_TASK",
  "INVITE_TEAMMATE",
] as const;

export type VisibleStepDefinition = {
  key: VisibleStepKey;
  label: string;
  /** Short, product-oriented copy — never technical/admin wording (locked spec §11). */
  description: string;
  required: boolean;
  skippable: boolean;
  /** The one step in VISIBLE_STEP_ORDER this step is blocked behind, or null. */
  dependsOn: VisibleStepKey | null;
  targetHref: string;
};

export const VISIBLE_STEPS: Readonly<Record<VisibleStepKey, VisibleStepDefinition>> = {
  COMPANY_PROFILE: {
    key: "COMPANY_PROFILE",
    label: "Set up company profile",
    description: "Add your business name and a few basics so invoices and documents look right.",
    required: true,
    skippable: false,
    dependsOn: null,
    targetHref: "/settings/company",
  },
  CREATE_CLIENT: {
    key: "CREATE_CLIENT",
    label: "Add your first client",
    description: "Add the person or business you work with.",
    required: true,
    skippable: false,
    dependsOn: null,
    targetHref: "/clients/new",
  },
  CREATE_PROJECT: {
    key: "CREATE_PROJECT",
    label: "Create your first project",
    description: "Organize your work for this client into a project.",
    required: true,
    skippable: false,
    dependsOn: "CREATE_CLIENT",
    targetHref: "/projects/new",
  },
  CREATE_TASK: {
    key: "CREATE_TASK",
    label: "Create a task or invoice",
    description: "Add a task to track your work, or create an invoice — either one moves you forward.",
    required: false,
    skippable: true,
    dependsOn: "CREATE_PROJECT",
    targetHref: "/tasks/new",
  },
  INVITE_TEAMMATE: {
    key: "INVITE_TEAMMATE",
    label: "Invite a teammate or client",
    description: "Bring a colleague into your workspace, or give a client secure access to their own portal.",
    required: false,
    skippable: true,
    dependsOn: null,
    targetHref: "/team",
  },
} as const;
