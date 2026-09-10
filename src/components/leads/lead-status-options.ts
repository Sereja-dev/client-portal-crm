import type { StatusSelectOption } from "@/lib/custom-statuses/entity-form";
import { SYSTEM_STATUS_KEYS } from "@/lib/custom-statuses/constants";

/**
 * Custom Statuses Phase 2B (Section M — CRITICAL). The one place a
 * generic Lead status selector's final option list is assembled: the
 * system LOST definition is always excluded as a NEW-selection target
 * (its own dedicated "Mark lost" dialog is the only way in — see
 * assignLeadStatusDefinitionAction's own doc comment in leads/actions.ts
 * for the full reasoning), UNLESS it's already this Lead's own current
 * status, in which case it stays visible so the "reactivate by picking a
 * different stage" flow keeps working exactly as it always has.
 *
 * Pure/DB-free — safe to call from either the edit-page panel (whose
 * `options` already come pre-merged with an archived current from
 * buildStatusSelectOptions) or the Pipeline card (whose `options` are
 * merged locally via mergeCurrentStatusOption, never a per-row query).
 */
export function buildLeadStatusSelectOptions(
  options: readonly StatusSelectOption[],
  currentDefinitionId: string | null,
): StatusSelectOption[] {
  return options.filter((o) => o.id === currentDefinitionId || !(o.isSystem && o.key === SYSTEM_STATUS_KEYS.LEAD_LOST));
}
