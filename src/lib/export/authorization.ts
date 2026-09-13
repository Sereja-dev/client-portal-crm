import type { Role } from "@/generated/prisma/enums";

/**
 * CSV Import/Export Phase 1 — the one shared "who may export bulk data"
 * rule, shared by the Client and Lead export Route Handlers. Mirrors
 * this app's own existing two-tier Staff permission philosophy exactly:
 * OWNER-only for the most sensitive org-wide settings (see
 * src/lib/organization-setup/authorization.ts), OWNER+ADMIN ("privileged")
 * for configuration-adjacent, higher-blast-radius operations (Tags,
 * Custom Statuses, Custom Fields, Workflow Automations — see e.g.
 * src/lib/tags/definitions.ts's own isPrivileged) — ordinary Client/Lead
 * CRUD itself stays open to every Staff role including MEMBER.
 *
 * Bulk export is deliberately placed in the OWNER+ADMIN tier, not the
 * "any Staff role" tier ordinary Client/Lead create/edit already uses:
 * export is a data-exfiltration vector (an entire tenant's dataset
 * leaving the app in one request) — a qualitatively different risk than
 * viewing or editing one record on screen at a time, per the read-only
 * CSV Import/Export audit's own explicit recommendation.
 */
export function canExportData(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}
