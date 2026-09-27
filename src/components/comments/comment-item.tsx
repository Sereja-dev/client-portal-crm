"use client";

import { useState } from "react";
import { relativeTime } from "@/lib/notifications/relative-time";
import { DeleteButton } from "@/components/ui/delete-button";
import { CommentComposer } from "./comment-composer";
import type { CommentViewModel } from "@/lib/comments/format-comment";
import type { MentionCandidate } from "@/lib/comments/mention-candidates";
import type { CommentActionState } from "@/types";

/**
 * Comments & Mentions Stage 4 (docs/comments-architecture.md §7/§8). One
 * comment row — its own local "am I in edit mode" state, the same scale of
 * client-only state NotificationListItem already owns per-row. `id="comment-
 * {uuid}"` on the outer element is the anchor a MENTIONED notification's
 * `#comment-{id}` fragment targets (§11/§12); :target styling for it lives
 * in globals.css, no JS needed for the highlight itself.
 *
 * Edit/delete affordances are a UI convenience only — `canEdit`/`canDelete`
 * are computed server-side (comments-section.tsx, mirroring the exact
 * backend rule in src/lib/comments/edit-comment.ts/delete-comment.ts) and
 * passed down as plain booleans. Hiding a button here is never the actual
 * permission boundary; the Server Action itself re-checks independently.
 */
export function CommentItem({
  comment,
  canEdit,
  canDelete,
  candidates,
  editAction,
  deleteAction,
}: {
  comment: CommentViewModel;
  canEdit: boolean;
  canDelete: boolean;
  candidates: MentionCandidate[];
  editAction: (prevState: CommentActionState, formData: FormData) => Promise<CommentActionState>;
  deleteAction: () => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);

  if (comment.isDeleted) {
    return (
      <li id={`comment-${comment.id}`} className="scroll-mt-20 px-4 py-3">
        <p className="text-text-muted text-sm italic">{comment.placeholder}</p>
      </li>
    );
  }

  return (
    <li id={`comment-${comment.id}`} className="scroll-mt-20 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-text-primary text-sm font-medium">{comment.authorName}</p>
        <time
          dateTime={comment.createdAt.toISOString()}
          title={comment.createdAt.toLocaleString("en-US")}
          className="text-text-muted shrink-0 text-xs"
        >
          {relativeTime(comment.createdAt)}
          {comment.isEdited && <span className="ml-1">(edited)</span>}
        </time>
      </div>

      {isEditing ? (
        <div className="mt-2">
          <CommentComposer
            action={editAction}
            candidates={candidates}
            initialBody={comment.rawBody ?? ""}
            submitLabel="Save"
            pendingLabel="Saving…"
            cancelLabel="Cancel"
            onCancel={() => setIsEditing(false)}
            onSuccess={() => setIsEditing(false)}
            autoFocus
          />
        </div>
      ) : (
        <>
          <p className="text-text-primary mt-1 text-sm whitespace-pre-wrap">
            {comment.segments.map((segment, index) =>
              segment.type === "mention" ? (
                <span
                  key={index}
                  className="bg-info-subtle text-info rounded px-1 font-medium"
                >
                  @{segment.displayName}
                </span>
              ) : (
                <span key={index}>{segment.value}</span>
              ),
            )}
          </p>

          {(canEdit || canDelete) && (
            <div className="mt-2 flex items-center gap-4">
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="text-text-secondary hover:text-text-primary focus-visible:ring-focus-ring rounded text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                >
                  Edit
                </button>
              )}
              {canDelete && (
                <DeleteButton
                  action={deleteAction}
                  itemName="comment"
                  confirmTitle="Delete comment"
                  confirmDescription="Delete this comment? It will be replaced with a placeholder — this action cannot be undone."
                  successMessage="Comment deleted"
                />
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}
