"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserOrganization } from "@/lib/current-user";
import type { CustomFieldEntityType } from "@/generated/prisma/enums";
import {
  createCustomFieldDefinition,
  updateCustomFieldDefinition,
  archiveCustomFieldDefinition,
  unarchiveCustomFieldDefinition,
  moveCustomFieldDefinition,
} from "@/lib/custom-fields/definitions";
import {
  createCustomFieldOption,
  renameCustomFieldOption,
  archiveCustomFieldOption,
  unarchiveCustomFieldOption,
  moveCustomFieldOption,
} from "@/lib/custom-fields/options";
import {
  parseCustomFieldDefinitionCreateForm,
  parseCustomFieldDefinitionUpdateForm,
  parseCustomFieldOptionForm,
  parseCustomFieldOptionLabels,
} from "@/lib/validation/custom-field";
import type { CustomFieldDefinitionFormState, CustomFieldOptionFormState } from "@/types";

/**
 * Custom Fields Phase 2A — the Server Action layer binding
 * src/lib/custom-fields/{definitions,options}.ts's own domain functions
 * to this page's forms/buttons. Every action here follows this app's
 * existing Client-management permission model exactly (see
 * clients/[id]/edit/contact-actions.ts's own comment): any OWNER/ADMIN/
 * MEMBER of the organization may manage Custom Field definitions/options
 * — no extra role gate, matching how any staff member may already manage
 * Clients/Contacts. Every action re-derives organizationId itself via
 * getCurrentUserOrganization() — never trusts a client-supplied value —
 * and every domain-layer call already re-validates definition/option
 * ownership (see those files' own security comments), so a crafted id
 * can never reach another organization's data.
 *
 * `entityType` on createDefinitionAction and `direction` on the two move
 * actions are bound server-side by the Server Component that renders
 * each trigger (e.g. `createDefinitionAction.bind(null, entityType)`) —
 * never read from FormData — so a crafted form field can never change
 * which entity type a new definition targets, or turn a "move up" button
 * into a "move down" (Section Q). fieldType/entityType/key are never
 * read from FormData by any action here at all — updateDefinitionAction's
 * own parser (parseCustomFieldDefinitionUpdateForm) only ever extracts
 * label/required, so there is no code path through this file that could
 * reach the domain layer with a type or entity-type change.
 */

export async function createDefinitionAction(
  entityType: CustomFieldEntityType,
  _prevState: CustomFieldDefinitionFormState,
  formData: FormData,
): Promise<CustomFieldDefinitionFormState> {
  const { values, fieldErrors } = parseCustomFieldDefinitionCreateForm(formData);
  if (Object.keys(fieldErrors).length > 0 || !values.fieldType) {
    return { error: null, fieldErrors };
  }

  const { organizationId } = await getCurrentUserOrganization();

  const result = await createCustomFieldDefinition(organizationId, entityType, {
    label: values.label,
    fieldType: values.fieldType,
    required: values.required,
  });

  if (!result.ok) {
    if (result.reason === "INVALID_LABEL") {
      return { error: null, fieldErrors: { label: "Label is required." } };
    }
    // CONCURRENT_KEY_CONFLICT — a genuinely rare race (two Staff members
    // creating a field with the same derived key at the same instant).
    return { error: "Could not create this field. Please try again." };
  }

  // Batched SELECT options (Section F/J) — only meaningful for a
  // brand-new SELECT definition, since no CustomFieldOption can exist
  // before its parent CustomFieldDefinition does. Each non-empty
  // `optionLabel` field in the Create dialog's dynamic list becomes one
  // option, created in submission order (createCustomFieldOption's own
  // position = current max + 1 per call preserves that order).
  if (values.fieldType === "SELECT") {
    for (const label of parseCustomFieldOptionLabels(formData)) {
      await createCustomFieldOption(organizationId, result.definition.id, { label });
    }
  }

  revalidatePath("/settings/custom-fields");
  return { error: null };
}

/** Label/required only — fieldType/entityType/key are structurally immutable through this action (see this file's own header comment). */
export async function updateDefinitionAction(
  definitionId: string,
  _prevState: CustomFieldDefinitionFormState,
  formData: FormData,
): Promise<CustomFieldDefinitionFormState> {
  const { values, fieldErrors } = parseCustomFieldDefinitionUpdateForm(formData);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  const { organizationId } = await getCurrentUserOrganization();

  const result = await updateCustomFieldDefinition(organizationId, definitionId, {
    label: values.label,
    required: values.required,
  });

  if (!result.ok) {
    if (result.reason === "INVALID_LABEL") {
      return { error: null, fieldErrors: { label: "Label is required." } };
    }
    return { error: "Custom field not found." };
  }

  revalidatePath("/settings/custom-fields");
  return { error: null };
}

