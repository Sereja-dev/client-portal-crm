import "server-only";
import { prisma } from "@/lib/prisma";
import { formatActivity, type ActivityDisplayModel } from "@/lib/activity/format-activity";
import { formatCommentViewModel, resolveCommentPermissions, type CommentPermissions, type CommentViewModel } from "@/lib/comments/format-comment";

/**
 * Projects & Tasks Work Hub V1 — Project's own merged Activity feed,
 * analogous to Client/Lead's `getTimelineForEntity` (src/lib/timeline/
 * timeline.ts) but NOT a reuse of it: Project/Task discussion uses the
 * `Comment` model (`CommentEntityType: PROJECT | TASK`), a structurally
 * separate table from `TimelineNote` (`TimelineNoteEntityType: CLIENT |
 * LEAD`) — a deliberate, pre-existing schema split this feature must
 * respect, never widen (see the read-only audit's own §O finding: Comment
 * and TimelineNote are kept apart on purpose, not an oversight to "fix" by
 * merging the two models together).
 *
 * Same "simple bounded merge, no keyset pagination" philosophy
 * getTimelineForEntity's own doc comment establishes: fetches a bounded
 * slice from each source, merges/sorts in application code, caps the
 * final result. No "Load more" in this V1 — a single Project's own
 * history is not expected to exceed the cap any time soon; a real
 * keyset-cursor merge is the future upgrade path if that ever changes, not
 * a rewrite of this module.
 *
 * Ownership/tenant-scoping is NOT re-verified here — every caller (the
 * Project Hub page) already resolved and 404'd on `Project.findFirst({id,
 * organizationId})` once, up front, before ever routing to any tab —
 * matching every other Project Hub tab-fetch function's own convention
 * (profile-query.ts), not getTimelineForEntity's own extra check (which
 * exists there because TimelineSection has historically been called from
 * contexts that hadn't already done that check).
 */

const ACTIVITY_SOURCE_FETCH_LIMIT = 30;
export const PROJECT_ACTIVITY_MERGE_LIMIT = 30;

export type ProjectActivityItem =
  | { kind: "activity"; id: string; createdAt: Date; display: ActivityDisplayModel }
  | {
      kind: "comment";
      id: string;
      createdAt: Date;
      comment: CommentViewModel;
      permissions: CommentPermissions;
    };

/** Deterministic newest-first comparator — identical shape to compareTimelineItems (createdAt DESC, then id DESC as a stable, deterministic tie-break across two different tables' own UUID sequences). */
function compareProjectActivityItems(a: ProjectActivityItem, b: ProjectActivityItem): number {
  const byTime = b.createdAt.getTime() - a.createdAt.getTime();
  if (byTime !== 0) return byTime;
  if (a.id === b.id) return 0;
  return a.id > b.id ? -1 : 1;
}

export async function getProjectActivityFeed(
  organizationId: string,
  projectId: string,
  currentUserId: string,
  isModerator: boolean,
): Promise<ProjectActivityItem[]> {
  const [activityRows, commentRows] = await Promise.all([
    prisma.activity.findMany({
      where: { organizationId, entityType: "PROJECT", entityId: projectId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: ACTIVITY_SOURCE_FETCH_LIMIT,
      include: { actor: { select: { name: true, email: true } } },
    }),
    // Soft-deleted comments are NOT excluded — same convention
    // CommentsSection itself already follows (formatCommentViewModel
    // renders a truthful "This comment was deleted." placeholder rather
    // than hiding the row, so the thread's own history stays coherent).
    prisma.comment.findMany({
      where: { organizationId, entityType: "PROJECT", entityId: projectId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: ACTIVITY_SOURCE_FETCH_LIMIT,
      include: { author: { select: { name: true } }, mentions: { select: { userId: true } } },
    }),
  ]);

  const activityItems: ProjectActivityItem[] = activityRows.map((row) => ({
    kind: "activity" as const,
    id: row.id,
    createdAt: row.createdAt,
    display: formatActivity({
      entityType: row.entityType,
      action: row.action,
      metadata: row.metadata,
      actor: row.actor,
      createdAt: row.createdAt,
    }),
  }));

  const commentItems: ProjectActivityItem[] = commentRows.map((row) => {
    const viewModel = formatCommentViewModel({
      id: row.id,
      authorId: row.authorId,
      author: row.author,
      body: row.body,
      editedAt: row.editedAt,
      deletedAt: row.deletedAt,
      createdAt: row.createdAt,
      mentions: row.mentions,
    });
    return {
      kind: "comment" as const,
      id: viewModel.id,
      createdAt: viewModel.createdAt,
      comment: viewModel,
      permissions: resolveCommentPermissions(viewModel, currentUserId, isModerator),
    };
  });

  return [...activityItems, ...commentItems]
    .sort(compareProjectActivityItems)
    .slice(0, PROJECT_ACTIVITY_MERGE_LIMIT);
}
