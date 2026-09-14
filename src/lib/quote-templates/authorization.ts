import type { Role } from "@/generated/prisma/enums";

export type QuoteTemplateActor = { id: string; name: string; role: Role };

/**
 * Quote Templates Phase 1 — the one shared "who may manage/apply a Quote
 * Template" rule. Two distinct tiers, directly derived from this app's
 * own existing permission architecture (never invented independently —
 * see the completed Templates architecture audit's own §10):
 *
 * - MANAGEMENT (create/edit/archive/restore/duplicate) is OWNER/ADMIN-only
 *   — mirrors src/lib/tags/definitions.ts's own isPrivileged() gate
 *   exactly (a Quote Template is an organization-wide config asset, the
 *   same tier Tags/Workflow Automations/Custom Field definitions already
 *   occupy, never the "any Staff role" tier ordinary Quote CRUD itself
 *   uses).
 * - APPLICATION (using an ACTIVE template to prefill a new Quote) is open
 *   to any Staff role already permitted to create a Quote. Confirmed by
 *   inspection: src/app/(dashboard)/quotes/actions.ts's own
 *   createQuoteAction has no role check at all today — any authenticated
 *   Staff member with a Membership in the organization may create a
 *   Quote. canApplyQuoteTemplates() below exists as its own named,
 *   documented function (not a bare "always true" inlined at each call
 *   site) so a future change to Quote-create permissions has exactly one
 *   place to update, and the "why" for today's "any role" answer stays
 *   attached to the code that encodes it — this module deliberately does
 *   NOT introduce a new Quote-create permission system of its own.
 *
 * MEMBER is a hard block for management only. Client Portal identities
 * never reach either function at all — every future Quote Template call
 * site lives under the `(dashboard)` route group, whose layout already
 * redirects any Portal-only identity to `/portal` before any of this
 * module's code is ever called (same guarantee every other Staff-only
 * domain module in this app already documents).
 */
export class QuoteTemplateAccessError extends Error {
  constructor() {
    super("Quote Templates can only be managed by organization owners and admins.");
    this.name = "QuoteTemplateAccessError";
  }
}

export function canManageQuoteTemplates(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Throws `QuoteTemplateAccessError` for MEMBER — every management entry point (create/update/archive/restore/duplicate) calls this first, before any DB read, so no query below it ever runs for an unauthorized role. */
export function assertCanManageQuoteTemplates(role: Role): void {
  if (!canManageQuoteTemplates(role)) {
    throw new QuoteTemplateAccessError();
  }
}

/**
 * Applying an ACTIVE template is exactly as permissive as creating an
 * ordinary Quote — currently every Staff role. Returns `true`
 * unconditionally today (documented above); never used to gate
 * management actions, and never a substitute for
 * assertCanManageQuoteTemplates().
 */
export function canApplyQuoteTemplates(role: Role): boolean {
  // `role` is intentionally not branched on today (see this function's
  // own doc comment) -- the reference below keeps the parameter a real,
  // checked part of this function's signature (for the day Quote-create
  // permissions genuinely differ by role) rather than a vestigial unused
  // one.
  return role != null;
}
