import type { Role } from "@/generated/prisma/enums";

export type CalendarEventActor = { id: string; name: string; role: Role };

/**
 * Calendar V1 — deliberately NO privileged-role gate anywhere in this
 * domain module, mirroring src/lib/contracts/authorization.ts's own
 * exact "operational record, not organization-wide configuration"
 * reasoning (locked architecture §5): every authenticated Staff
 * Membership role (OWNER/ADMIN/MEMBER) may view/create/edit/archive/
 * restore a CalendarEvent, with no creator-only or assignee-only
 * restriction. Roles / Permissions is a later, separate roadmap block —
 * this module exists only so a future change to who may manage the
 * Calendar has exactly one place to update, matching
 * canManageContracts()/canApplyQuoteTemplates()'s own identical
 * "documented, not gated" shape.
 */
export function canManageCalendarEvents(role: Role): boolean {
  // `role` is intentionally not branched on today (see this function's
  // own doc comment) -- the reference below keeps the parameter a real,
  // checked part of this function's signature (for the day Calendar
  // permissions genuinely differ by role) rather than a vestigial unused
  // one.
  return role != null;
}
