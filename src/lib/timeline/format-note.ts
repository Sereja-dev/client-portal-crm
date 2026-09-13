import { canModifyTimelineNote, type TimelineNoteActor } from "./notes";

/**
 * Communication Timeline Phase 2 — a pure presentation transform for one
 * TimelineNote row, byte-for-byte mirroring
 * src/lib/comments/format-comment.ts's own formatCommentViewModel/
 * resolveCommentPermissions shape (CommentViewModel/CommentPermissions):
 * never the raw Prisma row reaching the UI, a safe fallback label for a
 * deleted author, and a UI-gating-only permission resolver that is never
 * the real authorization boundary (see its own doc comment below).
 */

// Same exact wording src/lib/comments/format-comment.ts's own
// DELETED_AUTHOR_LABEL already established for the identical case
// (Comment.authorId gone via SetNull) — reused verbatim for product
// wording consistency, not reinvented.
const DELETED_AUTHOR_LABEL = "Deleted user";

export type TimelineNoteViewModel = {
  id: string;
  authorId: string | null;
  authorName: string;
  body: string;
  isEdited: boolean;
  createdAt: Date;
  editedAt: Date | null;
};

export type TimelineNoteViewModelInput = {
  id: string;
  authorId: string | null;
  author: { name: string } | null;
  body: string;
  editedAt: Date | null;
  createdAt: Date;
};

/** Converts a raw TimelineNote row (+ its joined author) into a safe display model. Never throws — a note whose author row is gone (authorId null, per TimelineNote.authorId's own onDelete: SetNull) falls back to a neutral label rather than a blank or crash. */
export function formatTimelineNoteViewModel(note: TimelineNoteViewModelInput): TimelineNoteViewModel {
  return {
    id: note.id,
    authorId: note.authorId,
    authorName: note.author?.name ?? DELETED_AUTHOR_LABEL,
    body: note.body,
    isEdited: note.editedAt !== null,
    createdAt: note.createdAt,
    editedAt: note.editedAt,
  };
}

export type TimelineNotePermissions = {
  canEdit: boolean;
  canDelete: boolean;
};

/**
 * A pure mirror of the actual backend rule (canModifyTimelineNote, used
 * unchanged by editTimelineNote/deleteTimelineNote), used only to decide
 * whether to *render* an Edit/Delete affordance at all — byte-for-byte
 * the same "UI-gating only, never the real boundary" contract
 * src/lib/comments/format-comment.ts's own resolveCommentPermissions
 * already documents. Edit and delete share one identical permission rule
 * in this feature (unlike Comment's own edit-is-author-only/
 * delete-is-author-or-moderator split), so both fields always agree —
 * kept as two fields anyway, matching CommentPermissions' own shape, in
 * case a future phase ever needs them to diverge.
 */
export function resolveTimelineNotePermissions(
  note: Pick<TimelineNoteViewModel, "authorId">,
  actor: TimelineNoteActor,
): TimelineNotePermissions {
  const canModify = canModifyTimelineNote(actor, { authorId: note.authorId });
  return { canEdit: canModify, canDelete: canModify };
}
