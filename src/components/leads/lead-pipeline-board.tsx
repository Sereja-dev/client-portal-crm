import Link from "next/link";
import type { LeadStage } from "@/generated/prisma/enums";
import type { PipelineColumn } from "@/app/(dashboard)/leads/pipeline-query";
import { buildLeadsHref } from "@/app/(dashboard)/leads/view-params";
import { LeadPipelineCard } from "@/components/leads/lead-pipeline-card";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";

type PreservedParams = { q?: string; assignedToUserId?: string; archived?: string; sort?: string };

/**
 * Leads / Sales Pipeline Phase 4 — the Pipeline board itself. Two
 * complete renders behind one CSS breakpoint (`md`, not this app's usual
 * `xl` list-table breakpoint — a Kanban board's own per-column minimum
 * width needs far less horizontal room than the 6-column Leads *table*
 * that `xl` was originally tuned for; see record-list.tsx's own header
 * comment for that unrelated precedent): a horizontally-scrollable
 * multi-column board at `md` and up, and a single-stage-at-a-time
 * switcher below it — never drag-and-drop, and never six illegibly
 * narrow columns crammed into a 390px screen.
 *
 * Every column comes pre-fetched, bounded, and exactly-counted from
 * pipeline-query.ts — this component only renders what it's given, never
 * re-queries or re-filters.
 */
export function LeadPipelineBoard({
  columns,
  stageView,
  preservedParams,
}: {
  columns: PipelineColumn[];
  stageView: LeadStage;
  preservedParams: PreservedParams;
}) {
  return (
    <div className="mt-6">
      <div className="hidden md:block">
        <DesktopBoard columns={columns} preservedParams={preservedParams} />
      </div>
      <div className="md:hidden">
        <MobileStageSwitcher columns={columns} stageView={stageView} preservedParams={preservedParams} />
      </div>
    </div>
  );
}

/**
 * Only a SYSTEM column has a real `stage` (List view's own filter is
 * still LeadStage-keyed — Section H) — a genuinely custom column (not
 * reachable in Production yet, Section G) simply gets no truncation link
 * rather than a broken one.
 */
function truncationHref(stage: LeadStage | null, preservedParams: PreservedParams): string | null {
  return stage ? buildLeadsHref({ view: "list", stage, ...preservedParams }) : null;
}

function ColumnCards({ column, preservedParams }: { column: PipelineColumn; preservedParams: PreservedParams }) {
  if (column.leads.length === 0) {
    return <p className="text-text-muted mt-3 text-sm">No leads</p>;
  }
  const href = truncationHref(column.stage, preservedParams);
  return (
    <>
      <ul className="mt-3 space-y-2">
        {column.leads.map((lead) => (
          <LeadPipelineCard key={lead.id} lead={lead} />
        ))}
      </ul>
      {column.truncated && (
        <p className="text-text-muted mt-3 text-xs">
          Showing {column.leads.length} of {column.total}.{" "}
          {href ? (
            <Link href={href} className={ACTION_LINK_CLASSES}>
              See all in List view
            </Link>
          ) : (
            "See List view for the rest."
          )}
        </p>
      )}
    </>
  );
}

function DesktopBoard({
  columns,
  preservedParams,
}: {
  columns: PipelineColumn[];
  preservedParams: PreservedParams;
}) {
  return (
    <div className="flex items-start gap-4 overflow-x-auto pb-2">
      {columns.map((column) => {
        const headingId = `pipeline-column-${column.definitionId}`;
        return (
          <section
            key={column.definitionId}
            aria-labelledby={headingId}
            className="border-border-default bg-surface-recessed w-72 min-w-0 shrink-0 rounded-lg border p-3"
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
            <ColumnCards column={column} preservedParams={preservedParams} />
          </section>
        );
      })}
    </div>
  );
}

function MobileStageSwitcher({
  columns,
  stageView,
  preservedParams,
}: {
  columns: PipelineColumn[];
  stageView: LeadStage;
  preservedParams: PreservedParams;
}) {
  const activeColumn = columns.find((c) => c.stage === stageView) ?? columns[0];

  // Section G/H — `stageView` (like `?stage=` in List view) stays a
  // LeadStage-keyed URL param for full backward compatibility; a
  // genuinely custom column (null `stage`, unreachable in Production
  // today) simply has no deep-linkable URL of its own yet — Phase 2B's
  // own assignment UI is where that URL scheme gets redesigned around a
  // stable definition id instead.

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
              href={buildLeadsHref({ view: "pipeline", stageView: column.stage ?? undefined, ...preservedParams })}
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
        <ColumnCards column={activeColumn} preservedParams={preservedParams} />
      </section>
    </div>
  );
}
