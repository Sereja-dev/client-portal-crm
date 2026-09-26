import { prisma } from "@/lib/prisma";
import type { LeadStage } from "@/generated/prisma/enums";
import { listCustomStatusDefinitions } from "@/lib/custom-statuses/definitions";
import { getOrganizationTimezone } from "@/lib/calendar-events/queries";
import { buildLeadWhere, buildLeadOrderBy, type LeadListParams } from "./query";

/**
 * Leads / Sales Pipeline Phase 4, migrated by Custom Statuses Phase 2A
 * (Section G) — the Pipeline (Kanban) view's own query layer. Deliberately
 * NOT the paginated list query reused blindly: a single PAGE_SIZE=10 page
 * would make the board silently show only the first page of whichever
 * stage happens to sort first, which is exactly the "board lies about
 * completeness" failure this module exists to avoid. Every column instead
 * gets its own bounded, exact-counted query.
 *
 * Custom Statuses Phase 2A: columns are now defined by this organization's
 * own active LEAD CustomStatusDefinitions (ordered by `position`), not the
 * hardcoded LEAD_STAGES array — today that produces byte-identical output
 * (every organization's only LEAD definitions are its 6 backfilled system
 * ones, in the same order LEAD_STAGES always used), but a future custom
 * Lead status (Phase 2B+) will appear as its own column automatically,
 * with zero further code change here. Grouping/counting is by
 * statusDefinitionId, falling back to the legacy `stage` enum only for a
 * Lead whose statusDefinitionId is still null (Section D — a historical/
 * unbackfilled row; every real Production Lead is fully backfilled).
 * Archived definitions that still have Leads assigned to them (impossible
 * in Production today, since no assignment UI exists yet, but
 * architecturally required — Section G) get their own column too, appended
 * after the active ones, so no Lead ever silently disappears because its
 * own status definition was archived.
 */

// A generous, documented cap on how many cards render per column. Chosen
// so a normal-sized pipeline (even a very active one) always renders in
// full, while still bounding worst-case query/render cost for an
// unusually large single stage. Never silently pretended to be
// exhaustive: PipelineColumn.truncated is exact (computed from the real
// groupBy count below, not from whether the bound happened to be hit),
// and the board's own UI surfaces a "showing N of TOTAL" notice whenever
// a column is truncated, pointing at List view (which has proper
// pagination) to see the rest.
export const PIPELINE_STAGE_CARD_BOUND = 50;

/**
 * Production Observability Correction (Leads Pipeline P2028 remediation) —
 * the per-column card fetch below used to run as one
 * `prisma.$transaction([...])` batch, wrapping all `columns.length`
 * independent `lead.findMany` reads in a single interactive transaction
 * with Prisma's default 5000ms timeout. On Production (Vercel `iad1` ->
 * Supabase pooler), a real 10-column org's own 10 sequential round trips
 * inside that one transaction measurably exceeded 5000ms (confirmed via
 * bounded historical Vercel runtime-log retrieval: P2028, "5000 ms ...
 * however 6072 ms passed"), crashing the whole Pipeline RSC render.
 *
 * The transaction never bought any real consistency here — the two
 * groupBy count queries above already run outside it via Promise.all, and
 * Postgres's own default READ COMMITTED isolation (never elevated by this
 * code) gives each statement inside a transaction its own fresh snapshot
 * anyway, not one shared snapshot across statements. Its only actual
 * purpose (per this function's own original header comment) was bounding
 * the fan-out to exactly `columns.length` queries, never an N+1 — a
 * property `runWithBoundedConcurrency` below preserves identically,
 * without the artificial shared transaction lifetime, and without
 * unbounded fan-out as an organization's own custom Lead statuses grow
 * (Production's own pg.Pool default max is 10 connections; this cap
 * leaves headroom rather than sizing exactly to the pool).
 */
export const PIPELINE_COLUMN_QUERY_CONCURRENCY = 5;