export async function archiveDefinitionAction(definitionId: string): Promise<void> {
  const { organizationId } = await getCurrentUserOrganization();

  const result = await archiveCustomFieldDefinition(organizationId, definitionId);
  if (!result.ok) {
    throw new Error("Custom field not found.");
  }

  revalidatePath("/settings/custom-fields");
}

export async function unarchiveDefinitionAction(definitionId: string): Promise<void> {
  const { organizationId } = await getCurrentUserOrganization();

  const result = await unarchiveCustomFieldDefinition(organizationId, definitionId);
  if (!result.ok) {
    throw new Error("Custom field not found.");
  }

  revalidatePath("/settings/custom-fields");
}

/**
 * `direction` is bound server-side (one action instance per button — see
 * this file's own header comment), never taken from client input.
 * CANNOT_MOVE (already first/last in the active list) is a benign no-op,
 * not an error — the UI already disables/hides the button at either end,
 * so this only matters as a defensive fallback against a race with
 * another Staff tab's concurrent reorder, and silently doing nothing is
 * the correct response to that race, not a thrown error.
 */
export async function moveDefinitionAction(
  entityType: CustomFieldEntityType,
  definitionId: string,
  direction: "up" | "down",
): Promise<void> {
  const { organizationId } = await getCurrentUserOrganization();

  const result = await moveCustomFieldDefinition(organizationId, entityType, definitionId, direction);
  if (!result.ok && result.reason === "DEFINITION_NOT_FOUND") {
    throw new Error("Custom field not found.");
  }

  revalidatePath("/settings/custom-fields");
}

// ---------------------------------------------------------------------
// SELECT options
// ---------------------------------------------------------------------

export async function createOptionAction(
  definitionId: string,
  _prevState: CustomFieldOptionFormState,
  formData: FormData,
): Promise<CustomFieldOptionFormState> {
  const { values, fieldErrors } = parseCustomFieldOptionForm(formData);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  const { organizationId } = await getCurrentUserOrganization();

  const result = await createCustomFieldOption(organizationId, definitionId, { label: values.label });

  if (!result.ok) {
    if (result.reason === "INVALID_LABEL") {
      return { error: null, fieldErrors: { label: "Label is required." } };
    }
    if (result.reason === "DEFINITION_NOT_FOUND") {
      return { error: "Custom field not found." };
    }
    if (result.reason === "NOT_SELECT_FIELD") {
      return { error: "Options can only be added to a Select field." };
    }
    // CONCURRENT_VALUE_CONFLICT — a genuinely rare race.
    return { error: "Could not add this option. Please try again." };
  }

  revalidatePath("/settings/custom-fields");
  return { error: null };
}

/** Renames an option's label only — `value` (its stable machine identity) never changes here (Section J's own precedent, see renameCustomFieldOption's own comment). */
export async function updateOptionAction(
  definitionId: string,
  optionId: string,
  _prevState: CustomFieldOptionFormState,
  formData: FormData,
): Promise<CustomFieldOptionFormState> {
  const { values, fieldErrors } = parseCustomFieldOptionForm(formData);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  const { organizationId } = await getCurrentUserOrganization();

  const result = await renameCustomFieldOption(organizationId, definitionId, optionId, values.label);

  if (!result.ok) {
    if (result.reason === "INVALID_LABEL") {
      return { error: null, fieldErrors: { label: "Label is required." } };
    }
    return { error: "Option not found." };
  }

  revalidatePath("/settings/custom-fields");
  return { error: null };
}

export async function archiveOptionAction(definitionId: string, optionId: string): Promise<void> {
  const { organizationId } = await getCurrentUserOrganization();

  const result = await archiveCustomFieldOption(organizationId, definitionId, optionId);
  if (!result.ok) {
    throw new Error("Option not found.");
  }

  revalidatePath("/settings/custom-fields");
}

export async function unarchiveOptionAction(definitionId: string, optionId: string): Promise<void> {
  const { organizationId } = await getCurrentUserOrganization();

  const result = await unarchiveCustomFieldOption(organizationId, definitionId, optionId);
  if (!result.ok) {
    throw new Error("Option not found.");
  }

  revalidatePath("/settings/custom-fields");
}

/** Same CANNOT_MOVE-is-benign reasoning as moveDefinitionAction above. */
export async function moveOptionAction(
  definitionId: string,
  optionId: string,
  direction: "up" | "down",
): Promise<void> {
  const { organizationId } = await getCurrentUserOrganization();

  const result = await moveCustomFieldOption(organizationId, definitionId, optionId, direction);
  if (!result.ok && result.reason !== "CANNOT_MOVE") {
    throw new Error("Option not found.");
  }

  revalidatePath("/settings/custom-fields");
}
