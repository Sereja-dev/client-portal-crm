"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
import { assignLeadStatusDefinitionAction, markLeadLostAction } from "@/app/(dashboard)/leads/actions";
import type { PipelineLead } from "@/app/(dashboard)/leads/pipeline-query";
import { isLostLeadStage } from "@/lib/leads/stages";
import type { StatusSelectOption } from "@/lib/custom-statuses/select-options";
import { mergeCurrentStatusOption } from "@/lib/custom-statuses/select-options";
import { buildLeadStatusSelectOptions } from "@/components/leads/lead-status-options";
import { StatusBadge } from "@/components/ui/status-badge";
import { GripVerticalIcon } from "@/components/ui/icons";
import { MarkLeadLostDialog, type MarkLeadLostDialogHandle } from "@/components/leads/mark-lead-lost-dialog";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { formatStatusLabel } from "@/lib/format";
import { formatLeadValue } from "@/lib/leads/format-value";
import { useToast } from "@/components/toast/toast-provider";

// Not imported from @/lib/rate-limit here — same reasoning as
// LeadActionsPanel's own identical constant: that barrel also re-exports
// src/lib/rate-limit/ip.ts, which uses next/headers, a server-only API
// that must never end up in a Client Component's own bundle.
const RATE_LIMIT_MESSAGE = "Too many requests. Please try again later.";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * One Lead's card inside the Pipeline board (src/components/leads/
 * lead-pipeline-board.tsx). Deliberately reuses assignLeadStatusDefinitionAction /
 * markLeadLostAction / MarkLeadLostDialog directly — the exact same
 * calls LeadActionsPanel's own edit-page status controls already make,
 * no parallel business logic. Stage movement is always this explicit
 * "Move to" <select>, matching the edit page's own control for the same
 * reason (never offering a value the backend would reject; LOST has its
 * own dedicated Mark Lost flow — Section M) — this remains the complete,
 * fully-functional keyboard/touch fallback (Section 7) whether or not
 * DnD is even enabled for this render.
 *
 * Leads Pipeline V1 (Section 5/7/8) — drag & drop is layered on top of
 * that <select>, never a replacement: a real drag only mutates state
 * through this same select's own actions (LeadPipelineBoard's own
 * onDragEnd calls assignLeadStatusDefinitionAction/markLeadLostAction
 * directly — this component's own useDraggable wiring only reports drag
 * events upward, never performs a mutation itself). `dndEnabled` decides
 * whether dragging is offered at all here (false on the mobile
 * single-stage switcher — Section 12); a converted Lead is never
 * draggable regardless (Section 8).
 *
 * Custom Statuses Phase 2B (Section AB) — `statusOptions` is the shared,
 * active LEAD options list fetched ONCE per page load (leads/page.tsx),
 * never re-queried per card; this card only ever merges in its OWN
 * already-fetched `lead.statusDefinition` locally (mergeCurrentStatusOption),
 * with zero extra database access per row.
 */
