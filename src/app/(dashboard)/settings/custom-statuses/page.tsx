import { getCurrentUserOrganization } from "@/lib/current-user";
import { listCustomStatusDefinitions } from "@/lib/custom-statuses/definitions";
import { EntityTabs } from "@/components/custom-statuses/entity-tabs";
import { DefinitionsList, type StatusDefinitionRow } from "@/components/custom-statuses/definitions-list";
import type { RawSearchParams } from "@/lib/list-params";
import { parseCustomStatusEntityTypeParam, ENTITY_TYPE_LABELS } from "./view-params";
import {
  createCustomStatusAction,
  updateCustomStatusAction,
  archiveCustomStatusAction,
  unarchiveCustomStatusAction,
  setDefaultCustomStatusAction,
  moveCustomStatusAction,
} from "./actions";

/**
 * Custom Statuses Phase 2B (Staff UI) — definition management only
 * (Section B/C). Reachable at /settings/custom-statuses, alongside the
 * app's other Settings pages via SettingsNav. Any OWNER/ADMIN/MEMBER of
 * the organization may view/manage — matches this app's existing Client-
 * management permission model, the same tier settings/custom-fields
 * already established (see actions.ts's own header comment).
 *
 * Data is fetched fresh here (no caching layer): every definition for
 * the current tab's entityType (active + archived, so the archived-
 * toggle can flip between them client-side with no extra round trip).
 * Every per-row mutation is bound to its own id right here, before ever
 * reaching a Client Component — entityType/direction are always server-
 * bound closures, never read from client input (Section Q).
 */
export default async function CustomStatusesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;
  const entityType = parseCustomStatusEntityTypeParam(resolvedSearchParams);
  const entityLabel = ENTITY_TYPE_LABELS[entityType];
  // Phase 2B Completion Pass (Section B/C) — LEAD's default is
  // permanently locked to the system NEW definition (new leads always
  // start there); see definitions.ts's own setDefaultCustomStatusDefinition
  // comment for the full "why".
  const canSetDefault = entityType !== "LEAD";

  const definitions = await listCustomStatusDefinitions(organizationId, entityType, { includeArchived: true });

  const rows: StatusDefinitionRow[] = definitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    key: definition.key,
    color: definition.color,
    isSystem: definition.isSystem,
    isDefault: definition.isDefault,
    archivedAt: definition.archivedAt,
    editAction: updateCustomStatusAction.bind(null, definition.id),
    archiveAction: archiveCustomStatusAction.bind(null, definition.id),
    unarchiveAction: unarchiveCustomStatusAction.bind(null, definition.id),
    setDefaultAction: setDefaultCustomStatusAction.bind(null, entityType, definition.id),
    moveUpAction: moveCustomStatusAction.bind(null, entityType, definition.id, "up"),
    moveDownAction: moveCustomStatusAction.bind(null, entityType, definition.id, "down"),
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Custom statuses</h1>
      <p className="text-text-secondary mt-1 text-sm">
        Manage the statuses available for clients, leads, and projects. Built-in statuses
        power core product behavior and can&apos;t be edited or archived, but you can add
        your own alongside them.
      </p>

      <EntityTabs entityType={entityType} />

      {!canSetDefault && (
        <p className="text-text-muted mt-3 text-xs">New leads always start as New.</p>
      )}

      <DefinitionsList
        definitions={rows}
        createAction={createCustomStatusAction.bind(null, entityType)}
        entityLabel={entityLabel}
        canSetDefault={canSetDefault}
      />
    </div>
  );
}
