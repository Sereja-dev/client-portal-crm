import { StatusBadge } from "@/components/ui/status-badge";
import { COLOR_TO_TONE } from "@/lib/custom-statuses/presentation";
import type { CustomStatusColor } from "@/generated/prisma/enums";

/**
 * Tags V2 — the one shared "tag chip" presentation primitive (Section 2
 * of this phase's own spec). Deliberately a thin wrapper around the
 * existing StatusBadge, not a new design system: color reuses the same
 * CustomStatusColor -> StatusTone mapping (COLOR_TO_TONE) Custom Statuses'
 * own settings UI already established, so a Tag's color always composites
 * correctly against both this app's themes with zero new tone work. A
 * `null` color (no color chosen yet) falls back to StatusBadge's own
 * "neutral" default, matching every other optional-color badge in this
 * app.
 *
 * `archived` renders the same badge, visually muted (Section 4: "if an
 * archived tag is still assigned, display it distinctly but safely" —
 * never as if it were active) with a plain-text "(archived)" suffix
 * rather than a second, separate badge — compact enough to sit inline in
 * a table cell, a form checkbox row, or a filter option list alike.
 */
export function TagChip({
  name,
  color,
  archived = false,
}: {
  name: string;
  color: CustomStatusColor | null;
  archived?: boolean;
}) {
  const tone = color ? COLOR_TO_TONE[color] : "neutral";
  return (
    <span className={archived ? "opacity-60" : undefined}>
      <StatusBadge status={name} label={archived ? `${name} (archived)` : name} tone={tone} />
    </span>
  );
}
