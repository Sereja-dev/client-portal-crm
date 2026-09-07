import type { LeadStage } from "@/generated/prisma/enums";
import { StatusBadge } from "@/components/ui/status-badge";
import { getLeadStageDefinition } from "@/lib/leads/stages";

/**
 * The one place a Lead's stage becomes a badge — always sourced from the
 * canonical getLeadStageDefinition() label (src/lib/leads/stages.ts),
 * never a second hand-typed copy of the six stage names.
 */
export function LeadStageBadge({ stage }: { stage: LeadStage }) {
  return <StatusBadge status={stage} label={getLeadStageDefinition(stage).label} />;
}
