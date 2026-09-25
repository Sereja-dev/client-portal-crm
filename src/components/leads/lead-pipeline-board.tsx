"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { PipelineColumn, PipelineLead } from "@/app/(dashboard)/leads/pipeline-query";
import { buildLeadsHref } from "@/app/(dashboard)/leads/view-params";
import { assignLeadStatusDefinitionAction, markLeadLostAction } from "@/app/(dashboard)/leads/actions";
import { isLostLeadStage } from "@/lib/leads/stages";
import type { StatusSelectOption } from "@/lib/custom-statuses/entity-form";
import { LeadPipelineCard, LeadPipelineCardPreview } from "@/components/leads/lead-pipeline-card";
import { MarkLeadLostDialog, type MarkLeadLostDialogHandle } from "@/components/leads/mark-lead-lost-dialog";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { useToast } from "@/components/toast/toast-provider";

type PreservedParams = { q?: string; assignedToUserId?: string; archived?: string; sort?: string };

// Same literal-string-duplication convention lead-pipeline-card.tsx's own
// identical constants already document (mirrors LeadActionsPanel too) —
// never imported from @/lib/rate-limit (that barrel also re-exports a
// server-only next/headers-using module).
const RATE_LIMIT_MESSAGE = "Too many requests. Please try again later.";
const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Leads / Sales Pipeline Phase 4, extended by Leads Pipeline V1 (Section
 * 5-12) with cross-stage drag & drop. Two complete renders behind one CSS
 * breakpoint (`md`, not this app's usual `xl` list-table breakpoint — a
 * Kanban board's own per-column minimum width needs far less horizontal
 * room than the 6-column Leads *table* that `xl` was originally tuned
 * for; see record-list.tsx's own header comment for that unrelated
 * precedent): a horizontally-scrollable multi-column board at `md` and
 * up, with real drag & drop enabled, and a single-stage-at-a-time
 * switcher below it, where DnD is never enabled — narrow screens have no
 * multi-column target to drop onto, and forcing a touch-drag interaction
 * model there would only make the board harder to use, not easier
 * (Section 12).
 *
 * Every column comes pre-fetched, bounded, and exactly-counted from
 * pipeline-query.ts — this component only renders what it's given, never
 * re-queries or re-filters. Drag & drop is layered on top of, never a
 * replacement for, the existing accessible stage `<select>` every card
 * still renders unchanged — that select remains the complete, fully
 * functional fallback for keyboard/touch/assistive-technology users, and
 * for anyone who simply prefers it (Section 7).
 *
 * One shared DndContext wraps BOTH the desktop and mobile trees (a
 * single provider, not two) so LeadPipelineCard's own useDraggable() call
 * — made unconditionally, per React's Rules of Hooks — always has a real
 * context ancestor; `dndEnabled` (true only for DesktopBoard's own
 * cards) is what actually turns dragging on or off, via useDraggable's
 * own first-class `disabled` option, never a second invented gate.
 *
 * A real DragOverlay (dnd-kit's own documented pattern for exactly this
 * situation), not a bare CSS transform on the card's own list slot: the
 * board's row is `overflow-x-auto`, and DndContext's default autoScroll
 * scrolls it whenever the pointer nears its edge — an in-place transform
 * on the still-in-flow card would grow, and a growing transform on a
 * descendant of an `overflow: auto` ancestor enlarges that ancestor's own
 * scrollable content bounds, which gives autoscroll still more room to
 * scroll into, growing the transform further: a genuine runaway
 * feedback loop, confirmed directly (a real drag toward a far column
 * never settled — the row's own scrollWidth kept growing every frame).
 * DragOverlay renders the moving copy in a portal outside the scrollable
 * row entirely, so its position never feeds back into that row's own
 * layout; the real card stays in its own column's flow the whole drag,
 * only dimmed (LeadPipelineCard's own isDragging opacity), never
 * translated.
 */
export function LeadPipelineBoard({
  columns,
  stageView,
  preservedParams,
  statusOptions,
  currency,
}: {
  columns: PipelineColumn[];
  /** A LeadStage value OR a raw CustomStatusDefinition id — see view-params.ts's own parseLeadStageView comment. */
  stageView: string;
  preservedParams: PreservedParams;
  /** Custom Statuses Phase 2B (Section AB) — fetched once by leads/page.tsx, threaded down to every card unchanged. */
  statusOptions: StatusSelectOption[];
  /**
   * Lead Value Currency Correctness fix — the org's one resolved
   * currency (resolveReportsCurrency, src/lib/reports/currency.ts),
   * resolved exactly once by leads/page.tsx and threaded down as a
   * plain serializable prop, never re-resolved here or inside any card.
   * `null` only when no currency can be resolved at all — every card
   * renders "—" for its own value in that case, never an invented USD.
   */
  currency: string | null;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [, startTransition] = useTransition();
  const [lostTarget, setLostTarget] = useState<{ id: string; name: string } | null>(null);
  const [activeLead, setActiveLead] = useState<PipelineLead | null>(null);
  const lostDialogRef = useRef<MarkLeadLostDialogHandle>(null);

  function handleDragStart(event: DragStartEvent): void {
    const leadId = String(event.active.id);
    const lead = columns.flatMap((column) => column.leads).find((l) => l.id === leadId);
    setActiveLead(lead ?? null);
  }

  // A distance-based activation constraint — a plain click on the card's
  // own Link/Select/Button (no pointer movement) never starts a drag, so
  // those existing, already-tested controls keep working unchanged; only
  // an actual drag gesture (pointer moves >8px while held) activates
  // dnd-kit's sensor. KeyboardSensor is dnd-kit's own built-in
  // accessibility primitive (Space to pick up, arrow keys to move
  // between droppable targets, Space to drop, Escape to cancel) — reused
  // as-is, never a second hand-rolled keyboard state machine (Section 7:
  // the native <select> remains the real, complete fallback regardless).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  function requestMarkLost(id: string, name: string): void {
    setLostTarget({ id, name });
    lostDialogRef.current?.open();
  }

  function handleLostConfirm(lostReason: string): void {
    const target = lostTarget;
    if (!target) return;
    startTransition(async () => {
      const result = await markLeadLostAction(target.id, lostReason || undefined);
      if (result.ok) {
        showToast("Lead marked lost");
        router.refresh();
      } else if (result.reason === "converted_locked") {
        showToast("This lead has already converted and can't be marked lost.", "error");
        router.refresh();
      } else if (result.reason === "rate_limited") {
        showToast(RATE_LIMIT_MESSAGE, "error");
      } else {
        showToast("Couldn't mark this lead lost. Check the reason and try again.", "error");
      }
      setLostTarget(null);
    });
  }

  // Section 9/10/11 — the one drop handler. Same-stage drop and an
  // unrecognized/empty drop target are both plain no-ops (the card
  // already visually snaps back to its own column the instant the drag
  // ends, since no local/optimistic state is ever mutated here — the
  // board only ever re-renders once the server actually confirms a
  // change via router.refresh(), so a failed or no-op drop can never
  // leave a card visually stranded in the wrong column). A drop onto the
  // system LOST column never mutates anything directly — it only opens
  // the existing lost-reason dialog (Section 10); every other target
  // goes straight through assignLeadStatusDefinitionAction, the exact
  // same canonical mutation the card's own <select> already calls
  // (Section 9) — never a raw Prisma write, never forked mutation
  // semantics, so tenant isolation/converted guards/Activity/lostReason
  // clearing/workflow dispatch/concurrency handling are all inherited
  // for free (Section 27).
  function handleDragEnd(event: DragEndEvent): void {
    setActiveLead(null);
    const { active, over } = event;
    if (!over) return;

    const leadId = String(active.id);
    const data = active.data.current as { sourceDefinitionId?: string; name?: string } | undefined;
    const sourceDefinitionId = data?.sourceDefinitionId;
    const targetDefinitionId = String(over.id);

    if (!sourceDefinitionId || sourceDefinitionId === targetDefinitionId) {
      return;
    }

    const targetColumn = columns.find((column) => column.definitionId === targetDefinitionId);
    if (!targetColumn) {
      return;
    }

    if (targetColumn.stage !== null && isLostLeadStage(targetColumn.stage)) {
      requestMarkLost(leadId, data?.name ?? "this lead");
      return;
    }

    startTransition(async () => {
      const result = await assignLeadStatusDefinitionAction(leadId, targetDefinitionId);
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

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveLead(null)}
    >
      <div className="mt-6">
        <div className="hidden md:block">
          <DesktopBoard columns={columns} preservedParams={preservedParams} statusOptions={statusOptions} currency={currency} />
        </div>
        <div className="md:hidden">
          <MobileStageSwitcher
            columns={columns}
            stageView={stageView}
            preservedParams={preservedParams}
            statusOptions={statusOptions}
            currency={currency}
          />
        </div>
      </div>
      <MarkLeadLostDialog ref={lostDialogRef} onConfirm={handleLostConfirm} />
      <DragOverlay>{activeLead && <LeadPipelineCardPreview lead={activeLead} currency={currency} />}</DragOverlay>
    </DndContext>
  );
}

/**
 * List view's own `?stage=` filter accepts either a legacy LeadStage
 * value or a live CustomStatusDefinition's own stable `key` (Section P) —
 * a SYSTEM column's `stage` is preferred (the exact pre-existing URL
 * shape), a genuinely custom column falls back to its own `key`, so
 * every column, system or custom, always gets a real truncation link.
 */
function truncationHref(column: Pick<PipelineColumn, "stage" | "key">, preservedParams: PreservedParams): string {
  return buildLeadsHref({ view: "list", stage: column.stage ?? column.key, ...preservedParams });
}

function ColumnCards({
  column,
  preservedParams,
  statusOptions,
  currency,
  dndEnabled = false,
}: {
  column: PipelineColumn;
  preservedParams: PreservedParams;
  statusOptions: StatusSelectOption[];
  currency: string | null;
  dndEnabled?: boolean;
}) {
  if (column.leads.length === 0) {
    return <p className="text-text-muted mt-3 text-sm">No leads</p>;
  }
  return (
    <>
      <ul className="mt-3 space-y-2">
        {column.leads.map((lead) => (
          <LeadPipelineCard
            key={lead.id}
            lead={lead}
            statusOptions={statusOptions}
            currency={currency}
            dndEnabled={dndEnabled}
            sourceDefinitionId={column.definitionId}
          />
        ))}
      </ul>
      {column.truncated && (
        <p className="text-text-muted mt-3 text-xs">
          Showing {column.leads.length} of {column.total}.{" "}
          <Link href={truncationHref(column, preservedParams)} className={ACTION_LINK_CLASSES}>
            See all in List view
          </Link>
        </p>
      )}
    </>
  );
}

function DesktopBoard({
  columns,
  preservedParams,
  statusOptions,
  currency,
}: {
  columns: PipelineColumn[];
  preservedParams: PreservedParams;
  statusOptions: StatusSelectOption[];
  currency: string | null;
}) {
  return (
    <div className="flex items-start gap-4 overflow-x-auto pb-2">
      {columns.map((column) => (
        <DroppableColumn
          key={column.definitionId}
          column={column}
          preservedParams={preservedParams}
          statusOptions={statusOptions}
          currency={currency}
        />
      ))}
    </div>
  );
}

/**
 * One droppable stage column (desktop only — Section 12). useDroppable's
 * own `id` is this column's `definitionId`, the exact same id
 * assignLeadStatusDefinitionAction already expects — handleDragEnd above
 * reads `over.id` straight through with no translation step.
 */
function DroppableColumn({
  column,
  preservedParams,
  statusOptions,
  currency,
}: {
  column: PipelineColumn;
  preservedParams: PreservedParams;
  statusOptions: StatusSelectOption[];
  currency: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.definitionId });
  const headingId = `pipeline-column-${column.definitionId}`;

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={`border-border-default bg-surface-recessed w-72 min-w-0 shrink-0 rounded-lg border p-3 transition-colors ${
        isOver ? "ring-accent ring-2" : ""
      }`}
    >
      <h2 id={headingId} className="text-text-primary flex items-center justify-between text-sm font-semibold">
        <span className="min-w-0 truncate">
          {column.label}
          {/* Section Q — an archived status definition only ever
              gets its own column when a Lead still uses it; marked
              subtly, never hidden (no Lead disappears). */}
          {column.archived && <span className="text-text-muted ml-1.5 font-normal">(archived)</span>}
        </span>
        <span className="text-text-muted shrink-0 font-normal">{column.total}</span>
      </h2>
      <ColumnCards column={column} preservedParams={preservedParams} statusOptions={statusOptions} currency={currency} dndEnabled />
    </section>
  );
}

function MobileStageSwitcher({
  columns,
  stageView,
  preservedParams,
  statusOptions,
  currency,
}: {
  columns: PipelineColumn[];
  stageView: string;
  preservedParams: PreservedParams;
  statusOptions: StatusSelectOption[];
  currency: string | null;
}) {
  // Leads Pipeline V1 (Section 4) — genuinely reachable now that Pipeline
  // is the default view rather than an explicit opt-in: an organization
  // with zero LEAD CustomStatusDefinition rows (never bootstrapped —
  // page.tsx's own EmptyState only covers "no Leads AND no active
  // filters", not "no columns at all") combined with an active filter
  // still reaches this component with `columns` genuinely empty.
  // `columns[0]` would be `undefined` in that case — this guard avoids
  // the resulting crash, matching ColumnCards's own identical "No
  // leads" empty-column copy for the equivalent single-column case.
  if (columns.length === 0) {
    return <p className="text-text-muted text-sm">No leads</p>;
  }

  // Custom Statuses Phase 2B — Completion Pass (Section G/H): matches
  // EITHER a legacy LeadStage value (`?stageView=NEW`, still fully
  // backward-compatible) OR a raw CustomStatusDefinition id (a
  // genuinely custom column's own `stage` is always null, so it can
  // only ever be reached this second way) — see view-params.ts's own
  // parseLeadStageView comment.
  const activeColumn = columns.find((c) => c.stage === stageView || c.definitionId === stageView) ?? columns[0];

  return (
    <div>
      {/*
        A plain aria-current nav, not role="tab"/"tablist": each control
        is a real <Link> that navigates to a new server-rendered page
        (stageView is URL-driven, per this phase's own requirement), not
        a JS panel-switcher — the ARIA Tabs pattern assumes the latter
        (roving tabindex, arrow-key navigation, an aria-controls-linked
        tabpanel), so applying role="tab" to a genuine navigation link
        would misdescribe it. Mirrors the List/Pipeline ViewToggle's own
        aria-current convention exactly, just with more than two options.
      */}
      <nav aria-label="Pipeline stage" className="flex gap-2 overflow-x-auto pb-2">
        {columns.map((column) => {
          const isActive = column.definitionId === activeColumn.definitionId;
          return (
            <Link
              key={column.definitionId}
              href={buildLeadsHref({ view: "pipeline", stageView: column.stage ?? column.definitionId, ...preservedParams })}
              aria-current={isActive ? "page" : undefined}
              className={`focus-visible:ring-focus-ring shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                isActive
                  ? "border-accent bg-accent text-white"
                  : "border-border-strong bg-surface text-text-secondary hover:bg-[var(--hover)]"
              }`}
            >
              {column.label} <span className={isActive ? "text-white/80" : "text-text-muted"}>{column.total}</span>
            </Link>
          );
        })}
      </nav>

      <section aria-label={`${activeColumn.label} leads`} className="mt-2">
        {/* dndEnabled intentionally omitted (defaults false) — Section 12: mobile's single-stage switcher never enables drag. */}
        <ColumnCards column={activeColumn} preservedParams={preservedParams} statusOptions={statusOptions} currency={currency} />
      </section>
    </div>
  );
}
