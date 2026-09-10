import type { ClientStatus, LeadStage, ProjectStatus, CustomStatusEntityType } from "@/generated/prisma/enums";
import { SYSTEM_STATUS_KEYS } from "./constants";

/**
 * Custom Statuses Phase 2A (Section E/F/G/H/I/J) — the one authoritative
 * place real business semantics (Lead WON/LOST, Client ACTIVE, Project
 * IN_PROGRESS) are decided. Every check here is based on immutable system
 * identity (`isSystem` + `entityType` + the stable `key` — never a
 * mutable `label`), so a custom status whose label or key happens to
 * resemble "won"/"lost"/"active"/"in progress" can never accidentally
 * satisfy any of these checks (Section E's own explicit requirement).
 *
 * Deliberately NOT `import "server-only"` — several real callers
 * (lead-pipeline-card.tsx, lead-actions-panel.tsx) are Client Components,
 * and this module never touches the database (pure functions over
 * already-fetched data), the same "must stay importable from a narrower
 * context" reasoning src/lib/custom-statuses/bootstrap.ts's own doc
 * comment already established for current-user.ts.
 */

export type StatusDefinitionIdentity = {
  isSystem: boolean;
  entityType: CustomStatusEntityType;
  key: string;
};

function isSystemStatus(
  definition: StatusDefinitionIdentity | null | undefined,
  entityType: CustomStatusEntityType,
  key: string,
): boolean {
  return definition != null && definition.isSystem === true && definition.entityType === entityType && definition.key === key;
}

export function isSystemClientStatus(definition: StatusDefinitionIdentity | null | undefined, key: string): boolean {
  return isSystemStatus(definition, "CLIENT", key);
}

export function isSystemLeadStatus(definition: StatusDefinitionIdentity | null | undefined, key: string): boolean {
  return isSystemStatus(definition, "LEAD", key);
}

export function isSystemProjectStatus(definition: StatusDefinitionIdentity | null | undefined, key: string): boolean {
  return isSystemStatus(definition, "PROJECT", key);
}

/**
 * The authoritative "is this Lead WON/LOST" checks (Section F): prefer
 * the Lead's own statusDefinition (a system-identity check, immune to a
 * custom status's label — or a stale legacy `stage` left over from before
 * a hypothetical future reassignment — ever being mistaken for WON/LOST);
 * fall back to the legacy `stage` enum only when statusDefinitionId is
 * null (Section D — a historical/unbackfilled row). Every real Production
 * Lead is fully backfilled (Custom Statuses Phase 1's own migration), so
 * this fallback is exercised only by pre-Phase-1 test fixtures today.
 */
export function resolveLeadIsWon(lead: {
  stage: LeadStage;
  statusDefinition?: StatusDefinitionIdentity | null;
}): boolean {
  if (lead.statusDefinition) {
    return isSystemLeadStatus(lead.statusDefinition, SYSTEM_STATUS_KEYS.LEAD_WON);
  }
  return lead.stage === "WON";
}

export function resolveLeadIsLost(lead: {
  stage: LeadStage;
  statusDefinition?: StatusDefinitionIdentity | null;
}): boolean {
  if (lead.statusDefinition) {
    return isSystemLeadStatus(lead.statusDefinition, SYSTEM_STATUS_KEYS.LEAD_LOST);
  }
  return lead.stage === "LOST";
}

/**
 * Section I — Client ACTIVE has exactly one real semantic dependency
 * today (Lead conversion's own hardcoded default, already written
 * correctly by convertLeadToClientAction). No code path currently reads
 * an *existing* Client's active-ness to gate Portal/billing behavior —
 * this helper exists so that if/when one ever does, it inherits the same
 * system-identity safety every other resolver here already has, and so
 * this phase's own tests can prove a custom Client status never
 * accidentally satisfies it.
 */
export function resolveClientIsActive(client: {
  status: ClientStatus;
  statusDefinition?: StatusDefinitionIdentity | null;
}): boolean {
  if (client.statusDefinition) {
    return isSystemClientStatus(client.statusDefinition, SYSTEM_STATUS_KEYS.CLIENT_ACTIVE);
  }
  return client.status === "ACTIVE";
}

/**
 * Section J/K/L — the one real Project IN_PROGRESS semantic (dashboard
 * KPI, Portal active-project count). Row-level form, used by tests and
 * any future per-row caller; the KPI/Portal queries themselves resolve
 * the org's system IN_PROGRESS definition once and filter by
 * statusDefinitionId directly at the database level (see
 * src/app/(dashboard)/dashboard/query.ts and
 * src/lib/client-portal/queries.ts) rather than loading rows and calling
 * this per-row, to avoid an N+1/full-table-scan (Section S).
 */
export function resolveProjectIsInProgress(project: {
  status: ProjectStatus;
  statusDefinition?: StatusDefinitionIdentity | null;
}): boolean {
  if (project.statusDefinition) {
    return isSystemProjectStatus(project.statusDefinition, SYSTEM_STATUS_KEYS.PROJECT_IN_PROGRESS);
  }
  return project.status === "IN_PROGRESS";
}
