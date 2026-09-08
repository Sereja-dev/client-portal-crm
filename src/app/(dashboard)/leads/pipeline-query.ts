import { prisma } from "@/lib/prisma";
import type { LeadStage } from "@/generated/prisma/enums";
import { LEAD_STAGES } from "@/lib/leads/stages";
import { buildLeadWhere, buildLeadOrderBy, type LeadListParams } from "./query";

/**
 * Leads / Sales Pipeline Phase 4 — the Pipeline (Kanban) view's own query
 * layer. Deliberately NOT the paginated list query reused blindly: a
 * single PAGE_SIZE=10 page would make the board silently show only the
 * first page of whichever stage happens to sort first, which is exactly
 * the "board lies about completeness" failure this module exists to
 * avoid. Every column instead gets its own bounded, exact-counted query.
 */

// A generous, documented cap on how many cards render per column. Chosen
// so a normal-sized pipeline (even a very active one) always renders in
// full, while still bounding worst-case query/render cost for an
// unusually large single stage. Never silently pretended to be
// exhaustive: PipelineColumn.truncated is exact (computed from the real
// groupBy count below, not from whether the bound happened to be hit),
// and the board's own UI surfaces a "showing N of TOTAL" notice whenever
// a column is truncated, pointing at List view (which has proper
// pagination) to see the rest.
export const PIPELINE_STAGE_CARD_BOUND = 50;

export type PipelineLead = {
  id: string;
  name: string;
  company: string | null;
  source: string | null;
  /** Stringified Decimal — Prisma's Decimal type can't cross the Server -> Client boundary as a prop. */
  value: string | null;
  stage: LeadStage;
  convertedClientId: string | null;
  assignedTo: { id: string; name: string } | null;
  createdAt: Date;
};

export type PipelineColumn = {
  stage: LeadStage;
  label: string;
  /** The real, exact count for this stage under the current filters — never bounded, unlike `leads`. */
  total: number;
  leads: PipelineLead[];
  /** True when `leads.length < total` — this column's own cards were capped at PIPELINE_STAGE_CARD_BOUND. */
  truncated: boolean;
};

/**
 * Fetches every stage's column in one bounded, org-scoped pass.
 *
 * `stage` is deliberately excluded from `listParams` here (see
 * leads/page.tsx's own "the stage filter is hidden in Pipeline view"
 * decision) — every canonical stage is always its own column; a stray
 * `stage` query param left over from List view can never collapse the
 * board down to one column.
 *
 * Two real queries, run concurrently: one `groupBy` for the exact
 * per-stage totals (cheap, no bound, always correct even when a
 * column's own cards are truncated), and one `$transaction` batch of the
 * 6 canonical stages' own bounded `findMany` calls (a real, single-
 * round-trip DB transaction — not a per-row loop, so this is a fixed,
 * bounded fan-out of exactly `LEAD_STAGES.length` queries regardless of
 * how many Leads exist, never an N+1). The two together are a single
 * `Promise.all` rather than one combined `$transaction`, since mixing a
 * `groupBy` and a homogeneous array of `findMany` calls in one Prisma
 * transaction array loses precise per-element typing; a rare, low-stakes
 * cross-query snapshot mismatch (a Lead's stage changing between these
 * two reads) only ever shows a count and a card set briefly one stage-
 * move out of sync with each other, self-correcting on the next refresh —
 * never a security or data-integrity concern for a read-only board.
 */
export async function fetchLeadPipelineColumns(
  organizationId: string,
  listParams: Pick<LeadListParams, "q" | "assignedToUserId" | "archived" | "sortField" | "sortDir">,
): Promise<PipelineColumn[]> {
  const baseWhere = buildLeadWhere(organizationId, { ...listParams, stage: undefined });
  const orderBy = buildLeadOrderBy(listParams);

  const [counts, perStageLeads] = await Promise.all([
    prisma.lead.groupBy({ by: ["stage"], where: baseWhere, _count: { _all: true } }),
    prisma.$transaction(
      LEAD_STAGES.map((def) =>
        prisma.lead.findMany({
          where: { ...baseWhere, stage: def.value },
          orderBy,
          take: PIPELINE_STAGE_CARD_BOUND,
          include: { assignedTo: { select: { id: true, name: true } } },
        }),
      ),
    ),
  ]);

  const totalByStage = new Map(counts.map((c) => [c.stage, c._count._all]));

  return LEAD_STAGES.map((def, index) => {
    const leads = perStageLeads[index];
    const total = totalByStage.get(def.value) ?? 0;
    return {
      stage: def.value,
      label: def.label,
      total,
      truncated: total > leads.length,
      leads: leads.map((lead) => ({
        id: lead.id,
        name: lead.name,
        company: lead.company,
        source: lead.source,
        value: lead.value ? lead.value.toString() : null,
        stage: lead.stage,
        convertedClientId: lead.convertedClientId,
        assignedTo: lead.assignedTo ? { id: lead.assignedTo.id, name: lead.assignedTo.name } : null,
        createdAt: lead.createdAt,
      })),
    };
  });
}
