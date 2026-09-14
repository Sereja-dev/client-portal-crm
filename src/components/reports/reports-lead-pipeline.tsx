import type { LeadStage } from "@/generated/prisma/enums";
import { getLeadStageDefinition } from "@/lib/leads/stages";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import type { ReportsLeadPipelineSnapshot } from "@/lib/reports/queries/leads";

/**
 * Reports Phase 2 — horizontal bar list, mirroring
 * src/components/dashboard/breakdown-card.tsx's exact "count + percent +
 * bar, color purely decorative" pattern: the stage name, count, and
 * percentage are always rendered as text next to each bar, so nothing
 * here depends on color alone to be understood.
 *
 * Stage labels come from getLeadStageDefinition() (src/lib/leads/stages.ts)
 * — that module's own doc comment requires every consumer to go through
 * it rather than hardcoding a stage's label, so this component never
 * writes "New"/"Contacted"/etc. itself.
 *
 * CURRENT SNAPSHOT ONLY: `snapshot` is exactly what
 * getLeadPipelineSnapshot() (Phase 1) already computed — archived Leads
 * are already excluded there, and this component never re-queries or
 * reshapes anything beyond formatting. No historical/trend language
 * anywhere in this component's own copy.
 */
const STAGE_BAR_CLASSES: Record<LeadStage, string> = {
  NEW: "bg-text-muted",
  CONTACTED: "bg-info",
  QUALIFIED: "bg-info",
  PROPOSAL: "bg-warning",
  WON: "bg-success",
  LOST: "bg-danger",
};

export function ReportsLeadPipeline({ snapshot }: { snapshot: ReportsLeadPipelineSnapshot }) {
  const total = snapshot.stages.reduce((sum, stage) => sum + stage.count, 0);

  return (
    <section aria-labelledby="reports-pipeline-heading" className={`p-6 ${CARD_SURFACE_CLASSES}`}>
      <h2 id="reports-pipeline-heading" className="text-text-primary text-base font-semibold">
        Current Lead pipeline
      </h2>
      <p className="text-text-muted mt-1 text-sm">Snapshot of active leads by current stage — not a historical trend.</p>

      {total === 0 ? (
        <p className="text-text-muted mt-4 text-sm">No Leads yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {snapshot.stages.map((stage) => {
            const stageValue = stage.stage as LeadStage;
            const definition = getLeadStageDefinition(stageValue);
            const percent = total > 0 ? Math.round((stage.count / total) * 100) : 0;
            return (
              <li key={stage.stage}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-text-secondary">{definition.label}</span>
                  <span className="text-text-muted">
                    {stage.count} ({percent}%)
                  </span>
                </div>
                <div className="bg-surface-recessed mt-1 h-1.5 w-full overflow-hidden rounded-full">
                  <div className={`h-full rounded-full ${STAGE_BAR_CLASSES[stageValue]}`} style={{ width: `${percent}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
