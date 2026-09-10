import { prisma } from "@/lib/prisma";
import type { LeadStage } from "@/generated/prisma/enums";
import { listCustomStatusDefinitions } from "@/lib/custom-statuses/definitions";
import { buildLeadWhere, buildLeadOrderBy, type LeadListParams } from "./query";

/**
 * Leads / Sales Pipeline Phase 4, migrated by Custom Statuses Phase 2A
 * (Section G) — the Pipeline (Kanban) view's own query layer. Deliberately
 * NOT the paginated list query reused blindly: a single PAGE_SIZE=10 page
 * would make the board silently show only the first page of whichever
 * stage happens to sort first, which is exactly the "board lies about
 * completeness" failure this module exists to avoid. Every column instead
 * gets its own bounded, exact-counted query.
 *
 * Custom Statuses Phase 2A: columns are now defined by this organization's
 * own active LEAD CustomStatusDefinitions (ordered by `position`), not the
 * hardcoded LEAD_STAGES array — today that produces byte-identical output
 * (every organization's only LEAD definitions are its 6 backfilled system
 * ones, in the same order LEAD_STAGES always used), but a future custom
 * Lead status (Phase 2B+) will appear as its own column automatically,
 * with zero further code change here. Grouping/counting is by
 * statusDefinitionId, falling back to the legacy `stage` enum only for a
 * Lead whose statusDefinitionId is still null (Section D — a historical/
 * unbackfilled row; every real Production Lead is fully backfilled).
 * Archived definitions that still have Leads assigned to them (impossible
 * in Production today, since no assignment UI exists yet, but
 * architecturally required — Section G) get their own column too, appended
 * after the active ones, so no Lead ever silently disappears because its
 * own status definition was archived.
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
  statusDefinition: { label: string; color: import("@/generated/prisma/enums").CustomStatusColor | null } | null;
  convertedClientId: string | null;
  assignedTo: { id: string; name: string } | null;
  createdAt: Date;
};

export type PipelineColumn = {
  definitionId: string;
  key: string;
  label: string;
  /**
   * The matching legacy LeadStage for a SYSTEM column — used only for
   * the "See all in List view" truncation link and the mobile switcher's
   * own URL-driven `stageView` matching (both are LeadStage-keyed URL
   * params, kept unchanged for full backward compatibility — Section H:
   * "avoid breaking existing URLs... do not overcomplicate"). Null for a
   * genuinely custom column — architecturally possible, but unreachable
   * in Production today, since no assignment UI exists yet (Section G).
   */
  stage: LeadStage | null;
  archived: boolean;
  /** The real, exact count for this column under the current filters — never bounded, unlike `leads`. */
  total: number;
  leads: PipelineLead[];
  /** True when `leads.length < total` — this column's own cards were capped at PIPELINE_STAGE_CARD_BOUND. */
  truncated: boolean;
};

/**
 * Fetches every column in one bounded, org-scoped pass.
 *
 * `stage` is deliberately excluded from `listParams` here (see
 * leads/page.tsx's own "the stage filter is hidden in Pipeline view"
 * decision) — every visible column is always shown; a stray `stage` query
 * param left over from List view can never collapse the board down to one
 * column.
 *
 * Three real queries, run concurrently where possible: two `groupBy`s for
 * the exact per-column totals (cheap, no bound, always correct even when
 * a column's own cards are truncated — one keyed by statusDefinitionId,
 * one keyed by the legacy `stage` for the Section D fallback rows), and
 * one `$transaction` batch of bounded `findMany` calls — a fixed,
 * bounded fan-out of exactly `columns.length` queries regardless of how
 * many Leads exist, never an N+1 (Section S).
 */