export function LeadPipelineCard({
  lead,
  statusOptions,
  currency,
  dndEnabled = false,
  sourceDefinitionId,
}: {
  lead: PipelineLead;
  statusOptions: StatusSelectOption[];
  /**
   * Lead Value Currency Correctness fix — the org's one resolved
   * currency, resolved exactly once by leads/page.tsx and threaded down
   * through LeadPipelineBoard as a plain prop — never re-resolved here.
   * `null` only when no currency can be resolved at all, in which case
   * this card's own value (below) renders "—", never an invented USD.
   */
  currency: string | null;
  /**
   * Leads Pipeline V1 (Section 5/8/12) — true only for cards rendered
   * inside the desktop multi-column board (DesktopBoard), which sits
   * inside LeadPipelineBoard's own shared DndContext; false (the
   * default) for the mobile single-stage switcher, which renders this
   * exact same card component but never wants drag enabled (Section 12
   * — no forced desktop-style multi-column DnD onto a narrow screen).
   * useDraggable is still called unconditionally either way (React's own
   * Rules of Hooks) — `disabled` is what actually turns dragging off,
   * exactly dnd-kit's own supported mechanism, never a second invented
   * gate.
   */
  dndEnabled?: boolean;
  /** This card's own current column id — only meaningful when dndEnabled; carried in useDraggable's own `data` so LeadPipelineBoard's onDragEnd can detect a same-stage drop without a second lookup. */
  sourceDefinitionId?: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const lostDialogRef = useRef<MarkLeadLostDialogHandle>(null);

  const isConverted = lead.convertedClientId !== null;
  const isLost = isLostLeadStage(lead.stage);

  // Leads Pipeline V1 (Section 8) — a converted Lead is locked to WON
  // (every server action already rejects a stage change for one via its
  // own converted_locked guard); dragging one is never offered in the
  // first place, rather than letting the drag start and then failing
  // server-side.
  const draggable = dndEnabled && !isConverted;
  // useDraggable's `id` must be unique within the ONE shared DndContext
  // (LeadPipelineBoard's own header comment) — but this exact same
  // component, for this exact same Lead, is mounted TWICE simultaneously
  // whenever that Lead's stage is also the mobile switcher's own active
  // column: once in DesktopBoard (dndEnabled=true) and once inside
  // MobileStageSwitcher's `md:hidden` wrapper (dndEnabled=false), which is
  // real `display:none` at desktop viewport widths, not DOM-absent (the
  // same always-both-rendered pattern this app's own mobile/desktop split
  // uses everywhere). Two useDraggable calls sharing one `id` collide in
  // dnd-kit's internal node registry — whichever registers second wins,
  // and if that's the display:none mobile copy, its zero-size
  // getBoundingClientRect() becomes the ACTIVE rect for every drag,
  // permanently breaking collision detection against every column's own
  // useDroppable rect (confirmed directly: active.rect.current.initial
  // was `{top:0,left:0,width:0,height:0}` on every real drag attempt).
  // The mobile copy is always `disabled` and so can never itself become
  // an active drag — giving it a distinct, namespaced id costs nothing
  // and leaves the real (desktop) id exactly what handleDragEnd expects.
  // No `transform` read from useDraggable's own return, and so no
  // translate3d applied to this <li> — LeadPipelineBoard's own
  // <DragOverlay> (dnd-kit's documented pattern for exactly this board
  // shape) is what visually follows the pointer, in a portal outside the
  // horizontally-scrollable row; this card only ever dims in place while
  // dndEnabled, never moves. See that board component's own header
  // comment for the runaway-autoscroll feedback loop a translated
  // in-flow card produced before DragOverlay replaced it.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: dndEnabled ? lead.id : `mobile-${lead.id}`,
    data: { sourceDefinitionId, name: lead.name },
    disabled: !draggable,
  });

  // Section D fallback (unreachable in Production — every real Lead is
  // fully backfilled): an unbackfilled row has no statusDefinition at
  // all, so its current option is derived from the shared active list by
  // matching its own legacy `stage`, exactly like every other Phase 2A
  // fallback in this app.
  const currentOption: StatusSelectOption | null = lead.statusDefinition
    ? { ...lead.statusDefinition, isDefault: false, archived: false }
    : (statusOptions.find((o) => o.isSystem && o.key === lead.stage.toLowerCase()) ?? null);
  const mergedOptions = mergeCurrentStatusOption(statusOptions, currentOption);
  const selectableStatusOptions = buildLeadStatusSelectOptions(mergedOptions, currentOption?.id ?? null);

  function handleStatusChange(definitionId: string) {
    startTransition(async () => {
      const result = await assignLeadStatusDefinitionAction(lead.id, definitionId);
      if (result.ok) {
        showToast("Status updated");
        router.refresh();
        return;
      }
      switch (result.reason) {
        case "converted_locked":
          showToast("This lead has already converted — its stage is locked.", "error");
          break;
        case "rate_limited":
          showToast(RATE_LIMIT_MESSAGE, "error");
          break;
        case "use_mark_lost_action":
          showToast('Use "Mark lost" to mark this lead as lost.', "error");
          break;
        case "status_archived":
          showToast("This status is archived and can't be assigned.", "error");
          break;
        default:
          showToast(GENERIC_ERROR, "error");
      }
      router.refresh();
    });
  }

  function handleMarkLost(lostReason: string) {
    startTransition(async () => {
      const result = await markLeadLostAction(lead.id, lostReason || undefined);
      if (result.ok) {
        showToast("Lead marked lost");
        router.refresh();
        return;
      }
      if (result.reason === "converted_locked") {
        showToast("This lead has already converted and can't be marked lost.", "error");
        router.refresh();
      } else if (result.reason === "rate_limited") {
        showToast(RATE_LIMIT_MESSAGE, "error");
      } else {
        showToast("Couldn't mark this lead lost. Check the reason and try again.", "error");
      }
    });
  }

  return (
    <li
      ref={setNodeRef}
      className={`min-w-0 p-3 text-sm ${CARD_SURFACE_CLASSES} ${isDragging ? "opacity-50" : ""}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {/*
            Leads Pipeline V1 (Section 5/7/8) — a dedicated drag handle,
            not the whole card: dnd-kit's own `attributes` (role="button",
            tabIndex, keyboard handlers — its real supported
            accessibility primitive) are only ever applied to this one
            small, purely decorative-icon button, never to the outer
            <li>, which still contains its own genuinely separate
            interactive controls (the name link, the status <select>,
            the Mark lost button) — nesting those inside a second
            role="button" container would be an invalid, confusing
            nested-interactive-control structure. Only rendered when
            this card is actually draggable (Section 8: converted Leads
            and the mobile switcher never get one).

            setActivatorNodeRef is also load-bearing here, not just an
            accessibility nicety: dnd-kit's own "Drag Handle" pattern
            requires it whenever listeners/attributes are applied to a
            different node than setNodeRef — omitting it left the active
            draggable's own rect measurement (active.rect.current) at a
            permanent {top:0,left:0,width:0,height:0}, which meant
            collision detection against every useDroppable column never
            found an intersection and `over` was always undefined —
            confirmed directly via DndContext's own onDragMove event, not
            merely inferred from a failing test.
          */}
          {draggable && (
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={`Drag ${lead.name} to a different stage`}
              className="focus-visible:ring-focus-ring shrink-0 cursor-grab touch-none rounded p-0.5 text-text-muted hover:text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:cursor-grabbing"
            >
              <GripVerticalIcon className="h-4 w-4" />
            </button>
          )}
          <Link
            href={`/leads/${lead.id}/edit`}
            className={`min-w-0 truncate font-medium text-text-primary hover:underline focus-visible:ring-focus-ring rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2`}
            title={lead.name}
          >
            {lead.name}
          </Link>
        </div>
        {isConverted && <StatusBadge status="WON" label="Converted" />}
      </div>

      {lead.company && <p className="mt-0.5 min-w-0 truncate text-text-secondary">{lead.company}</p>}

      <dl className="mt-2 space-y-1 text-xs text-text-muted">
        {lead.value && (
          <div className="flex justify-between gap-2">
            <dt>Value</dt>
            <dd className="text-text-secondary">{formatLeadValue(lead.value, currency)}</dd>
          </div>
        )}
        {lead.source && (
          <div className="flex justify-between gap-2">
            <dt>Source</dt>
            <dd className="min-w-0 truncate text-text-secondary">{formatStatusLabel(lead.source)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt>Assignee</dt>
          <dd className="min-w-0 truncate text-text-secondary">{lead.assignedTo?.name ?? "Unassigned"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Next action</dt>
          {lead.nextAction ? (
            <dd className="min-w-0 truncate text-text-secondary" title={lead.nextAction.title}>
              {lead.nextAction.title} · {lead.nextAction.displayTime}
            </dd>
          ) : (
            <dd className="text-text-secondary">—</dd>
          )}
        </div>
      </dl>

      {isConverted ? (
        <p className="mt-3 text-xs text-text-muted">
          Converted to a{" "}
          {lead.convertedClientId ? (
            <Link href={`/clients/${lead.convertedClientId}/edit`} className={ACTION_LINK_CLASSES}>
              client
            </Link>
          ) : (
            "client"
          )}
          .
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select
            aria-label={`Change ${lead.name}'s status`}
            value={currentOption?.id ?? ""}
            disabled={isPending}
            onChange={(event) => handleStatusChange(event.target.value)}
            // flex-1/min-w-0 only — layout utilities, never a property
            // formControlClasses already sets itself (padding/text-size/
            // width), matching this app's own documented rule against
            // appending a same-property override class onto a shared
            // component (see button.tsx's own header comment for the real
            // production bug that rule exists to prevent).
            className="min-w-0 flex-1"
          >
            {selectableStatusOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
                {option.archived ? " (archived)" : ""}
              </option>
            ))}
          </Select>
          {!isLost && (
            <Button type="button" variant="dangerOutline" disabled={isPending} onClick={() => lostDialogRef.current?.open()}>
              Mark lost
            </Button>
          )}
        </div>
      )}

      <MarkLeadLostDialog ref={lostDialogRef} onConfirm={handleMarkLost} />
    </li>
  );
}

