import "server-only";
import { listCustomStatusDefinitions } from "@/lib/custom-statuses/definitions";
import { listCustomFieldDefinitions } from "@/lib/custom-fields/definitions";
import { listCustomFieldOptions } from "@/lib/custom-fields/options";
import type { CustomFieldType } from "@/generated/prisma/enums";

/**
 * Workflow Automations V1 — Staff Authoring UI. Read-only presentation
 * plumbing only: composes three already-existing, already-tenant-scoped
 * domain list functions (Custom Statuses/Custom Fields Phase 1) to build
 * the option lists the create/edit form's Custom Status/Custom Field
 * selects need. No business logic lives here — every one of these lists
 * is active-definitions-only by each function's own existing default
 * (archivedAt: null), matching this feature's own "active definitions
 * only" requirement without this file re-deriving that filter itself.
 */

export type WorkflowAutomationCustomStatusOption = { id: string; label: string };

export type WorkflowAutomationCustomFieldOption = {
  id: string;
  label: string;
  fieldType: CustomFieldType;
  /** Only populated for fieldType === "SELECT" — every active option for this definition. */
  options: { id: string; label: string }[];
};

export type WorkflowAutomationEntityOptions = {
  customStatuses: WorkflowAutomationCustomStatusOption[];
  customFields: WorkflowAutomationCustomFieldOption[];
};

/** Active Custom Status/Custom Field definitions (and, for SELECT fields, their active options) for one entity type, scoped to `organizationId`. */
export async function loadWorkflowAutomationEntityOptions(
  organizationId: string,
  entityType: "CLIENT" | "LEAD",
): Promise<WorkflowAutomationEntityOptions> {
  const [statusDefinitions, fieldDefinitions] = await Promise.all([
    listCustomStatusDefinitions(organizationId, entityType),
    listCustomFieldDefinitions(organizationId, entityType),
  ]);

  const customFields = await Promise.all(
    fieldDefinitions.map(async (definition) => {
      if (definition.fieldType !== "SELECT") {
        return { id: definition.id, label: definition.label, fieldType: definition.fieldType, options: [] };
      }
      const options = await listCustomFieldOptions(organizationId, definition.id);
      // DEFINITION_NOT_FOUND is structurally unreachable here — `definition`
      // was just read from this same organizationId a moment ago — handled
      // anyway rather than assumed, per this app's existing discipline.
      return {
        id: definition.id,
        label: definition.label,
        fieldType: definition.fieldType,
        options: Array.isArray(options) ? options.map((option) => ({ id: option.id, label: option.label })) : [],
      };
    }),
  );

  return {
    customStatuses: statusDefinitions.map((definition) => ({ id: definition.id, label: definition.label })),
    customFields,
  };
}

export type WorkflowAutomationLabelMaps = {
  customStatusLabelById: Record<string, string>;
  customFieldLabelById: Record<string, string>;
};

/**
 * Definition-id -> label lookup, for the list page's own action-summary
 * text only (e.g. "Set custom status to Qualified") — never used for
 * validation or authorization, which stays exclusively the domain
 * layer's job. Deliberately `includeArchived: true`: an automation whose
 * action references a since-archived definition should still show that
 * definition's real label in its own summary rather than "Unknown",
 * matching CustomFieldOption's own "an archived option must remain
 * visible somewhere" precedent. Spans both CLIENT and LEAD — definition
 * ids are unique regardless of entity type, so one flat map per kind is
 * enough for every automation in the list, whichever trigger each uses.
 */
export async function loadWorkflowAutomationLabelMaps(organizationId: string): Promise<WorkflowAutomationLabelMaps> {
  const [clientStatuses, leadStatuses, clientFields, leadFields] = await Promise.all([
    listCustomStatusDefinitions(organizationId, "CLIENT", { includeArchived: true }),
    listCustomStatusDefinitions(organizationId, "LEAD", { includeArchived: true }),
    listCustomFieldDefinitions(organizationId, "CLIENT", { includeArchived: true }),
    listCustomFieldDefinitions(organizationId, "LEAD", { includeArchived: true }),
  ]);

  const customStatusLabelById: Record<string, string> = {};
  for (const definition of [...clientStatuses, ...leadStatuses]) {
    customStatusLabelById[definition.id] = definition.label;
  }

  const customFieldLabelById: Record<string, string> = {};
  for (const definition of [...clientFields, ...leadFields]) {
    customFieldLabelById[definition.id] = definition.label;
  }

  return { customStatusLabelById, customFieldLabelById };
}
