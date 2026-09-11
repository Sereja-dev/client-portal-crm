import type { Role } from "@/generated/prisma/enums";

/**
 * Time Tracking Phase 2A (Staff UI) — pure, client-safe mirror of the
 * Phase 1 domain layer's own "own entry, or OWNER/ADMIN" authorization
 * rule (see entries.ts's own `isOwnEntry || isPrivileged(actor.role)`
 * check, repeated identically across createTimeEntry/updateTimeEntry/
 * archiveTimeEntry/unarchiveTimeEntry). Used only to decide what the UI
 * *renders* (manage controls vs. a read-only view) — never the actual
 * authorization boundary, which is always the unchanged Phase 1 domain
 * functions themselves, re-verified independently of whatever this
 * returns.
 */
export function canManageTimeEntry(entryUserId: string | null, actorId: string, actorRole: Role): boolean {
  return entryUserId === actorId || actorRole === "OWNER" || actorRole === "ADMIN";
}

export function isPrivilegedRole(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}
