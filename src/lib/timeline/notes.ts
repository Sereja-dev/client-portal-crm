import "server-only";
import type { TimelineNote } from "@/generated/prisma/client";
import type { Role, TimelineNoteEntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { validateCommentBody, type CommentBodyValidationResult } from "@/lib/comments/validate-body";
import type { PrismaClientOrTx } from "./types";
import { assertTimelineEntityOwnership } from "./entity-ownership";

/**
 * Communication Timeline Phase 1 — the free-form Staff note domain
 * layer. Deliberately narrow: create/edit/delete/list only, no
 * pagination cursor yet (a later, UI-facing phase's own concern — see
 * TIMELINE_NOTES_PAGE_SIZE's own comment).
 *
 * Body validation reuses src/lib/comments/validate-body.ts's existing
 * validateCommentBody/COMMENT_BODY_MAX_LENGTH as-is — the same
 * established choice src/lib/client-requests/messages.ts's own
 * addStaffClientRequestMessage/addPortalClientRequestMessage already
 * made for an equivalent plain-text body, rather than inventing a
 * second, parallel length/normalization rule.
 *
 * No Activity row, no Notification, no Workflow Automation dispatch is
 * ever produced by any function in this file — see this feature's own
 * schema doc comment (prisma/schema.prisma, TimelineNote) for why that
 * is deliberate, not an oversight.
 */

export type TimelineNoteActor = { id: string; name: string; role: Role };

function isModerator(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}

// ---------------------------------------------------------------------------
// Create — every Staff role (OWNER/ADMIN/MEMBER) may create a note.
// ---------------------------------------------------------------------------

export type CreateTimelineNoteInput = {
  entityType: TimelineNoteEntityType;
  entityId: string;
  body: unknown;
};

export type CreateTimelineNoteResult =
  | { ok: true; note: TimelineNote }
  | { ok: false; reason: "ENTITY_NOT_FOUND" }
  | { ok: false; reason: "INVALID_BODY"; error: Extract<CommentBodyValidationResult, { ok: false }>["error"] };

export async function createTimelineNote(
  organizationId: string,
  actor: TimelineNoteActor,
  input: CreateTimelineNoteInput,
  client: PrismaClientOrTx = prisma,
): Promise<CreateTimelineNoteResult> {
  // Entity ownership checked first, before body validation — mirrors
  // addStaffClientRequestMessage's own ordering (request existence, then
  // body). Cross-org entityId, and a legacy null-organizationId Client
  // (see assertTimelineEntityOwnership's own comment), both come back
  // ENTITY_NOT_FOUND here — never distinguished from a genuinely
  // nonexistent id.
  const owns = await assertTimelineEntityOwnership(organizationId, input.entityType, input.entityId, client);
  if (!owns) {
    return { ok: false, reason: "ENTITY_NOT_FOUND" };
  }

  const validated = validateCommentBody(input.body);
  if (!validated.ok) {
    return { ok: false, reason: "INVALID_BODY", error: validated.error };
  }

  const note = await client.timelineNote.create({
    data: {
      organizationId,
      authorId: actor.id,
      entityType: input.entityType,
      entityId: input.entityId,
      body: validated.body,
    },
  });

  return { ok: true, note };
}

// ---------------------------------------------------------------------------
// Edit — the note's own author, or an OWNER/ADMIN of this organization
// (moderation). A plain MEMBER can never edit someone else's note. Byte-
// for-byte the same permission shape src/lib/comments/delete-comment.ts's
// own isAuthor/isModerator check already establishes (that file's own
// author-or-moderator rule, not edit-comment.ts's stricter author-only
// rule — Communication Timeline Phase 1's own spec explicitly wants
// OWNER/ADMIN to be able to edit, unlike Comment's own edit).
// ---------------------------------------------------------------------------

export type EditTimelineNoteResult =
  | { ok: true; note: TimelineNote }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "DELETED" }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "INVALID_BODY"; error: Extract<CommentBodyValidationResult, { ok: false }>["error"] };

