/**
 * Billing & Subscriptions Stage 2 (docs/billing-architecture.md §6, refined
 * by this stage's own exact instructions). The single, typed, compile-time
 * plan catalog — no `Plan` table, no provider price IDs anywhere in this
 * file. Every number here is an explicit product-config placeholder for
 * this stage, not a committed pricing decision (see docs/billing-
 * architecture.md §3's own disclaimer) — changing one is a code review +
 * deploy, never a runtime database edit. Provider price IDs are Stage 3+'s
 * concern, sourced from env vars at that point, never hardcoded here.
 */

export type PlanKey = "TRIAL" | "STARTER" | "PRO" | "LEGACY";

export type PlanLimits = {
  /** Always a concrete ceiling — this app's staff-seat cost is real at every plan, including LEGACY (see that plan's own comment). */
  maxMembers: number;
  /** `null` means unlimited. */
  maxClients: number | null;
  /** `null` means unlimited. */
  maxProjects: number | null;
  /** Always a concrete ceiling in bytes — see LEGACY's own comment for why "unlimited" is still expressed as a real number here. */
  maxStorageBytes: number;
};

export type Plan = {
  key: PlanKey;
  displayName: string;
  limits: PlanLimits;
  /** Non-null only for TRIAL. */
  trialDays: number | null;
  /** Whether this plan can ever be the target of a real checkout (Stage 3+) — false for TRIAL/LEGACY, which are never purchased. */
  billingAvailable: boolean;
};

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const TRIAL_DURATION_DAYS = 14;

/**
 * Two paid tiers + one trial tier + one internal-only legacy tier —
 * deliberately not more (docs/billing-architecture.md §3 explicitly warns
 * against over-fragmenting the tier list). TRIAL mirrors PRO's limits (the
 * design doc's own "trial mirrors Pro" decision), so a trialing org never
 * hits an artificial ceiling before it's even chosen a plan.
 */
export const PLAN_CATALOG: Readonly<Record<PlanKey, Plan>> = {
  TRIAL: {
    key: "TRIAL",
    displayName: "Trial",
    limits: { maxMembers: 5, maxClients: null, maxProjects: null, maxStorageBytes: 10 * GB },
    trialDays: TRIAL_DURATION_DAYS,
    billingAvailable: false,
  },
  STARTER: {
    key: "STARTER",
    displayName: "Starter",
    limits: { maxMembers: 1, maxClients: 10, maxProjects: 20, maxStorageBytes: 500 * MB },
    trialDays: null,
    billingAvailable: true,
  },
  PRO: {
    key: "PRO",
    displayName: "Pro",
    limits: { maxMembers: 5, maxClients: null, maxProjects: null, maxStorageBytes: 10 * GB },
    trialDays: null,
    billingAvailable: true,
  },
  // Pre-billing organizations (created before this stage shipped, and
  // optionally backfilled by prisma/backfill-subscriptions.ts — never
  // auto-created by this stage's own migration). Never sold, never
  // choosable by a user in any UI — a fixed, generous ceiling rather than
  // a literal "unlimited" so every consumer of PlanLimits can stay a plain
  // number comparison with no special-cased null-means-infinite branch for
  // this one plan alone.
  LEGACY: {
    key: "LEGACY",
    displayName: "Legacy (pre-billing)",
    limits: { maxMembers: 1000, maxClients: null, maxProjects: null, maxStorageBytes: 1024 * GB },
    trialDays: null,
    billingAvailable: false,
  },
} as const;

export const DEFAULT_TRIAL_PLAN_KEY: PlanKey = "TRIAL";
export const LEGACY_PLAN_KEY: PlanKey = "LEGACY";

/**
 * Free Public Beta, Slice 1 (Storage Limit Adjustment). The Product
 * Owner-approved effective storage ceiling for EVERY organization while
 * `FREE_BETA_MODE=true` — deliberately NOT a PLAN_CATALOG entry and
 * deliberately NOT a change to TRIAL's own `maxStorageBytes` above: this
 * value is applied as an override at the one centralized entitlement
 * chokepoint (buildOrganizationEntitlements, src/lib/billing/
 * entitlements.ts), regardless of an organization's real `planKey`
 * (TRIAL/STARTER/PRO/LEGACY) or `status` — never by mutating this catalog,
 * which must keep reporting each real plan's own true, unaffected
 * allowance for when the beta ends and real billing enforcement resumes.
 * Reuses the same `GB` unit constant as every other value in this file,
 * so `3 * GB` is exactly `3 * 1024 * 1024 * 1024 = 3221225472` bytes —
 * never a separately-typed-out literal that could silently drift from
 * this file's own byte-unit convention.
 */
export const FREE_BETA_MAX_STORAGE_BYTES = 3 * GB;

/**
 * Free Public Beta, Slice 1 (Member Limit Consistency). Same exact
 * pattern as `FREE_BETA_MAX_STORAGE_BYTES` immediately above —
 * deliberately NOT a PLAN_CATALOG entry: this is the Product Owner-
 * approved effective member ceiling for EVERY organization while
 * `FREE_BETA_MODE=true`, applied as an override at the one centralized
 * entitlement chokepoint (buildOrganizationEntitlements, src/lib/billing/
 * entitlements.ts), regardless of an organization's real `planKey`
 * (TRIAL/STARTER/PRO/LEGACY) or `status`. Fixes the confirmed gap where a
 * LEGACY organization (maxMembers: 1000 natively) displayed and enforced
 * that native 1000-seat ceiling even during the beta, instead of the
 * approved 5-seat limit — the storage override already got this right;
 * `maxMembers` simply never had the equivalent override. PLAN_CATALOG's
 * own native values (TRIAL/PRO: 5, STARTER: 1, LEGACY: 1000) are
 * completely untouched by this — each plan's real allowance is exactly
 * what's restored the moment `freeBetaMode` is false again.
 */
export const FREE_BETA_MAX_MEMBERS = 5;

export function getPlan(key: PlanKey): Plan {
  return PLAN_CATALOG[key];
}

export function isPlanKey(value: string): value is PlanKey {
  return Object.prototype.hasOwnProperty.call(PLAN_CATALOG, value);
}

/** Every PlanKey, for exhaustive iteration (catalog-consistency tests, etc.) — never mutated, never used to build a Prisma enum. */
export const ALL_PLAN_KEYS: readonly PlanKey[] = Object.keys(PLAN_CATALOG) as PlanKey[];
