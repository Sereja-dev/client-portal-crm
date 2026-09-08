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

function truncationHref(stage: LeadStage, preservedParams: PreservedParams): string {
  return buildLeadsHref({ view: "list", stage, ...preservedParams });
}

function ColumnCards({ column, preservedParams }: { column: PipelineColumn; preservedParams: PreservedParams }) {
  if (column.leads.length === 0) {
    return <p className="text-text-muted mt-3 text-sm">No leads</p>;
  }
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
          <Link href={truncationHref(column.stage, preservedParams)} className={ACTION_LINK_CLASSES}>
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
}: {
  columns: PipelineColumn[];
  preservedParams: PreservedParams;
}) {
  return (
    <div className="flex items-start gap-4 overflow-x-auto pb-2">
      {columns.map((column) => {
        const headingId = `pipeline-column-${column.stage}`;
        return (
          <section
            key={column.stage}
            aria-labelledby={headingId}
            className="border-border-default bg-surface-recessed w-72 min-w-0 shrink-0 rounded-lg border p-3"
          >
            <h2 id={headingId} className="text-text-primary flex items-center justify-between text-sm font-semibold">
              <span className="min-w-0 truncate">{column.label}</span>
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
          const isActive = column.stage === activeColumn.stage;
          return (
            <Link
              key={column.stage}
              href={buildLeadsHref({ view: "pipeline", stageView: column.stage, ...preservedParams })}
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