export async function editTimelineNote(
  organizationId: string,
  noteId: string,
  actor: TimelineNoteActor,
  body: unknown,
  client: PrismaClientOrTx = prisma,
): Promise<EditTimelineNoteResult> {
  // Scoped by { id, organizationId } together — a foreign-org note id
  // simply doesn't match, indistinguishable from a nonexistent one, same
  // discipline as every other lookup in this app.
  const note = await client.timelineNote.findFirst({ where: { id: noteId, organizationId } });
  if (!note) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (note.deletedAt !== null) {
    return { ok: false, reason: "DELETED" };
  }

  const isAuthor = note.authorId === actor.id;
  if (!isAuthor && !isModerator(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const validated = validateCommentBody(body);
  if (!validated.ok) {
    return { ok: false, reason: "INVALID_BODY", error: validated.error };
  }

  // authorId is never part of this update — attribution is always
  // preserved, whether the edit was made by the original author or a
  // moderating OWNER/ADMIN.
  const updated = await client.timelineNote.update({
    where: { id: noteId },
    data: { body: validated.body, editedAt: new Date() },
  });

  return { ok: true, note: updated };
}

// ---------------------------------------------------------------------------
// Delete — soft delete only, same permission shape as edit. Idempotent:
// an already-deleted note is a safe no-op success (mirrors delete-
// comment.ts's own "already_deleted" convention exactly), checked before
// the permission check so a redundant call never depends on who's
// asking.
// ---------------------------------------------------------------------------

export type DeleteTimelineNoteResult =
  | { ok: true; alreadyDeleted: boolean }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "FORBIDDEN" };

export async function deleteTimelineNote(
  organizationId: string,
  noteId: string,
  actor: TimelineNoteActor,
  client: PrismaClientOrTx = prisma,
): Promise<DeleteTimelineNoteResult> {
  const note = await client.timelineNote.findFirst({ where: { id: noteId, organizationId } });
  if (!note) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (note.deletedAt !== null) {
    return { ok: true, alreadyDeleted: true };
  }

  const isAuthor = note.authorId === actor.id;
  if (!isAuthor && !isModerator(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  // Soft delete only — the row and its body are never removed, matching
  // Comment.deletedAt's own contract exactly (see TimelineNote's own
  // schema doc comment).
  await client.timelineNote.update({ where: { id: noteId }, data: { deletedAt: new Date() } });

  return { ok: true, alreadyDeleted: false };
}

// ---------------------------------------------------------------------------
// List — open to any Staff role (no actor parameter needed at all),
// mirroring listTags/getTag's own "reads are open, only mutation is
// privileged" split — every Staff role that can view the entity can view
// its notes.
// ---------------------------------------------------------------------------

// Bounded, not "load more"-paginated yet — a later, UI-facing phase's own
// concern once a real Timeline page exists (see the architecture audit's
// own §I: keyset cursor, same {createdAt, id} shape as
// src/lib/activity/cursor.ts, reused verbatim). A single entity's own
// note volume is expected to be small; this cap exists purely as a
// defensive ceiling for this phase's domain layer, not a real pagination
// UX yet.
export const TIMELINE_NOTES_PAGE_SIZE = 25;

export type ListTimelineNotesResult = { ok: true; notes: TimelineNote[] } | { ok: false; reason: "ENTITY_NOT_FOUND" };

export async function listTimelineNotesForEntity(
  organizationId: string,
  entityType: TimelineNoteEntityType,
  entityId: string,
  client: PrismaClientOrTx = prisma,
): Promise<ListTimelineNotesResult> {
  const owns = await assertTimelineEntityOwnership(organizationId, entityType, entityId, client);
  if (!owns) {
    return { ok: false, reason: "ENTITY_NOT_FOUND" };
  }

  // Soft-deleted notes are excluded from the normal list — the row
  // itself is never removed (see deleteTimelineNote's own comment), just
  // never surfaced here. ORDER BY createdAt DESC, id DESC — identical
  // sort/tie-break shape to Activity's own entity-specific timeline
  // query, ready for the same keyset-cursor treatment later.
  const notes = await client.timelineNote.findMany({
    where: { organizationId, entityType, entityId, deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: TIMELINE_NOTES_PAGE_SIZE,
  });

  return { ok: true, notes };
}
