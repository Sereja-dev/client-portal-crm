import type { LeadStage, CustomStatusColor } from "@/generated/prisma/enums";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolveStatusPresentation } from "@/lib/custom-statuses/presentation";

/**
 * The one place a Lead's stage becomes a badge. Custom Statuses Phase 2A
 * (Section C/P) — prefers the Lead's own CustomStatusDefinition (label +
 * color) when the caller has it available; falls back to
 * resolveStatusPresentation's own legacy-enum derivation when it doesn't
 * (Section D — a historical/unbackfilled row, or a caller that hasn't
 * threaded the relation through yet). That fallback (formatStatusLabel)
 * produces byte-identical text to the previous getLeadStageDefinition()
 * label for all 6 canonical stages (New/Contacted/Qualified/Proposal/
 * Won/Lost) — same Title Case, same words.
 */
export function LeadStageBadge({
  stage,
  definition,
}: {
  stage: LeadStage;
  definition?: { label: string; color: CustomStatusColor | null } | null;
}) {
  const presentation = resolveStatusPresentation(definition, stage);
  return <StatusBadge status={stage} label={presentation.label} tone={presentation.tone} />;
}
