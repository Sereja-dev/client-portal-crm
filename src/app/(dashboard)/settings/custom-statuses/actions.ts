"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserOrganization } from "@/lib/current-user";
import type { CustomStatusEntityType, CustomStatusColor } from "@/generated/prisma/enums";
import {
  createCustomStatusDefinition,
  updateCustomStatusDefinition,
  archiveCustomStatusDefinition,
  unarchiveCustomStatusDefinition,
  setDefaultCustomStatusDefinition,
  moveCustomStatusDefinition,
} from "@/lib/custom-statuses/definitions";
import type { CustomStatusDefinitionFormState } from "@/types";

/**
 * Custom Statuses Phase 2B — the Server Action layer binding
 * src/lib/custom-statuses/definitions.ts's own domain functions to this
 * page's forms/buttons. Byte-for-byte mirror of settings/custom-fields/
 * actions.ts's own header comment: any OWNER/ADMIN/MEMBER of the
 * organization may manage Custom Status definitions — no extra role gate,
 * matching this app's existing Client-management permission model (and
 * Custom Fields' own identical precedent). Every action re-derives
 * organizationId itself via getCurrentUserOrganization() — never trusts a
 * client-supplied value — and every domain-layer call already re-
 * validates definition ownership + entityType (see definitions.ts's own
 * security comments), so a crafted id can never reach another
 * organization's data, and `isSystem` is never caller-controlled anywhere
 * in this file (createCustomStatusDefinition always creates isSystem:
 * false; updateCustomStatusDefinition/archiveCustomStatusDefinition both
 * reject a SYSTEM_DEFINITION target server-side, independent of anything
 * the UI does or doesn't offer — Section E/S: "tighten the Server Action
 * boundary, don't rely on the UI alone").
 *
 * `entityType` on createCustomStatusAction/moveCustomStatusAction and
 * `direction` on the move action are bound server-side by the Server
 * Component that renders each trigger (e.g.
 * `createCustomStatusAction.bind(null, entityType)`) — never read from
 * FormData — so a crafted form field can never change which entity type
 * a new definition targets, or turn a "move up" button into a "move
 * down" (Section Q). `key`/`isSystem` are never read from FormData by any
 * action here at all.
 */

const VALID_COLORS: readonly CustomStatusColor[] = ["NEUTRAL", "INFO", "WARNING", "SUCCESS", "DANGER", "MUTED"];

function parseColor(formData: FormData): CustomStatusColor {
  const raw = String(formData.get("color") ?? "");
  return (VALID_COLORS as readonly string[]).includes(raw) ? (raw as CustomStatusColor) : "NEUTRAL";
}

export async function createCustomStatusAction(
  entityType: CustomStatusEntityType,
  _prevState: CustomStatusDefinitionFormState,
  formData: FormData,
): Promise<CustomStatusDefinitionFormState> {
  const label = String(formData.get("label") ?? "").trim();
  const color = parseColor(formData);
  const makeDefault = formData.get("isDefault") === "on";

  if (!label) {
    return { error: null, fieldErrors: { label: "Label is required." } };
  }

  // Phase 2B Completion Pass (Section B/C) — the LEAD default is
  // permanently locked to the system NEW definition (new leads always
  // start there — a pre-existing invariant this Settings surface must
  // never appear to control). The create dialog never renders this
  // checkbox for the LEAD tab at all, but a crafted FormData could still
  // set it — rejected explicitly, before anything is created, rather
  // than silently creating the status and ignoring the flag.
  if (entityType === "LEAD" && makeDefault) {
    return { error: "New leads always start as New — leads can't have a different default status." };
  }

  const { organizationId } = await getCurrentUserOrganization();

  const result = await createCustomStatusDefinition(organizationId, entityType, { label, color });

  if (!result.ok) {
    if (result.reason === "INVALID_LABEL") {
      return { error: null, fieldErrors: { label: "Label is required." } };
    }
    // CONCURRENT_KEY_CONFLICT — a genuinely rare race (two Staff members
    // creating a status with the same derived key at the same instant).
    return { error: "Could not create this status. Please try again." };
  }

  // Section F: "Default checkbox optional" — the definition is always
  // created isDefault: false (createCustomStatusDefinition's own
  // contract); this second, explicit call is what actually makes it the
  // default when the checkbox was checked, atomically unsetting whichever
  // definition previously held that spot. A failure here (genuinely
  // unreachable in practice — the definition was just created and is
  // never archived) is deliberately not treated as the whole action
  // failing; the status itself was still created successfully.
  if (makeDefault) {
    await setDefaultCustomStatusDefinition(organizationId, entityType, result.definition.id);
  }

  revalidatePath("/settings/custom-statuses");
  return { error: null };
}

