"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMembership } from "@/lib/current-user";
import { createTag, renameTag, archiveTag } from "@/lib/tags/definitions";
import type { CustomStatusColor } from "@/generated/prisma/enums";
import type { TagFormState } from "@/types";

/**
 * Tags V2 (Settings → Tags) — the Server Action layer binding
 * src/lib/tags/definitions.ts's own domain functions to this page's
 * forms/buttons. OWNER/ADMIN-only, exactly mirroring
 * settings/workflow-automations/actions.ts's own header comment: every
 * action here resolves the authenticated staff member's own membership
 * itself (getCurrentMembership()) and passes {id, name, role} as the
 * actor the domain layer already expects — organizationId is never
 * trusted from client input, and createTag/renameTag/archiveTag each
 * independently re-verify the OWNER/ADMIN gate server-side regardless of
 * what this Settings page's own UI does or doesn't offer (Section 8: "the
 * boundary itself enforces it," not merely the hidden nav entry).
 */

const LIST_PATH = "/settings/tags";

const VALID_COLORS: readonly CustomStatusColor[] = ["NEUTRAL", "INFO", "WARNING", "SUCCESS", "DANGER", "MUTED"];

function parseColor(formData: FormData): CustomStatusColor {
  const raw = String(formData.get("color") ?? "");
  return (VALID_COLORS as readonly string[]).includes(raw) ? (raw as CustomStatusColor) : "NEUTRAL";
}

export async function createTagAction(
  _prevState: TagFormState,
  formData: FormData,
): Promise<TagFormState> {
  const { user, organizationId, membership } = await getCurrentMembership(LIST_PATH);
  const actor = { id: user.id, name: user.name, role: membership.role };

  const result = await createTag(organizationId, actor, {
    name: formData.get("name"),
    color: parseColor(formData),
  });

  if (!result.ok) {
    if (result.reason === "FORBIDDEN") {
      return { error: "You don't have permission to do that." };
    }
    if (result.reason === "INVALID_NAME") {
      return { error: null, fieldErrors: { name: result.error } };
    }
    // DUPLICATE_NAME
    return { error: null, fieldErrors: { name: "A tag with this name already exists." } };
  }

  revalidatePath(LIST_PATH);
  return { error: null };
}

export async function updateTagAction(
  tagId: string,
  _prevState: TagFormState,
  formData: FormData,
): Promise<TagFormState> {
  const { user, organizationId, membership } = await getCurrentMembership(LIST_PATH);
  const actor = { id: user.id, name: user.name, role: membership.role };

  const result = await renameTag(organizationId, tagId, actor, {
    name: formData.get("name"),
    color: parseColor(formData),
  });

  if (!result.ok) {
    if (result.reason === "FORBIDDEN") {
      return { error: "You don't have permission to do that." };
    }
    if (result.reason === "INVALID_NAME") {
      return { error: null, fieldErrors: { name: result.error } };
    }
    if (result.reason === "DUPLICATE_NAME") {
      return { error: null, fieldErrors: { name: "A tag with this name already exists." } };
    }
    return { error: "This tag could not be found." };
  }

  revalidatePath(LIST_PATH);
  return { error: null };
}

export async function archiveTagAction(tagId: string): Promise<void> {
  const { user, organizationId, membership } = await getCurrentMembership(LIST_PATH);
  const actor = { id: user.id, name: user.name, role: membership.role };

  const result = await archiveTag(organizationId, tagId, actor);
  if (!result.ok) {
    if (result.reason === "FORBIDDEN") {
      throw new Error("You don't have permission to do that.");
    }
    throw new Error("This tag could not be found.");
  }

  revalidatePath(LIST_PATH);
}
