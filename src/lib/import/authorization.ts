import type { Role } from "@/generated/prisma/enums";

/**
 * CSV Import Phase 2 — the one shared "who may import bulk data" rule.
 * Deliberately identical to src/lib/export/authorization.ts's own
 * canExportData: bulk import is at least as high a blast-radius
 * operation as export (it creates real Client/Lead rows, potentially by
 * the thousands, in one request) — the same OWNER+ADMIN "privileged"
 * tier this app already uses for Tags/Custom Statuses/Custom Fields/
 * Workflow Automations/Export, not the "any Staff role" tier ordinary
 * Client/Lead CRUD itself uses. MEMBER is blocked server-side; Portal
 * has no access at all (Portal identities never reach this code path —
 * see getCurrentMembership()'s own redirect-to-/portal behavior).
 */
export function canImportData(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}
