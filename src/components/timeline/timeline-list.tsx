import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { TimelineActivityItem } from "./timeline-activity-item";
import { TimelineNoteItem } from "./timeline-note-item";
import type { TimelineItem } from "@/lib/timeline/timeline";
import type { TimelineNoteActionState } from "@/types";

/**
 * Communication Timeline Phase 2 — the merged, newest-first list. Each
 * row dispatches to TimelineActivityItem or TimelineNoteItem by its own
 * `kind` discriminant (see src/lib/timeline/timeline.ts's own TimelineItem
 * union) — no client state of its own beyond what each row already owns
 * (a note's own local "am I editing" toggle).
 */
export function TimelineList({
  items,
  makeEditAction,
  makeDeleteAction,
}: {
  items: TimelineItem[];
  makeEditAction: (noteId: string) => (prevState: TimelineNoteActionState, formData: FormData) => Promise<TimelineNoteActionState>;
  makeDeleteAction: (noteId: string) => () => Promise<void>;
}) {
  return (
    <ul className={`divide-border-subtle divide-y ${CARD_SURFACE_CLASSES}`}>
      {items.map((item) =>
        item.kind === "activity" ? (
          <TimelineActivityItem key={`activity-${item.id}`} display={item.display} />
        ) : (
          <TimelineNoteItem
            key={`note-${item.id}`}
            id={item.id}
            body={item.body}
            authorName={item.authorName}
            createdAt={item.createdAt}
            isEdited={item.isEdited}
            permissions={item.permissions}
            editAction={makeEditAction(item.id)}
            deleteAction={makeDeleteAction(item.id)}
          />
        ),
      )}
    </ul>
  );
}
