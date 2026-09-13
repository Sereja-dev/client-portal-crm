"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMembership } from "@/lib/current-user";
import { createTimelineNote, editTimelineNote, deleteTimelineNote } from "@/lib/timeline/notes";
import { COMMENT_BODY_MAX_LENGTH } from "@/lib/comments/validate-body";
import type { TimelineNoteActionState } from "@/types";

/**
 * Communication Timeline Phase 2 — thin wrappers only, mirroring
 * src/app/(dashboard)/projects/[id]/edit/comment-actions.ts's own exact
 * shape. Every real decision (entity ownership, body validation,
 * author-or-moderator permission) lives in the shared
 * src/lib/timeline/notes.ts domain functions; these functions exist
 * solely to bind the Client id, resolve the acting Staff member's own
 * membership server-side (never trusting organizationId or authorId from
 * client input), read the plain-text `body` field out of FormData, and
 * translate the shared result into this app's usual `{ error }` action-
 * state shape.
 */

const editPath = (clientId: string) => `/clients/${clientId}/edit`;

export async function createClientTimelineNoteAction(
  clientId: string,
  _prevState: TimelineNoteActionState,
  formData: FormData,
): Promise<TimelineNoteActionState> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const actor = { id: user.id, name: user.name, role: membership.role };

  const result = await createTimelineNote(organizationId, actor, {
    entityType: "CLIENT",
    entityId: clientId,
    body: formData.get("body"),
  });

  if (!result.ok) {
    return { error: mapCreateOrEditError(result) };
  }

  revalidatePath(editPath(clientId));
  return { error: null };
}

export async function editClientTimelineNoteAction(
  clientId: string,
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

  revalidatePath(editPath(clientId));
  return { error: null };
}

export async function deleteClientTimelineNoteAction(clientId: string, noteId: string): Promise<void> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const actor = { id: user.id, name: user.name, role: membership.role };

  const result = await deleteTimelineNote(organizationId, noteId, actor);
  if (!result.ok) {
    throw new Error(result.reason === "FORBIDDEN" ? "You can only delete your own notes." : "This note could not be found.");
  }

  revalidatePath(editPath(clientId));
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
      return "This client could not be found.";
    case "DELETED":
      return "This note has already been deleted.";
    case "FORBIDDEN":
      return "You can only edit your own notes.";
    case "INVALID_BODY":
      return result.error === "empty" ? "Write something before adding a note." : `Note is too long (max ${COMMENT_BODY_MAX_LENGTH} characters).`;
  }
}