/**
 * Label/color only — entityType/key/isSystem are structurally immutable
 * through this action (see this file's own header comment). Rejects a
 * SYSTEM definition server-side (Section E) even though the UI never
 * offers this dialog for one — the boundary itself enforces it.
 */
export async function updateCustomStatusAction(
  definitionId: string,
  _prevState: CustomStatusDefinitionFormState,
  formData: FormData,
): Promise<CustomStatusDefinitionFormState> {
  const label = String(formData.get("label") ?? "").trim();
  const color = parseColor(formData);

  if (!label) {
    return { error: null, fieldErrors: { label: "Label is required." } };
  }

  const { organizationId } = await getCurrentUserOrganization();

  const result = await updateCustomStatusDefinition(organizationId, definitionId, { label, color });

  if (!result.ok) {
    if (result.reason === "INVALID_LABEL") {
      return { error: null, fieldErrors: { label: "Label is required." } };
    }
    if (result.reason === "SYSTEM_DEFINITION") {
      return { error: "Built-in statuses can't be edited." };
    }
    return { error: "Status not found." };
  }

  revalidatePath("/settings/custom-statuses");
  return { error: null };
}

/** Rejects SYSTEM_DEFINITION and IS_CURRENT_DEFAULT server-side (Section E/H/S) — the UI never offers Archive for either case, but the boundary itself still enforces both. */
export async function archiveCustomStatusAction(definitionId: string): Promise<void> {
  const { organizationId } = await getCurrentUserOrganization();

  const result = await archiveCustomStatusDefinition(organizationId, definitionId);
  if (!result.ok) {
    if (result.reason === "SYSTEM_DEFINITION") {
      throw new Error("Built-in statuses can't be archived.");
    }
    if (result.reason === "IS_CURRENT_DEFAULT") {
      throw new Error("Set a different default before archiving this status.");
    }
    throw new Error("Status not found.");
  }

  revalidatePath("/settings/custom-statuses");
}

export async function unarchiveCustomStatusAction(definitionId: string): Promise<void> {
  const { organizationId } = await getCurrentUserOrganization();

  const result = await unarchiveCustomStatusDefinition(organizationId, definitionId);
  if (!result.ok) {
    throw new Error("Status not found.");
  }

  revalidatePath("/settings/custom-statuses");
}

/**
 * Works for both system and custom targets (Section H/K — "Works for
 * both system and custom definitions") for CLIENT/PROJECT; rejects an
 * archived target server-side. LEAD is the one exception (Section B/C):
 * the domain layer itself rejects any target other than the system NEW
 * definition — the Settings UI never renders "Set default" for another
 * LEAD status at all, but this boundary enforces it independently of
 * that (a crafted call can never change it).
 */
export async function setDefaultCustomStatusAction(
  entityType: CustomStatusEntityType,
  definitionId: string,
): Promise<void> {
  const { organizationId } = await getCurrentUserOrganization();

  const result = await setDefaultCustomStatusDefinition(organizationId, entityType, definitionId);
  if (!result.ok) {
    if (result.reason === "ARCHIVED_DEFINITION") {
      throw new Error("An archived status can't be made the default.");
    }
    if (result.reason === "LEAD_DEFAULT_LOCKED") {
      throw new Error("New leads always start as New — the Lead default can't be changed.");
    }
    throw new Error("Status not found.");
  }

  revalidatePath("/settings/custom-statuses");
}

/**
 * `direction` is bound server-side (one action instance per button — see
 * this file's own header comment), never taken from client input.
 * CANNOT_MOVE (already first/last in the active list) is a benign no-op,
 * not an error — the UI already disables the button at either end, so
 * this only matters as a defensive fallback against a race with another
 * Staff tab's concurrent reorder.
 */
export async function moveCustomStatusAction(
  entityType: CustomStatusEntityType,
  definitionId: string,
  direction: "up" | "down",
): Promise<void> {
  const { organizationId } = await getCurrentUserOrganization();

  const result = await moveCustomStatusDefinition(organizationId, entityType, definitionId, direction);
  if (!result.ok && result.reason === "DEFINITION_NOT_FOUND") {
    throw new Error("Status not found.");
  }

  revalidatePath("/settings/custom-statuses");
}
