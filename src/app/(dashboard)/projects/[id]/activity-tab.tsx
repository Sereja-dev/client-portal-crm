import { EmptyState } from "@/components/ui/empty-state";
import { CommentComposer } from "@/components/comments/comment-composer";
import { CommentItem } from "@/components/comments/comment-item";
import { TimelineActivityItem } from "@/components/timeline/timeline-activity-item";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { getProjectActivityFeed } from "@/lib/timeline/project-timeline";
import { getMentionCandidates } from "@/lib/comments/mention-candidates";
import { createProjectCommentAction, editProjectCommentAction, deleteProjectCommentAction } from "./activity-actions";

/**
 * Project Hub V1 — the Activity tab: a merged read-only feed of this
 * Project's own Activity (system events) and Comment (staff discussion)
 * rows, newest-first (getProjectActivityFeed's own doc comment), plus the
 * real, unmodified comment composer/edit/delete controls moved here from
 * the old `/projects/[id]/edit` page (read-only audit §11's own explicit
 * requirement — "preserve comment create/edit/delete behavior... move
 * that discussion functionality into the Activity tab"). Reuses
 * `TimelineActivityItem` (Communication Timeline's own Activity-row
 * renderer — entity-agnostic already, no changes needed) and `CommentItem`
 * (Comments & Mentions' own per-comment renderer, complete with its own
 * inline edit/delete) directly, rather than inventing new row components.
 */
export async function ProjectActivityTab({
  organizationId,
  projectId,
  currentUserId,
  isModerator,
}: {
  organizationId: string;
  projectId: string;
  currentUserId: string;
  isModerator: boolean;
}) {
  const [items, candidates] = await Promise.all([
    getProjectActivityFeed(organizationId, projectId, currentUserId, isModerator),
    getMentionCandidates(organizationId),
  ]);

  const createAction = createProjectCommentAction.bind(null, projectId);
  const makeEditAction = (commentId: string) => editProjectCommentAction.bind(null, projectId, commentId);
  const makeDeleteAction = (commentId: string) => deleteProjectCommentAction.bind(null, projectId, commentId);

  return (
    <div>
      <div>
        <CommentComposer action={createAction} candidates={candidates} />
      </div>

      <div className="mt-4">
        {items.length === 0 ? (
          <EmptyState title="Nothing here yet" description="Activity and staff comments for this project will appear here." />
        ) : (
          <ul className={`divide-border-subtle divide-y ${CARD_SURFACE_CLASSES}`}>
            {items.map((item) =>
              item.kind === "activity" ? (
                <TimelineActivityItem key={`activity-${item.id}`} display={item.display} />
              ) : (
                <CommentItem
                  key={`comment-${item.id}`}
                  comment={item.comment}
                  canEdit={item.permissions.canEdit}
                  canDelete={item.permissions.canDelete}
                  candidates={candidates}
                  editAction={makeEditAction(item.id)}
                  deleteAction={makeDeleteAction(item.id)}
                />
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
