import { EmptyState } from "@/components/ui/empty-state";
import { NoteComposer } from "./note-composer";
import { TimelineList } from "./timeline-list";
import { getTimelineForEntity } from "@/lib/timeline/timeline";
import type { TimelineNoteEntityType } from "@/generated/prisma/enums";
import type { TimelineNoteActor } from "@/lib/timeline/notes";
import type { TimelineNoteActionState } from "@/types";

/**
 * Communication Timeline Phase 2 — entity-agnostic Timeline UI, mirroring
 * AttachmentsSection's/CommentsSection's own `entityType`/`entityId`/
 * `organizationId` parameterization exactly, so both the Client and Lead
 * edit pages reuse this one component unchanged (see this feature's own
 * thin per-entity wrappers, ClientTimelineSection/LeadTimelineSection).
 *
 * Server Component, server-rendered on first paint (getTimelineForEntity
 * runs here) — no client-side fetch after hydration, no polling, no
 * realtime, consistent with every other read-model in this app. No
 * "Load more" in this phase — see getTimelineForEntity's own doc comment
 * for why a simple bounded merge was chosen over a real cross-table
 * keyset-pagination protocol.
 *
 * A brand-new Client/Lead already has its own CREATED Activity row by the
 * time this section ever renders, so the empty state below is mostly
 * defensive (a genuinely history-less entity is not the expected case,
 * just a safe one).
 */
export async function TimelineSection({
  entityType,
  entityId,
  organizationId,
  actor,
  createAction,
  makeEditAction,
  makeDeleteAction,
}: {
  entityType: TimelineNoteEntityType;
  entityId: string;
  organizationId: string;
  actor: TimelineNoteActor;
  createAction: (prevState: TimelineNoteActionState, formData: FormData) => Promise<TimelineNoteActionState>;
  makeEditAction: (noteId: string) => (prevState: TimelineNoteActionState, formData: FormData) => Promise<TimelineNoteActionState>;
  makeDeleteAction: (noteId: string) => () => Promise<void>;
}) {
  const result = await getTimelineForEntity(organizationId, entityType, entityId, actor);
  // ENTITY_NOT_FOUND is structurally unreachable here in practice — every
  // caller of this section already independently verified id+organizationId
  // moments earlier (matching every other entity edit page in this app,
  // e.g. EditClientPage/EditLeadPage's own notFound() guard) — but fails
  // safe (an empty timeline) rather than throwing, the same discipline
  // formatActivity's own malformed-metadata fallback already follows.
  const items = result.ok ? result.items : [];

  return (
    <div className="border-border-default mt-8 border-t pt-6">
      <h2 className="text-text-primary text-lg font-semibold">Timeline</h2>
      <p className="text-text-secondary mt-1 text-sm">Activity and staff notes</p>

      <div className="mt-4">
        <NoteComposer action={createAction} />
      </div>

      <div className="mt-4">
        {items.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            description="Activity and staff notes for this record will appear here."
          />
        ) : (
          <TimelineList items={items} makeEditAction={makeEditAction} makeDeleteAction={makeDeleteAction} />
        )}
      </div>
    </div>
  );
}
