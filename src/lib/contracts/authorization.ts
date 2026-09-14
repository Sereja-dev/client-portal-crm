import type { Role } from "@/generated/prisma/enums";

export type ContractActor = { id: string; name: string; role: Role };

/**
 * Contracts Phase 1 — deliberately NO privileged-role gate anywhere in
 * this domain module. Contracts are an operational record like Quote/
 * Invoice, never organization-wide configuration like a Template or a
 * Workflow Automation (see this phase's own architecture-lock report §1/
 * §18): every authenticated Staff Membership role (OWNER/ADMIN/MEMBER)
 * may list/view/create/update-a-DRAFT/send/record-Staff-acceptance/
 * terminate/archive/restore a Contract, matching createQuoteAction's own
 * confirmed-by-inspection "no role check at all" precedent exactly (see
 * src/app/(dashboard)/quotes/actions.ts) rather than Quote *Templates*'
 * own OWNER/ADMIN-only management gate (a genuinely different tier —
 * config/template management, not an operational record).
 *
 * This file exists anyway, as its own small, named module — not because
 * it enforces anything today, but so a future change to who may manage
 * Contracts has exactly one place to update, and the "why" for today's
 * "any role" answer stays attached to the code that encodes it, mirroring
 * canApplyQuoteTemplates()'s own identical "documented, not gated" shape
 * in src/lib/quote-templates/authorization.ts.
 */
export function canManageContracts(role: Role): boolean {
  // `role` is intentionally not branched on today (see this function's
  // own doc comment) -- the reference below keeps the parameter a real,
  // checked part of this function's signature (for the day Contract
  // permissions genuinely differ by role) rather than a vestigial unused
  // one.
  return role != null;
}
