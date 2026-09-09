import { getCurrentUserOrganization } from "@/lib/current-user";
import { listCustomFieldDefinitions } from "@/lib/custom-fields/definitions";
import { listCustomFieldOptions } from "@/lib/custom-fields/options";
import { EntityTabs } from "@/components/custom-fields/entity-tabs";
import { DefinitionsList, type DefinitionRow } from "@/components/custom-fields/definitions-list";
import type { OptionRow } from "@/components/custom-fields/option-manager";
import type { RawSearchParams } from "@/lib/list-params";
import { parseCustomFieldEntityTypeParam, ENTITY_TYPE_LABELS } from "./view-params";
import {
  createDefinitionAction,
  updateDefinitionAction,
  archiveDefinitionAction,
  unarchiveDefinitionAction,
  moveDefinitionAction,
  createOptionAction,
  updateOptionAction,
  archiveOptionAction,
  unarchiveOptionAction,
  moveOptionAction,
} from "./actions";

/**
 * Custom Fields Phase 2A (Staff UI) — definition-management only (Section
 * B/C). Reachable at /settings/custom-fields, alongside the app's other
 * Settings pages via SettingsNav. Any OWNER/ADMIN/MEMBER of the
 * organization may view/manage — matches this app's existing Client-
 * management permission model, not the stricter OWNER-only Company
 * Profile/Payment Details/Domain pages (see actions.ts's own header
 * comment).
 *
 * Data is fetched fresh here (no caching layer), same shape as
 * ClientContactsSection: every definition for the current tab's
 * entityType (active + archived, so the archived-toggle can flip between
 * them client-side with no extra round trip), and — for every SELECT
 * definition specifically — its own full option list too, since
 * EditDefinitionDialog's OptionManager needs it already mounted (native
 * `<dialog>` elements are all present in the DOM up front, just hidden
 * until opened — see ContactFormDialog's own comment for why). Every
 * per-row/per-option mutation is bound to its own id right here, before
 * ever reaching a Client Component (same reasoning as
 * ClientContactsSection's own comment).
 */
export default async function CustomFieldsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;
  const entityType = parseCustomFieldEntityTypeParam(resolvedSearchParams);
  const entityLabel = ENTITY_TYPE_LABELS[entityType];

  const definitions = await listCustomFieldDefinitions(organizationId, entityType, { includeArchived: true });

  const rows: DefinitionRow[] = await Promise.all(
    definitions.map(async (definition) => {
      let options: OptionRow[] = [];
      if (definition.fieldType === "SELECT") {
        const result = await listCustomFieldOptions(organizationId, definition.id, { includeArchived: true });
        const optionList = Array.isArray(result) ? result : [];
        options = optionList.map((option) => ({
          id: option.id,
          label: option.label,
          archivedAt: option.archivedAt,
          renameAction: updateOptionAction.bind(null, definition.id, option.id),
          archiveAction: archiveOptionAction.bind(null, definition.id, option.id),
          unarchiveAction: unarchiveOptionAction.bind(null, definition.id, option.id),
          moveUpAction: moveOptionAction.bind(null, definition.id, option.id, "up"),
          moveDownAction: moveOptionAction.bind(null, definition.id, option.id, "down"),
        }));
      }

      return {
        id: definition.id,
        label: definition.label,
        key: definition.key,
        fieldType: definition.fieldType,
        required: definition.required,
        archivedAt: definition.archivedAt,
        options,
        editAction: updateDefinitionAction.bind(null, definition.id),
        archiveAction: archiveDefinitionAction.bind(null, definition.id),
        unarchiveAction: unarchiveDefinitionAction.bind(null, definition.id),
        moveUpAction: moveDefinitionAction.bind(null, entityType, definition.id, "up"),
        moveDownAction: moveDefinitionAction.bind(null, entityType, definition.id, "down"),
        addOptionAction: createOptionAction.bind(null, definition.id),
      };
    }),
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Custom fields</h1>
      <p className="text-text-secondary mt-1 text-sm">
        Define extra fields to capture information specific to your workflow, per record
        type. Custom fields don&apos;t appear on Client/Lead/Project forms yet — this page
        only manages their definitions.
      </p>

      <EntityTabs entityType={entityType} />

      <DefinitionsList
        definitions={rows}
        createAction={createDefinitionAction.bind(null, entityType)}
        entityLabel={entityLabel}
      />
    </div>
  );
}
