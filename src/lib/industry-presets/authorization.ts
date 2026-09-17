import type { Role } from "@/generated/prisma/enums";

export type IndustryPresetActor = { id: string; name: string; role: Role };

/**
 * Industry Presets V1 — the one shared "who may view/apply" rule (locked
 * spec §5/§Application-semantics). Two tiers, mirroring
 * src/lib/quote-templates/authorization.ts's own exact shape:
 *
 * - VIEW/PREVIEW (see the catalog, preview a preset's ADD/SKIP items) is
 *   open to any Staff role, including MEMBER — a preset is read-only
 *   information about what applying it would do, the same "any role may
 *   view organization-wide config" tier Custom Fields/Custom Statuses
 *   already occupy in this app (see settings-nav.tsx's own comment for
 *   that precedent) — never the OWNER/ADMIN-only tier Tags/Workflow
 *   Automations occupy.
 * - APPLY (actually create the preset's statuses/fields/tags) is
 *   OWNER/ADMIN-only — a preset application is a one-time, effectively
 *   irreversible organization-wide mutation (locked spec: "preset
 *   switching is not supported in V1"), the same privileged tier
 *   createTag/createWorkflowAutomation already gate.
 *
 * MEMBER is a hard block for apply only, enforced here and re-checked
 * server-side at every real entry point (apply.ts's own
 * applyIndustryPreset, never trusted from a disabled button alone —
 * locked spec §5: "Server-side authorization mandatory"). Client Portal
 * identities never reach either function at all — every call site lives
 * under the `(dashboard)` route group, whose layout already redirects
 * any Portal-only identity to `/portal` before this module's code ever
 * runs (same guarantee every other Staff-only domain module in this app
 * already documents).
 */
export class IndustryPresetAccessError extends Error {
  constructor() {
    super("Industry Presets can only be applied by organization owners and admins.");
    this.name = "IndustryPresetAccessError";
  }
}

/** Any Staff role (OWNER/ADMIN/MEMBER) may view the catalog and preview a preset. */
export function canViewIndustryPresets(role: Role): boolean {
  // `role` is intentionally not branched on today (see this function's
  // own doc comment) -- the reference below keeps the parameter a real,
  // checked part of this function's signature, mirroring
  // canApplyQuoteTemplates's own identical "always true, but a real
  // function, not an inlined literal" precedent.
  return role != null;
}

export function canApplyIndustryPreset(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Throws `IndustryPresetAccessError` for MEMBER — applyIndustryPreset calls this first, before any DB read, so no write below it ever runs for an unauthorized role. */
export function assertCanApplyIndustryPreset(role: Role): void {
  if (!canApplyIndustryPreset(role)) {
    throw new IndustryPresetAccessError();
  }
}
