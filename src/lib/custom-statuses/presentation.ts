import type { CustomStatusColor } from "@/generated/prisma/enums";
import { STATUS_TONES, type StatusTone } from "@/components/ui/status-badge";
import { formatStatusLabel } from "@/lib/format";

/**
 * Custom Statuses Phase 2A (Section C/D/P) — the one authoritative "what
 * should this entity's status badge show" resolver, used everywhere a
 * Client/Lead/Project status becomes a label + color: list pages, detail
 * pages, the Lead pipeline, Portal project display.
 *
 * Deliberately NOT `import "server-only"` — several of this module's real
 * callers (LeadStageBadge and friends) are Client Components, and this
 * file never touches the database (it's a pure presentation mapping over
 * already-fetched data), matching src/lib/custom-statuses/semantics.ts's
 * own identical reasoning.
 */

export type StatusDefinitionPresentation = {
  label: string;
  color: CustomStatusColor | null;
};

// Exported (Custom Statuses Phase 2B, Section T) — the settings UI's own
// color swatch/badge preview needs this same mapping for a definition on
// its own (no legacy value to fall back to there), rather than a second,
// parallel copy of the same six-entry map.
export const COLOR_TO_TONE: Record<CustomStatusColor, StatusTone> = {
  NEUTRAL: "neutral",
  INFO: "info",
  WARNING: "warning",
  SUCCESS: "success",
  DANGER: "danger",
  MUTED: "muted",
};

export type ResolvedStatusPresentation = { label: string; tone: StatusTone };

/**
 * Prefers the entity's own CustomStatusDefinition (label + color -> tone)
 * when present — this is the authoritative source once Phase 1's backfill
 * has run (Section C: "statusDefinition / statusDefinitionId becomes the
 * authoritative current status identity/display source"). Falls back to
 * the legacy enum value (STATUS_TONES + formatStatusLabel, the exact
 * behavior every Client/Project badge already had before this phase) only
 * when `definition` is null/undefined — Section D's defensive fallback
 * for a historical/unbackfilled row (never expected for a real Production
 * row after Phase 1's migration, but test/seed fixtures still construct
 * rows this way, and this must never throw or blank out the page for
 * that). `definition.color` being null (an optional field even on a real
 * definition) falls back to the same STATUS_TONES lookup by legacy value,
 * not to "neutral" — a custom definition with no color chosen yet still
 * gets a sensible tone if its own key happens to match a known legacy
 * value, and "neutral" only when nothing else applies.
 */
export function resolveStatusPresentation(
  definition: StatusDefinitionPresentation | null | undefined,
  legacyValue: string,
): ResolvedStatusPresentation {
  if (definition) {
    return {
      label: definition.label,
      tone: definition.color ? COLOR_TO_TONE[definition.color] : (STATUS_TONES[legacyValue] ?? "neutral"),
    };
  }
  return { label: formatStatusLabel(legacyValue), tone: STATUS_TONES[legacyValue] ?? "neutral" };
}
