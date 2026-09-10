import type { CustomStatusColor } from "@/generated/prisma/enums";

/**
 * Custom Statuses Phase 2B (Section L/M/O/R/AB) — the pure, DB-free half
 * of entity-form.ts's own status-select-option helpers, split into its
 * own module for exactly one reason: `mergeCurrentStatusOption` is
 * imported at RUNTIME (not just as a type) by lead-pipeline-card.tsx, a
 * "use client" component — and entity-form.ts itself imports
 * `{ prisma } from "@/lib/prisma"` at module scope for its own
 * `buildStatusSelectOptions`/`resolveStatusForSave`. A client component
 * importing ANY runtime binding from a module also pulls in that
 * module's own top-level imports into the browser bundle, which broke
 * `next build` (pg's Node-only `tls`/`util/types` requires have no
 * browser polyfill). This module has zero non-type imports, so nothing
 * here can ever leak Prisma/pg into a client bundle no matter who
 * imports it.
 */

export type StatusSelectOption = {
  id: string;
  key: string;
  label: string;
  color: CustomStatusColor | null;
  isSystem: boolean;
  isDefault: boolean;
  /** True only for the one, optional, appended "current but archived" entry — see buildStatusSelectOptions's own comment (entity-form.ts). */
  archived: boolean;
};

/**
 * DB-free counterpart to buildStatusSelectOptions (entity-form.ts,
 * Section AB) — for a caller rendering MANY rows from one already-fetched
 * active options list (Lead Pipeline's own per-card selector: one shared
 * `buildStatusSelectOptions(..., null)` call per page load, never one
 * per row). `current` is this one row's own current status definition,
 * already available from that row's own query (e.g. Lead.statusDefinition)
 * — merged in exactly like buildStatusSelectOptions's own archived-
 * current append, with zero extra database access.
 */
export function mergeCurrentStatusOption(
  activeOptions: readonly StatusSelectOption[],
  current: StatusSelectOption | null,
): StatusSelectOption[] {
  if (!current) return [...activeOptions];
  if (activeOptions.some((o) => o.id === current.id)) return [...activeOptions];
  return [...activeOptions, { ...current, archived: true }];
}
