import { parseEnumParam, parseSearchParam, type RawSearchParams } from "@/lib/list-params";

/**
 * Leads / Sales Pipeline Phase 4 — the List/Pipeline view switch and the
 * Pipeline board's own mobile single-stage selector. Both are pure UI-mode
 * concerns, never security-relevant: an invalid/missing value always
 * falls back safely (List; the first canonical stage) rather than
 * throwing or widening any query scope — organizationId-based scoping in
 * query.ts/pipeline-query.ts is completely unaffected by either of these.
 */

export const LEAD_VIEWS = ["list", "pipeline"] as const;
export type LeadView = (typeof LEAD_VIEWS)[number];

/**
 * Leads Pipeline V1 (Section 4) — Pipeline is now the canonical default:
 * `/leads` (no `view` param at all) behaves exactly like
 * `/leads?view=pipeline`. An explicit `?view=list` still renders List
 * unchanged — this only changes what an OMITTED param falls back to,
 * never removes or weakens List's own full availability. Still no
 * persisted per-user preference (URL-only, matching this module's own
 * header comment) — deliberately not revisited by this change.
 */
export function parseLeadView(searchParams: RawSearchParams): LeadView {
  return parseEnumParam(searchParams.view, LEAD_VIEWS) ?? "pipeline";
}

const DEFAULT_STAGE_VIEW = "NEW";

/**
 * Which single column the Pipeline board's mobile switcher currently
 * shows (see lead-pipeline-board.tsx). Custom Statuses Phase 2B —
 * Completion Pass (Section G/H): no longer restricted to a fixed
 * LeadStage enum — a genuinely custom column has no LeadStage of its
 * own, so `?stageView=` now also accepts a raw CustomStatusDefinition
 * id, matched by lead-pipeline-board.tsx's own `activeColumn` lookup
 * against EITHER `column.stage` or `column.definitionId`. A legacy
 * `?stageView=NEW`-shaped link keeps resolving exactly as before — this
 * only ADDS a second, alternative match, never removes the first.
 * Invalid/missing still falls back safely to "NEW", matching this
 * file's own header comment (never security-relevant either way —
 * organization scoping happens entirely in pipeline-query.ts).
 */
export function parseLeadStageView(searchParams: RawSearchParams): string {
  const raw = parseSearchParam(searchParams.stageView);
  return raw || DEFAULT_STAGE_VIEW;
}

/** Builds a /leads?... href from a plain params object, omitting any falsy value entirely rather than emitting an empty query param. */
export function buildLeadsHref(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value);
  }
  const qs = usp.toString();
  return qs ? `/leads?${qs}` : "/leads";
}
