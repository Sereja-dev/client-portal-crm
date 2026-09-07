import type { LeadStage } from "@/generated/prisma/enums";

/**
 * Leads / Sales Pipeline Phase 1 (schema foundation only — see the
 * architecture audit's §D). Stages are a hardcoded Prisma enum for MVP
 * (Option C from the audit: DB-backed custom stages are a real future
 * feature, not built yet), but nothing outside this module is allowed to
 * hardcode a stage's order, label, or "is this terminal/won/lost" meaning
 * directly — every consumer (list/filter UI, Kanban columns, reporting)
 * must go through this one canonical definition and the pure helpers
 * below instead of scattering `stage === "WON"`-style comparisons.
 *
 * This is deliberate prep, not speculative complexity: when a later phase
 * adds a per-organization `Stage` table, only this module's own
 * implementation needs to change (swap the array for a DB read, swap the
 * helpers for a lookup against the fetched row's own isTerminal/isWon
 * flags) — every consumer stays unchanged, because none of them ever
 * hardcoded a stage name or its semantics themselves.
 */

export type LeadStageDefinition = {
  value: LeadStage;
  label: string;
  /** Position in the canonical pipeline order — lower sorts first. */
  order: number;
};

/**
 * The one canonical, ordered stage list. Order here is the pipeline's own
 * order (NEW -> ... -> WON/LOST), not alphabetical and not declaration
 * order in the Prisma enum (which Postgres/Prisma do not guarantee is
 * meaningful) — every UI that renders stages as columns/steps must
 * iterate this array, never the bare enum.
 */
export const LEAD_STAGES: readonly LeadStageDefinition[] = [
  { value: "NEW", label: "New", order: 0 },
  { value: "CONTACTED", label: "Contacted", order: 1 },
  { value: "QUALIFIED", label: "Qualified", order: 2 },
  { value: "PROPOSAL", label: "Proposal", order: 3 },
  { value: "WON", label: "Won", order: 4 },
  { value: "LOST", label: "Lost", order: 5 },
];

const TERMINAL_STAGES: ReadonlySet<LeadStage> = new Set(["WON", "LOST"]);

/**
 * A terminal stage is one a Lead does not move on from in the normal
 * pipeline flow (it has either converted or been closed out) — used to
 * gate UI/logic that only makes sense for a still-open Lead (e.g. showing
 * "Move to next stage" only for a non-terminal stage).
 */
export function isTerminalLeadStage(stage: LeadStage): boolean {
  return TERMINAL_STAGES.has(stage);
}

export function isWonLeadStage(stage: LeadStage): boolean {
  return stage === "WON";
}

export function isLostLeadStage(stage: LeadStage): boolean {
  return stage === "LOST";
}

/** Looks up a stage's own canonical definition (label/order) by its enum value. */
export function getLeadStageDefinition(stage: LeadStage): LeadStageDefinition {
  const definition = LEAD_STAGES.find((s) => s.value === stage);
  if (!definition) {
    // Unreachable for any real LeadStage value — LEAD_STAGES enumerates
    // every member of the enum above. Guards against the two staying out
    // of sync silently if a future stage is ever added to one but not
    // the other.
    throw new Error(`No LeadStageDefinition found for stage "${stage}".`);
  }
  return definition;
}