/**
 * Runs `count` independent async operations, never more than
 * `concurrency` of them in flight at once, preserving input order in the
 * returned array. A small worker-pool: each of up to `concurrency`
 * workers repeatedly claims the next unclaimed index (via a shared
 * counter) and runs `worker(index)` until every index is claimed.
 *
 * Failure semantics deliberately mirror `Promise.all`'s own contract
 * (reject the whole operation on the first failure, don't swallow or
 * replace the error) plus one addition: once a failure is observed, no
 * *new* work is claimed (already-in-flight calls still run to
 * completion, same as Promise.all never cancels outstanding promises —
 * their results are simply never used). Never retries a failed call.
 */
export async function runWithBoundedConcurrency<T>(
  count: number,
  concurrency: number,
  worker: (index: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = new Array(count);
  let nextIndex = 0;
  let failed = false;
  let firstError: unknown;

  async function runOneWorker(): Promise<void> {
    for (;;) {
      if (failed) return;
      const index = nextIndex;
      nextIndex += 1;
      if (index >= count) return;
      try {
        results[index] = await worker(index);
      } catch (err) {
        if (!failed) {
          failed = true;
          firstError = err;
        }
        return;
      }
    }
  }

  const workerCount = Math.min(concurrency, count);
  await Promise.all(Array.from({ length: workerCount }, () => runOneWorker()));

  if (failed) throw firstError;
  return results;
}

/**
 * Leads Pipeline V1 (Section 13) — Next Action's own display string,
 * pre-formatted server-side with the organization's real timezone,
 * mirroring formatTimeInTimezone's own exact technique (an explicit
 * `timeZone` option passed straight to the platform Intl API, never
 * manual wall-clock arithmetic). Unlike Dashboard's own
 * TodayCalendarEvent.displayTime (scoped to today, so a bare time is
 * enough), Next Action can be several days out, so the date is always
 * included too.
 */
function formatNextActionDisplayTime(startsAt: Date, allDay: boolean, timeZone: string): string {
  if (allDay) {
    return startsAt.toLocaleDateString(undefined, { timeZone, month: "short", day: "numeric" });
  }
  return startsAt.toLocaleString(undefined, { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export type PipelineLead = {
  id: string;
  name: string;
  company: string | null;
  source: string | null;
  /** Stringified Decimal — Prisma's Decimal type can't cross the Server -> Client boundary as a prop. */
  value: string | null;
  stage: LeadStage;
  /**
   * Custom Statuses Phase 2B (Section M) — `id`/`key`/`isSystem` added
   * alongside the pre-existing `label`/`color` so LeadPipelineCard can
   * build its own "current" status option locally (mergeCurrentStatusOption)
   * with zero extra per-row database access (Section AB).
   */
  statusDefinition: {
    id: string;
    key: string;
    label: string;
    color: import("@/generated/prisma/enums").CustomStatusColor | null;
    isSystem: boolean;
  } | null;
  convertedClientId: string | null;
  assignedTo: { id: string; name: string } | null;
  createdAt: Date;
  /**
   * Leads Pipeline V1 (Section 13/14) — the nearest upcoming, non-archived
   * CalendarEvent linked to this Lead via CalendarEvent.leadId, or null
   * when none exists. Deliberately never a persisted Lead field and
   * never derived from Task (Task.projectId is required — a Lead has no
   * Project until it converts, so a Lead-linked Task is structurally
   * impossible; see the read-only audit's own §P evidence). `displayTime`
   * is pre-formatted server-side, organization-timezone-resolved, the
   * same "compute display-ready data server-side" convention Dashboard's
   * own TodayCalendarEvent.displayTime already established — never a raw
   * instant + timezone string threaded down into the Client Component.
   */
  nextAction: { title: string; displayTime: string } | null;
};

export type PipelineColumn = {
  definitionId: string;
  key: string;
  label: string;
  /**
   * The matching legacy LeadStage for a SYSTEM column — used only for
   * the "See all in List view" truncation link and the mobile switcher's
   * own URL-driven `stageView` matching (both are LeadStage-keyed URL
   * params, kept unchanged for full backward compatibility — Section H:
   * "avoid breaking existing URLs... do not overcomplicate"). Null for a
   * genuinely custom column — architecturally possible, but unreachable
   * in Production today, since no assignment UI exists yet (Section G).
   */
  stage: LeadStage | null;
  archived: boolean;
  /** The real, exact count for this column under the current filters — never bounded, unlike `leads`. */
  total: number;
  leads: PipelineLead[];
  /** True when `leads.length < total` — this column's own cards were capped at PIPELINE_STAGE_CARD_BOUND. */
  truncated: boolean;
};

/**
 * Fetches every column in one bounded, org-scoped pass.
 *
 * `stage` is deliberately excluded from `listParams` here (see
 * leads/page.tsx's own "the stage filter is hidden in Pipeline view"
 * decision) — every visible column is always shown; a stray `stage` query
 * param left over from List view can never collapse the board down to one
 * column.
 *
 * Three real queries, run concurrently where possible: two `groupBy`s for
 * the exact per-column totals (cheap, no bound, always correct even when
 * a column's own cards are truncated — one keyed by statusDefinitionId,
 * one keyed by the legacy `stage` for the Section D fallback rows), and
 * one `runWithBoundedConcurrency` batch of bounded `findMany` calls — a
 * fixed, bounded fan-out of exactly `columns.length` queries regardless
 * of how many Leads exist, never an N+1 (Section S), and never more than
 * `PIPELINE_COLUMN_QUERY_CONCURRENCY` of them in flight at once (P2028
 * remediation — see that constant's own comment for why this replaced an
 * earlier `prisma.$transaction([...])` batch of the same queries).
 */
export async function fetchLeadPipelineColumns(
  organizationId: string,
  listParams: Pick<LeadListParams, "q" | "assignedToUserId" | "archived" | "sortField" | "sortDir">,
): Promise<PipelineColumn[]> {
  const baseWhere = await buildLeadWhere(organizationId, { ...listParams, stage: undefined });
  const orderBy = buildLeadOrderBy(listParams);

  const allDefinitions = await listCustomStatusDefinitions(organizationId, "LEAD", { includeArchived: true });
  const activeDefinitions = allDefinitions.filter((d) => d.archivedAt === null);
  const archivedDefinitions = allDefinitions.filter((d) => d.archivedAt !== null);

  const [definitionCounts, legacyFallbackCounts] = await Promise.all([
    prisma.lead.groupBy({
      by: ["statusDefinitionId"],
      where: { ...baseWhere, statusDefinitionId: { not: null } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["stage"],
      where: { ...baseWhere, statusDefinitionId: null },
      _count: { _all: true },
    }),
  ]);

  const totalByDefinitionId = new Map<string, number>(
    definitionCounts.map((c) => [c.statusDefinitionId as string, c._count._all]),
  );
  // Section D fallback: a Lead with no statusDefinitionId is bucketed
  // into the SYSTEM definition matching its own legacy `stage` — every
  // system definition's own key is exactly that stage lowercased (see
  // constants.ts), so no separate mapping table is needed.
  for (const row of legacyFallbackCounts) {
    const match = allDefinitions.find((d) => d.isSystem && d.key === row.stage.toLowerCase());
    if (match) {
      totalByDefinitionId.set(match.id, (totalByDefinitionId.get(match.id) ?? 0) + row._count._all);
    }
    // else: unreachable for any real organization (every LeadStage has a
    // matching system definition, bootstrapped/backfilled for every
    // organization) — if it somehow happened, that count is simply not
    // shown as its own column rather than silently misattributed to a
    // wrong one.
  }

  const columns = [
    ...activeDefinitions,
    // Archived definitions only ever get a column when a Lead is
    // currently using one (Section G) — an archived definition nobody
    // references is simply omitted, exactly like it already is from
    // every ordinary "active definitions" list elsewhere in this app.
    ...archivedDefinitions.filter((d) => (totalByDefinitionId.get(d.id) ?? 0) > 0),
  ];

  const perColumnLeads = await runWithBoundedConcurrency(columns.length, PIPELINE_COLUMN_QUERY_CONCURRENCY, (i) => {
    const def = columns[i];
    return prisma.lead.findMany({
      // AND, not a spread-`OR` — baseWhere may already carry its own
      // top-level `OR` (the `q` search filter's own OR-of-fields), and
      // spreading `{ ...baseWhere, OR: [...] }` would silently
      // overwrite that key instead of combining with it (found by this
      // module's own pre-existing test suite: a `q` search that
      // matched nothing was returning every Lead in the column,
      // because the definition-matching OR replaced the search OR
      // entirely). AND: [baseWhere, {...}] composes both correctly.
      where: {
        AND: [
          baseWhere,
          {
            OR: [
              { statusDefinitionId: def.id },
              // Fold the Section D fallback rows into their own system
              // column's own bounded fetch too — a null-statusDefinitionId
              // Lead must appear in the one column its legacy stage maps
              // to, exactly like the count above already does.
              ...(def.isSystem ? [{ statusDefinitionId: null, stage: def.key.toUpperCase() as LeadStage }] : []),
            ],
          },
        ],
      },
      orderBy,
      take: PIPELINE_STAGE_CARD_BOUND,
      include: {
        assignedTo: { select: { id: true, name: true } },
        statusDefinition: { select: { id: true, key: true, label: true, color: true, isSystem: true } },
      },
    });
  });

  // Leads Pipeline V1 (Section 13/14) — Next Action. One bounded, batched
  // query scoped to exactly the Lead ids actually rendered above (never
  // every Lead this organization has, never a per-card query) — the
  // nearest upcoming, non-archived CalendarEvent per Lead, or none.
  // `leadId: { in: renderedLeadIds }` + the org scope together make this
  // safe even though CalendarEvent has no direct organizationId filter
  // applied redundantly here: every id in renderedLeadIds already came
  // from this same organization's own Lead rows above, so a
  // cross-tenant CalendarEvent can never match (its own leadId would
  // have to equal one of THIS org's Lead ids, which Postgres's own
  // foreign-key-backed uniqueness makes impossible for a different
  // organization's Lead to share).
  const renderedLeadIds = perColumnLeads.flat().map((lead) => lead.id);
  const now = new Date();
  const upcomingEvents =
    renderedLeadIds.length > 0
      ? await prisma.calendarEvent.findMany({
          where: { leadId: { in: renderedLeadIds }, archivedAt: null, startsAt: { gte: now } },
          orderBy: { startsAt: "asc" },
          select: { leadId: true, title: true, startsAt: true, allDay: true },
        })
      : [];
  const organizationTimezone = upcomingEvents.length > 0 ? await getOrganizationTimezone(organizationId) : "UTC";
  const nextActionByLeadId = new Map<string, { title: string; displayTime: string }>();
  for (const event of upcomingEvents) {
    // event.leadId is never null here (the WHERE clause above only ever
    // matches rows whose leadId is one of renderedLeadIds), and
    // orderBy startsAt asc + this "first write wins" guard together
    // keep only the NEAREST upcoming event per Lead — a later, farther
    // event for the same Lead is simply skipped.
    if (event.leadId && !nextActionByLeadId.has(event.leadId)) {
      nextActionByLeadId.set(event.leadId, {
        title: event.title,
        displayTime: formatNextActionDisplayTime(event.startsAt, event.allDay, organizationTimezone),
      });
    }
  }

  return columns.map((def, index) => {
    const leads = perColumnLeads[index];
    const total = totalByDefinitionId.get(def.id) ?? 0;
    return {
      definitionId: def.id,
      key: def.key,
      label: def.label,
      stage: def.isSystem ? (def.key.toUpperCase() as LeadStage) : null,
      archived: def.archivedAt !== null,
      total,
      truncated: total > leads.length,
      leads: leads.map((lead) => ({
        id: lead.id,
        name: lead.name,
        company: lead.company,
        source: lead.source,
        value: lead.value ? lead.value.toString() : null,
        stage: lead.stage,
        statusDefinition: lead.statusDefinition,
        convertedClientId: lead.convertedClientId,
        assignedTo: lead.assignedTo ? { id: lead.assignedTo.id, name: lead.assignedTo.name } : null,
        createdAt: lead.createdAt,
        nextAction: nextActionByLeadId.get(lead.id) ?? null,
      })),
    };
  });
}
