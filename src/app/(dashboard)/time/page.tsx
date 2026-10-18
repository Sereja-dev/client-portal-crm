import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { WorkTabs } from "@/components/work/work-tabs";
import { prisma } from "@/lib/prisma";
import { listTimeEntries } from "@/lib/time-entries/entries";
import { formatDurationMinutes } from "@/lib/time-entries/duration";
import { formatDateOnly, formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TimeEntryFilterBar } from "@/components/time-entries/time-entry-filter-bar";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import type { RawSearchParams } from "@/lib/list-params";
import {
  parseTimeEntryFromDateFilter,
  parseTimeEntryToDateFilter,
  parseTimeEntryProjectFilter,
  parseTimeEntryUserFilter,
  parseTimeEntryBillableFilter,
  computeTimeEntryActiveFilterCount,
} from "./view-params";

// Same base+"primary" Button classes as a plain `<Link>` styled to
// match — Button itself renders a real `<button>` with no polymorphic/
// asChild support (see e.g. leads/page.tsx's own identical
// PRIMARY_LINK_CLASSES for this exact reasoning).
const PRIMARY_LINK_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2";

/**
 * Time Tracking Phase 2A — the Staff time entries list. Every
 * organization TimeEntry is visible here regardless of who logged it
 * (§"LIST PERMISSIONS": "Do not artificially filter other members' time
 * from the list unless Phase 1 domain/read semantics require it" — they
 * don't; listTimeEntries has no such restriction). Management controls
 * are decided per-entry on the detail page itself, not here — this list
 * only links through to `/time/[id]`.
 *
 * A Project-specific view is just `/time?projectId=<id>` — no separate
 * Project-page Time tab exists in this phase (see the approved Phase 2A
 * IA decision).
 */
export default async function TimeEntriesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;

  const fromDate = parseTimeEntryFromDateFilter(resolvedSearchParams);
  const toDate = parseTimeEntryToDateFilter(resolvedSearchParams);
  const projectId = parseTimeEntryProjectFilter(resolvedSearchParams);
  const userId = parseTimeEntryUserFilter(resolvedSearchParams);
  const billable = parseTimeEntryBillableFilter(resolvedSearchParams);
  const showArchived = resolvedSearchParams.archived === "1";

  const [entries, members, projects] = await Promise.all([
    listTimeEntries(organizationId, { includeArchived: showArchived, fromDate, toDate, projectId, userId, billable }),
    prisma.membership.findMany({
      where: { organizationId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.project.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const visibleEntries = showArchived ? entries.filter((e) => e.archivedAt !== null) : entries;
  const memberOptions = members.map((m) => ({ id: m.user.id, name: m.user.name }));

  const hasActiveFilters = Boolean(fromDate || toDate || projectId || userId || billable !== undefined);
  // Mobile Improvement Slice B2 — see computeTimeEntryActiveFilterCount's
  // own doc comment for the exact approved rule (archived excluded).
  const mobileActiveFilterCount = computeTimeEntryActiveFilterCount({ from: fromDate, to: toDate, projectId, userId, billable });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <WorkTabs />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Time</h1>
          <p className="text-text-secondary mt-1 text-sm">Time logged by your team across projects.</p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href={showArchived ? "/time" : "/time?archived=1"}
            className="text-text-secondary hover:text-text-primary focus-visible:ring-focus-ring rounded text-sm font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            {showArchived ? "Show active" : "Show archived"}
          </Link>
          {projects.length > 0 && (
            <Link href="/time/new" className={PRIMARY_LINK_CLASSES}>
              Log time
            </Link>
          )}
        </div>
      </div>

      {/*
        Time Entries zero-Project prerequisite remediation — the filter
        bar deliberately stays rendered regardless of `projects.length`,
        unlike the analogous Tasks/Invoices/Contracts/Recurring Invoices
        guards. TimeEntry.projectId is nullable with onDelete: SetNull
        (unlike those siblings' own required/Cascade or Restrict
        relations) — an organization can have zero *current* Projects
        while still holding genuine historical TimeEntry rows (a Project
        that was later deleted). Those rows must stay filterable by
        date/member/billable/archived state; the Project dropdown simply
        degrades to "All projects" with no sub-options, which is a
        harmless affordance, never a dead end (filtering is never a
        required action the way Create is).
      */}
      <TimeEntryFilterBar
        from={fromDate ? formatDateOnly(fromDate) : ""}
        to={toDate ? formatDateOnly(toDate) : ""}
        projectId={projectId ?? ""}
        userId={userId ?? ""}
        billable={billable === undefined ? "" : String(billable)}
        showArchived={showArchived}
        projects={projects}
        members={memberOptions}
        hasActiveFilters={hasActiveFilters}
        mobileActiveFilterCount={mobileActiveFilterCount}
      />

      {visibleEntries.length === 0 ? (
        showArchived ? (
          <EmptyState title="No archived time entries" description="Archived time entries will appear here." />
        ) : hasActiveFilters ? (
          <EmptyState title="No matching time entries" description="Log time against a project to start tracking work here." />
        ) : projects.length === 0 ? (
          <EmptyState
            title="You need a project first"
            description="Time entries must belong to a project. Add one before logging time."
            action={
              <Link href="/projects/new" className={PRIMARY_LINK_CLASSES}>
                Add project
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="No time entries yet"
            description="Log time against a project to start tracking work here."
            action={
              <Link href="/time/new" className={PRIMARY_LINK_CLASSES}>
                Log time
              </Link>
            }
          />
        )
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Work date</TableHeaderCell>
              <TableHeaderCell>Member</TableHeaderCell>
              <TableHeaderCell>Project</TableHeaderCell>
              <TableHeaderCell className="hidden md:table-cell">Task</TableHeaderCell>
              <TableHeaderCell align="right">Duration</TableHeaderCell>
              <TableHeaderCell>Billable</TableHeaderCell>
              <TableHeaderCell className="hidden lg:table-cell">Description</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {visibleEntries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell emphasis>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/time/${entry.id}`}
                      className="focus-visible:ring-focus-ring rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                    >
                      {formatDateOnlyForDisplay(entry.workDate)}
                    </Link>
                    {entry.archivedAt !== null && <StatusBadge status="ARCHIVED" />}
                  </div>
                </TableCell>
                <TableCell>{entry.user?.name ?? "—"}</TableCell>
                <TableCell>
                  {entry.project ? (
                    <Link href={`/time?projectId=${entry.project.id}`} className="hover:underline">
                      {entry.project.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">{entry.task?.title ?? "—"}</TableCell>
                <TableCell align="right">{formatDurationMinutes(entry.durationMinutes)}</TableCell>
                <TableCell>
                  <span className="text-text-secondary text-sm">{entry.billable ? "Billable" : "Non-billable"}</span>
                </TableCell>
                <TableCell className="hidden max-w-xs truncate lg:table-cell">{entry.description ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
