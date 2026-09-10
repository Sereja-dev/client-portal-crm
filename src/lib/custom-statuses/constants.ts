import type { CustomStatusColor, CustomStatusEntityType } from "@/generated/prisma/enums";

/**
 * Custom Statuses Phase 1 — the one canonical list of built-in ("system")
 * status definitions per entity type, and the well-known, immutable
 * keys code may check against for real business semantics (Section G/H/
 * I/J). Keys/labels/positions/colors here are derived directly from this
 * app's own existing enum values and canonical UI labels — never
 * invented (Section E):
 *   - CLIENT: CLIENT_STATUSES (src/lib/validation/client.ts) — label is
 *     each value's own formatStatusLabel() output (src/lib/format.ts),
 *     which is exactly what every existing Client status badge already
 *     renders (StatusBadge falls back to formatStatusLabel when given no
 *     explicit label — no ClientStatusBadge wrapper exists).
 *   - LEAD: LEAD_STAGES (src/lib/leads/stages.ts) — label/order copied
 *     verbatim from that file's own canonical array.
 *   - PROJECT: PROJECT_STATUSES (src/lib/validation/project.ts) — same
 *     formatStatusLabel() convention as CLIENT.
 * Colors are copied verbatim from STATUS_TONES
 * (src/components/ui/status-badge.tsx), uppercased to match
 * CustomStatusColor's own enum casing.
 *
 * IMPORTANT: this exact list must stay in sync with this feature's own
 * migration's backfill INSERT statements (prisma/migrations/
 * 20260926090000_add_custom_statuses_foundation/migration.sql) — the SQL
 * there is the one-time historical backfill for organizations that
 * already existed before this migration ran; this module is what every
 * NEW organization (via bootstrap.ts) gets going forward. Both must
 * produce byte-identical key/label/color/position/isDefault values, or a
 * new organization's status definitions would silently diverge from an
 * existing organization's.
 */

export type SystemStatusDefinitionSeed = {
  key: string;
  label: string;
  color: CustomStatusColor;
  position: number;
  isDefault: boolean;
};

export const SYSTEM_STATUS_DEFINITIONS: Record<CustomStatusEntityType, readonly SystemStatusDefinitionSeed[]> = {
  CLIENT: [
    { key: "lead", label: "Lead", color: "NEUTRAL", position: 0, isDefault: true },
    { key: "active", label: "Active", color: "SUCCESS", position: 1, isDefault: false },
    { key: "inactive", label: "Inactive", color: "MUTED", position: 2, isDefault: false },
    { key: "archived", label: "Archived", color: "MUTED", position: 3, isDefault: false },
  ],
  LEAD: [
    { key: "new", label: "New", color: "NEUTRAL", position: 0, isDefault: true },
    { key: "contacted", label: "Contacted", color: "INFO", position: 1, isDefault: false },
    { key: "qualified", label: "Qualified", color: "INFO", position: 2, isDefault: false },
    { key: "proposal", label: "Proposal", color: "INFO", position: 3, isDefault: false },
    { key: "won", label: "Won", color: "SUCCESS", position: 4, isDefault: false },
    { key: "lost", label: "Lost", color: "DANGER", position: 5, isDefault: false },
  ],
  PROJECT: [
    { key: "planning", label: "Planning", color: "NEUTRAL", position: 0, isDefault: true },
    { key: "in_progress", label: "In Progress", color: "INFO", position: 1, isDefault: false },
    { key: "on_hold", label: "On Hold", color: "WARNING", position: 2, isDefault: false },
    { key: "completed", label: "Completed", color: "SUCCESS", position: 3, isDefault: false },
    { key: "cancelled", label: "Cancelled", color: "DANGER", position: 4, isDefault: false },
  ],
};

/**
 * The stable, immutable keys real business logic may check against
 * (Section G: "system semantic identity tied to key, not label"). Only
 * the five keys that actually gate something in this app today —
 * everything else in SYSTEM_STATUS_DEFINITIONS above is display/filter
 * only, with no code path that needs to resolve it by identity.
 *
 * LEAD_NEW added in the Phase 2B Completion Pass (Section B/C) — Lead
 * creation always starts at system NEW (a pre-existing, stronger
 * invariant from Leads/Sales Pipeline Phase 2, deliberately never wired
 * to a Settings-configurable default), so the LEAD default itself is
 * permanently locked to this one key — setDefaultCustomStatusDefinition
 * checks against it directly rather than trusting isDefault on the NEW
 * row alone (Section C: enforce at the domain boundary, not just by
 * hiding UI).
 */
export const SYSTEM_STATUS_KEYS = {
  CLIENT_ACTIVE: "active",
  LEAD_NEW: "new",
  LEAD_WON: "won",
  LEAD_LOST: "lost",
  PROJECT_IN_PROGRESS: "in_progress",
} as const;
