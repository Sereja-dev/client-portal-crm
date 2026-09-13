"use client";

import { useState } from "react";
import { relativeTime } from "@/lib/notifications/relative-time";
import { DeleteButton } from "@/components/ui/delete-button";
import { NoteComposer } from "./note-composer";
import type { TimelineNotePermissions } from "@/lib/timeline/format-note";
import type { TimelineNoteActionState } from "@/types";

/**
 * Communication Timeline Phase 2 — one Staff-note row, byte-for-byte
 * mirroring src/components/comments/comment-item.tsx's own shape: its
 * own local "am I in edit mode" state, the same scale of client-only
 * state that component already owns per-row.
 *
 * `permissions` is computed server-side (resolveTimelineNotePermissions,
 * mirroring the exact backend rule in src/lib/timeline/notes.ts's own
 * canModifyTimelineNote) and passed down as plain booleans — hiding a
 * button here is never the actual permission boundary; the Server Action
 * itself (editTimelineNoteAction/deleteTimelineNoteAction) re-checks
 * independently via the same canModifyTimelineNote call.
 */
export function TimelineNoteItem({
  id,
  body,
  authorName,
  createdAt,
  isEdited,
  permissions,
  editAction,
  deleteAction,
}: {
  id: string;
  body: string;
  authorName: string;
  createdAt: Date;
  isEdited: boolean;
  permissions: TimelineNotePermissions;
  editAction: (prevState: TimelineNoteActionState, formData: FormData) => Promise<TimelineNoteActionState>;
  deleteAction: () => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <li id={`timeline-note-${id}`} className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="text-text-primary truncate text-sm font-medium">{authorName}</p>
          <span className="bg-info-subtle text-info inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap">
            Note
          </span>
        </div>
        <time
          dateTime={createdAt.toISOString()}
          title={createdAt.toLocaleString()}
          className="text-text-muted shrink-0 text-xs"
        >
          {relativeTime(createdAt)}
          {isEdited && <span className="ml-1">(edited)</span>}
        </time>
      </div>

      {isEditing ? (
        <div className="mt-2">
          <NoteComposer
            action={editAction}
            initialBody={body}
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
          <p className="text-text-primary mt-1 text-sm whitespace-pre-wrap">{body}</p>

          {(permissions.canEdit || permissions.canDelete) && (
            <div className="mt-2 flex items-center gap-4">
              {permissions.canEdit && (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="text-text-secondary hover:text-text-primary focus-visible:ring-focus-ring rounded text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                >
                  Edit
                </button>
              )}
              {permissions.canDelete && (
                <DeleteButton
                  action={deleteAction}
                  itemName="note"
                  confirmTitle="Delete note"
                  confirmDescription="Delete this note? This action cannot be undone."
                  successMessage="Note deleted"
                />
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}
