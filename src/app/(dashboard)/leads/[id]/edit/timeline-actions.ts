"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMembership } from "@/lib/current-user";
import { createTimelineNote, editTimelineNote, deleteTimelineNote } from "@/lib/timeline/notes";
import { COMMENT_BODY_MAX_LENGTH } from "@/lib/comments/validate-body";
import type { TimelineNoteActionState } from "@/types";

/**
 * Communication Timeline Phase 2 — thin wrappers only. See
 * clients/[id]/edit/timeline-actions.ts's own identical header comment;
 * this is the byte-for-byte Lead-scoped sibling.
 */

const editPath = (leadId: string) => `/leads/${leadId}/edit`;

export async function createLeadTimelineNoteAction(
  leadId: string,
  _prevState: TimelineNoteActionState,
  formData: FormData,
): Promise<TimelineNoteActionState> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const actor = { id: user.id, name: user.name, role: membership.role };

  const result = await createTimelineNote(organizationId, actor, {
    entityType: "LEAD",
    entityId: leadId,
    body: formData.get("body"),
  });

  if (!result.ok) {
    return { error: mapCreateOrEditError(result) };
  }

  revalidatePath(editPath(leadId));
  return { error: null };
}

export async function editLeadTimelineNoteAction(
  leadId: string,
  noteId: string,
  _prevState: TimelineNoteActionState,
  formData: FormData,
): Promise<TimelineNoteActionState> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const actor = { id: user.id, name: user.name, role: membership.role };

  const result = await editTimelineNote(organizationId, noteId, actor, formData.get("body"));

  if (!result.ok) {
    return { error: mapCreateOrEditError(result) };
  }

  revalidatePath(editPath(leadId));
  return { error: null };
}

export async function deleteLeadTimelineNoteAction(leadId: string, noteId: string): Promise<void> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const actor = { id: user.id, name: user.name, role: membership.role };

  const result = await deleteTimelineNote(organizationId, noteId, actor);
  if (!result.ok) {
    throw new Error(result.reason === "FORBIDDEN" ? "You can only delete your own notes." : "This note could not be found.");
  }

  revalidatePath(editPath(leadId));
}

type CreateOrEditFailure =
  | { ok: false; reason: "ENTITY_NOT_FOUND" }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "DELETED" }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "INVALID_BODY"; error: "empty" | "too_long" };

function mapCreateOrEditError(result: CreateOrEditFailure): string {
  switch (result.reason) {
    case "ENTITY_NOT_FOUND":
    case "NOT_FOUND":
      return "This lead could not be found.";
    case "DELETED":
      return "This note has already been deleted.";
    case "FORBIDDEN":
      return "You can only edit your own notes.";
    case "INVALID_BODY":
      return result.error === "empty" ? "Write something before adding a note." : `Note is too long (max ${COMMENT_BODY_MAX_LENGTH} characters).`;
  }
}
