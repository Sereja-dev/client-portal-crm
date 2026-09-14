import type { Role } from "@/generated/prisma/enums";

/**
 * Reports Phase 1 (read-only architecture/readiness audit, then this
 * foundation). Reports is its own semantic authorization boundary —
 * deliberately NOT a reuse of `canExportData`/`canImportData`
 * (src/lib/export/authorization.ts, src/lib/import/authorization.ts)
 * merely because their OWNER+ADMIN role set currently happens to match.
 * Export/Import gate "may this Staff member move bulk data in/out of the
 * app"; Reports gates "may this Staff member see aggregate financial/
 * business numbers about the organization" — two different concerns that
 * should be free to diverge independently in the future (e.g. a later
 * stage loosening Export to include MEMBER must never accidentally loosen
 * Reports too, and vice versa). Mirrors src/lib/analytics/authorization.ts
 * exactly in shape — Reports is a close sibling of Analytics in
 * sensitivity (aggregate business data, not a single record on screen),
 * not of ordinary Client/Lead/Time Entry CRUD, which stays open to every
 * Staff role including MEMBER.
 *
 * MEMBER is a hard block. Client Portal identities never reach this at
 * all — every future Reports call site lives under the `(dashboard)`
 * route group, whose layout already redirects any Portal-only identity to
 * `/portal` before any Reports code is ever called (same guarantee
 * Analytics' own authorization.ts documents).
 */
export class ReportsAccessError extends Error {
  constructor() {
    super("Reports is only available to organization owners and admins.");
    this.name = "ReportsAccessError";
  }
}

export function canViewReports(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Throws `ReportsAccessError` for MEMBER — every Reports query entry point calls this first, so no query below it ever runs for an unauthorized role. */
export function assertCanViewReports(role: Role): void {
  if (!canViewReports(role)) {
    throw new ReportsAccessError();
  }
}