export async function fetchLeadPipelineColumns(
  organizationId: string,
  listParams: Pick<LeadListParams, "q" | "assignedToUserId" | "archived" | "sortField" | "sortDir">,
): Promise<PipelineColumn[]> {
  const baseWhere = await buildLeadWhere(organizationId, { ...listParams, stage: undefined });
  const orderBy = buildLeadOrderBy(listParams);

  const allDefinitions = await listCustomStatusDefinitions(organizationId, "LEAD", { includeArchived: true });
  const activeDefinitions = allDefinitions.filter((d) => d.archivedAt === null);
  const archivedDefinitions = allDefinitions.filter((d) => d.archivedAt !== null);

  const [definitionCounts, legacyFallbackCounts] = await Promise.all([
    prisma.lead.groupBy({
      by: ["statusDefinitionId"],
      where: { ...baseWhere, statusDefinitionId: { not: null } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["stage"],
      where: { ...baseWhere, statusDefinitionId: null },
      _count: { _all: true },
    }),
  ]);

  const totalByDefinitionId = new Map<string, number>(
    definitionCounts.map((c) => [c.statusDefinitionId as string, c._count._all]),
  );
  // Section D fallback: a Lead with no statusDefinitionId is bucketed
  // into the SYSTEM definition matching its own legacy `stage` — every
  // system definition's own key is exactly that stage lowercased (see
  // constants.ts), so no separate mapping table is needed.
  for (const row of legacyFallbackCounts) {
    const match = allDefinitions.find((d) => d.isSystem && d.key === row.stage.toLowerCase());
    if (match) {
      totalByDefinitionId.set(match.id, (totalByDefinitionId.get(match.id) ?? 0) + row._count._all);
    }
    // else: unreachable for any real organization (every LeadStage has a
    // matching system definition, bootstrapped/backfilled for every
    // organization) — if it somehow happened, that count is simply not
    // shown as its own column rather than silently misattributed to a
    // wrong one.
  }

  const columns = [
    ...activeDefinitions,
    // Archived definitions only ever get a column when a Lead is
    // currently using one (Section G) — an archived definition nobody
    // references is simply omitted, exactly like it already is from
    // every ordinary "active definitions" list elsewhere in this app.
    ...archivedDefinitions.filter((d) => (totalByDefinitionId.get(d.id) ?? 0) > 0),
  ];

  const perColumnLeads = await prisma.$transaction(
    columns.map((def) =>
      prisma.lead.findMany({
        // AND, not a spread-`OR` — baseWhere may already carry its own
        // top-level `OR` (the `q` search filter's own OR-of-fields), and
        // spreading `{ ...baseWhere, OR: [...] }` would silently
        // overwrite that key instead of combining with it (found by this
        // module's own pre-existing test suite: a `q` search that
        // matched nothing was returning every Lead in the column,
        // because the definition-matching OR replaced the search OR
        // entirely). AND: [baseWhere, {...}] composes both correctly.
        where: {
          AND: [
            baseWhere,
            {
              OR: [
                { statusDefinitionId: def.id },
                // Fold the Section D fallback rows into their own system
                // column's own bounded fetch too — a null-statusDefinitionId
                // Lead must appear in the one column its legacy stage maps
                // to, exactly like the count above already does.
                ...(def.isSystem ? [{ statusDefinitionId: null, stage: def.key.toUpperCase() as LeadStage }] : []),
              ],
            },
          ],
        },
        orderBy,
        take: PIPELINE_STAGE_CARD_BOUND,
        include: {
          assignedTo: { select: { id: true, name: true } },
          statusDefinition: { select: { label: true, color: true } },
        },
      }),
    ),
  );

  return columns.map((def, index) => {
    const leads = perColumnLeads[index];
    const total = totalByDefinitionId.get(def.id) ?? 0;
    return {
      definitionId: def.id,
      key: def.key,
      label: def.label,
      stage: def.isSystem ? (def.key.toUpperCase() as LeadStage) : null,
      archived: def.archivedAt !== null,
      total,
      truncated: total > leads.length,
      leads: leads.map((lead) => ({
        id: lead.id,
        name: lead.name,
        company: lead.company,
        source: lead.source,
        value: lead.value ? lead.value.toString() : null,
        stage: lead.stage,
        statusDefinition: lead.statusDefinition,
        convertedClientId: lead.convertedClientId,
        assignedTo: lead.assignedTo ? { id: lead.assignedTo.id, name: lead.assignedTo.name } : null,
        createdAt: lead.createdAt,
      })),
    };
  });
}