/**
 * The moving visual inside LeadPipelineBoard's own <DragOverlay> — a
 * read-only snapshot of the same card fields (Section 15: name/company/
 * value/source/assignee preserved), never interactive (no useDraggable,
 * no status <select>, no Mark lost button, no name Link): DragOverlay
 * content is a portal-rendered copy that exists only while a drag is in
 * flight, and the real, fully-functional card underneath it is what
 * every existing action and test still targets. Deliberately a plain
 * function, not exported from a shared "PipelineLead formatting" module
 * — the little overlap with LeadPipelineCard's own JSX (name/company/dl
 * rows) is the same intentional literal-duplication-over-abstraction
 * call this file's own header comment already documents for its rate-
 * limit/error constants, not an oversight.
 */
export function LeadPipelineCardPreview({ lead, currency }: { lead: PipelineLead; currency: string | null }) {
  return (
    <li className={`w-72 min-w-0 p-3 text-sm shadow-lg ${CARD_SURFACE_CLASSES}`}>
      <p className="min-w-0 truncate font-medium text-text-primary">{lead.name}</p>
      {lead.company && <p className="mt-0.5 min-w-0 truncate text-text-secondary">{lead.company}</p>}
      <dl className="mt-2 space-y-1 text-xs text-text-muted">
        {lead.value && (
          <div className="flex justify-between gap-2">
            <dt>Value</dt>
            <dd className="text-text-secondary">{formatLeadValue(lead.value, currency)}</dd>
          </div>
        )}
        {lead.source && (
          <div className="flex justify-between gap-2">
            <dt>Source</dt>
            <dd className="min-w-0 truncate text-text-secondary">{formatStatusLabel(lead.source)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt>Assignee</dt>
          <dd className="min-w-0 truncate text-text-secondary">{lead.assignedTo?.name ?? "Unassigned"}</dd>
        </div>
      </dl>
    </li>
  );
}
