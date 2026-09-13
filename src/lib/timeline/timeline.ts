import "server-only";
import type { TimelineNoteEntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { formatActivity, type ActivityDisplayModel } from "@/lib/activity/format-activity";
import type { PrismaClientOrTx } from "./types";
import { assertTimelineEntityOwnership } from "./entity-ownership";
import { formatTimelineNoteViewModel, resolveTimelineNotePermissions, type TimelineNotePermissions } from "./format-note";
import type { TimelineNoteActor } from "./notes";

/**
 * Communication Timeline Phase 2 — the entity-scoped read/merge layer.
 * Combines this exact Client/Lead's own canonical Activity history with
 * its free-form TimelineNote rows into one chronological, UI-ready list.
 *
 * Deliberately a *simple bounded merge*, not a real cross-table keyset-
 * pagination protocol (see the architecture audit's own §I and this
 * feature's own task spec: "prefer a simple bounded merged timeline over
 * a complicated dual-table cursor protocol... if implementing correct
 * cross-table keyset pagination becomes materially complicated, omit
 * 'Load more' in this phase and document the bounded-history
 * limitation"). This module fetches a bounded slice from each source,
 * merges/sorts in application code, and caps the final result — there is
 * no "Load more" affordance in this phase. A single Client/Lead's own
 * history is not expected to exceed TIMELINE_MERGE_LIMIT items any time
 * soon; if that ever changes, a real keyset-cursor merge (reusing
 * src/lib/activity/cursor.ts's own {createdAt, id} shape) is the future
 * upgrade path, not a rewrite of this one.
 */

// Each source is over-fetched up to this many rows before merging, so
// that if one source (typically Activity, the higher-volume one) alone
// already exceeds the final cap, the merge still reflects genuinely the
// most recent items from BOTH sources rather than silently starving
// whichever source happens to sort later in a naive single-source
// take(). Equal to the final cap for simplicity — see TIMELINE_MERGE_LIMIT.
const TIMELINE_SOURCE_FETCH_LIMIT = 30;

// The final, bounded size of one merged Timeline render — same order of
// magnitude as ACTIVITY_PAGE_SIZE (the org-wide Activity feed's own page
// size) and TIMELINE_NOTES_PAGE_SIZE, deliberately a touch smaller since
// this is a single entity's own (typically much shorter) history, not an
// org-wide feed.
export const TIMELINE_MERGE_LIMIT = 30;

export type TimelineItem =
  | {
      kind: "activity";
      id: string;
      createdAt: Date;
      display: ActivityDisplayModel;
    }
  | {
      kind: "note";
      id: string;
      createdAt: Date;
      body: string;
      authorId: string | null;
      authorName: string;
      isEdited: boolean;
      editedAt: Date | null;
      permissions: TimelineNotePermissions;
    };

export type GetTimelineForEntityResult = { ok: true; items: TimelineItem[] } | { ok: false; reason: "ENTITY_NOT_FOUND" };

/** Deterministic newest-first comparator: createdAt DESC, then id DESC — matches Activity's/TimelineNote's own ORDER BY shape. Comparing ids across two different tables' own UUID sequences is not meaningful as "which one was truly created first" for a genuine tie, but it IS a stable, deterministic tie-break (the same input always sorts the same way), which is all a bounded, non-paginated merge needs. */
function compareTimelineItems(a: TimelineItem, b: TimelineItem): number {
  const byTime = b.createdAt.getTime() - a.createdAt.getTime();
  if (byTime !== 0) return byTime;
  if (a.id === b.id) return 0;
  return a.id > b.id ? -1 : 1;
}

/**
 * The one entry point the Staff UI (and its Server Actions) call.
 * Verifies entity ownership first — a cross-org entityId, or a legacy
 * null-organizationId Client, both resolve to ENTITY_NOT_FOUND here,
 * never distinguished from a genuinely nonexistent id (see
 * assertTimelineEntityOwnership's own comment) — before ever touching
 * either source table.
 *
 * Never queries Activity (or TimelineNote) by entityId alone: both
 * queries below always include organizationId + entityType + entityId
 * together.
 */
export async function getTimelineForEntity(
  organizationId: string,
  entityType: TimelineNoteEntityType,
  entityId: string,
  actor: TimelineNoteActor,
  client: PrismaClientOrTx = prisma,
): Promise<GetTimelineForEntityResult> {
  const owns = await assertTimelineEntityOwnership(organizationId, entityType, entityId, client);
  if (!owns) {
    return { ok: false, reason: "ENTITY_NOT_FOUND" };
  }

  const [activityRows, noteRows] = await Promise.all([
    client.activity.findMany({
      where: { organizationId, entityType, entityId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: TIMELINE_SOURCE_FETCH_LIMIT,
      include: { actor: { select: { name: true, email: true } } },
    }),
    // Excludes soft-deleted notes — the row itself is never removed (see
    // deleteTimelineNote's own comment), just never surfaced here.
    client.timelineNote.findMany({
      where: { organizationId, entityType, entityId, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: TIMELINE_SOURCE_FETCH_LIMIT,
      include: { author: { select: { name: true } } },
    }),
  ]);

  // Every Activity row is run through the existing, safe formatter — raw
  // metadata never reaches the returned TimelineItem, matching
  // formatActivity's own "never render metadata directly" contract.
  const activityItems: TimelineItem[] = activityRows.map((row) => ({
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

  const noteItems: TimelineItem[] = noteRows.map((row) => {
    const viewModel = formatTimelineNoteViewModel(row);
    return {
      kind: "note" as const,
      id: viewModel.id,
      createdAt: viewModel.createdAt,
      body: viewModel.body,
      authorId: viewModel.authorId,
      authorName: viewModel.authorName,
      isEdited: viewModel.isEdited,
      editedAt: viewModel.editedAt,
      permissions: resolveTimelineNotePermissions(viewModel, actor),
    };
  });

  const merged = [...activityItems, ...noteItems].sort(compareTimelineItems).slice(0, TIMELINE_MERGE_LIMIT);

  return { ok: true, items: merged };
}
