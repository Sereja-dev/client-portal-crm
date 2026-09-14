import "server-only";
import { prisma } from "@/lib/prisma";
import { LeadStage } from "@/generated/prisma/enums";
import type { ReportsPeriodRange } from "../period";

/** Prisma preserves enum declaration order (NEW, CONTACTED, QUALIFIED, PROPOSAL, WON, LOST) — the schema's own canonical pipeline order, reused here rather than a second hardcoded copy. */
const PIPELINE_ORDER = Object.values(LeadStage);
const TERMINAL_STAGES: readonly LeadStage[] = [LeadStage.WON, LeadStage.LOST];

/**
 * COUNT(Lead) created in [range.start, range.end) — a historical creation
 * EVENT. Deliberately does NOT filter `archivedAt`: a Lead genuinely
 * created in this period must keep counting toward that historical fact
 * even if it's archived later — archiving is a visibility change, not an
 * undo of history. Uses `createdAt`, never `stage` — a Lead's current
 * stage says nothing about when it was created.
 */
export async function getNewLeadsCount(organizationId: string, range: ReportsPeriodRange): Promise<number> {
  return prisma.lead.count({
    where: { organizationId, createdAt: { gte: range.start, lt: range.end } },
  });
}

/**
 * COUNT(Lead) with `convertedAt` in [range.start, range.end) — a
 * historical conversion EVENT, never a rate (no denominator is computed
 * here), and never inferred from `stage=WON` alone. Confirmed directly
 * from src/app/(dashboard)/leads/actions.ts: `convertedAt` is set only by
 * the actual Lead -> Client conversion action, a deliberate, separate
 * step from moving `stage` to WON (moveLeadStageAction never touches
 * convertedAt) — so a Lead can genuinely be `stage=WON` with
 * `convertedAt` still null, and that Lead must NOT count here. Same
 * "historical event survives archiving" reasoning as getNewLeadsCount —
 * `archivedAt` is deliberately not filtered.
 */
export async function getConvertedLeadsCount(organizationId: string, range: ReportsPeriodRange): Promise<number> {
  return prisma.lead.count({
    where: { organizationId, convertedAt: { gte: range.start, lt: range.end } },
  });
}

export type ReportsPipelineStage = { stage: string; count: number };

export type ReportsLeadPipelineSnapshot = {
  /** Every canonical LeadStage, in pipeline order, zero-filled — a Phase 2 chart can render this list directly without ever reordering or dropping an empty stage. */
  stages: ReportsPipelineStage[];
  /**
   * SUM(Lead.value) for active (non-WON, non-LOST, non-archived) Leads
   * only — a rough, non-primary secondary figure (see this app's own
   * Lead.value schema comment: "a rough estimated deal value, never a
   * real charge"). Deliberately not part of the Overview KPI set.
   *
   * Cent-exactness note (Phase 1 hardening audit): this SUM already
   * happens DB-side (see getLeadPipelineSnapshot's own `prisma.lead.aggregate`
   * call below), converted from Decimal to a JS number exactly once —
   * never repeated JS float addition. No change was needed here; see
   * src/lib/reports/calculations/money.ts's own doc comment for the
   * pattern this already satisfies by construction.
   */
  activePipelineValue: number;
};

/**
 * CURRENT SNAPSHOT ONLY — groups by TODAY's Lead.stage. Never reconstructs
 * historical stage-over-time movement (that would require replaying
 * Activity's own STATUS_CHANGED {from,to} metadata per Lead, a real,
 * separate future effort — explicitly deferred, not attempted here).
 * Archived Leads are excluded from both the stage counts and the pipeline
 * value: unlike getNewLeadsCount/getConvertedLeadsCount (historical
 * events an archive can never undo), "the current pipeline" is
 * inherently about what's live right now, and an archived Lead is no
 * longer part of that.
 */
export async function getLeadPipelineSnapshot(organizationId: string): Promise<ReportsLeadPipelineSnapshot> {
  const [grouped, activeValueAgg] = await Promise.all([
    prisma.lead.groupBy({
      by: ["stage"],
      where: { organizationId, archivedAt: null },
      _count: true,
    }),
    prisma.lead.aggregate({
      where: { organizationId, archivedAt: null, stage: { notIn: [...TERMINAL_STAGES] } },
      _sum: { value: true },
    }),
  ]);

  const counts = new Map(grouped.map((g) => [g.stage as string, g._count]));
  const stages = PIPELINE_ORDER.map((stage) => ({ stage, count: counts.get(stage) ?? 0 }));

  return { stages, activePipelineValue: Number(activeValueAgg._sum.value ?? 0) };
}
