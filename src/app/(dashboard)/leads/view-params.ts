import { parseEnumParam, type RawSearchParams } from "@/lib/list-params";
import type { LeadStage } from "@/generated/prisma/enums";
import { LEAD_STAGE_VALUES } from "./query";

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

export function parseLeadView(searchParams: RawSearchParams): LeadView {
  return parseEnumParam(searchParams.view, LEAD_VIEWS) ?? "list";
}

const DEFAULT_STAGE_VIEW: LeadStage = "NEW";

/** Which single stage the Pipeline board's mobile switcher currently shows (see lead-pipeline-board.tsx). */
export function parseLeadStageView(searchParams: RawSearchParams): LeadStage {
  return parseEnumParam(searchParams.stageView, LEAD_STAGE_VALUES) ?? DEFAULT_STAGE_VIEW;
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
