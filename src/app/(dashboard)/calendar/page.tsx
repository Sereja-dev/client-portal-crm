import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { parseSearchParam, type RawSearchParams } from "@/lib/list-params";
import { isUuid } from "@/lib/validation/lead";
import {
  listCalendarEventsForRange,
  listArchivedCalendarEventsForRange,
  listInvoiceDueOverlayForRange,
  listAssignableMembers,
  getOrganizationTimezone,
} from "@/lib/calendar-events/queries";
import { buildMonthGrid, formatMonthLabel, shiftMonth } from "@/lib/calendar-events/month-grid";
import { toWallClockInputValues } from "@/lib/calendar-events/timezone";
import { buildCalendarItems, groupCalendarItemsByDate, type CalendarItem } from "@/lib/calendar-events/calendar-item";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { CalendarViewTabs } from "@/components/calendar/calendar-view-tabs";
import { CalendarWorkspace, type MonthGridCell } from "@/components/calendar/calendar-workspace";
import { RestoreCalendarEventButton } from "@/components/calendar/restore-calendar-event-button";
import { EmptyState } from "@/components/ui/empty-state";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { AutoSubmitSelect } from "@/components/list/auto-submit-select";
import { createCalendarEventAction, updateCalendarEventAction, archiveCalendarEventAction } from "./actions";

type CalendarView = "month" | "agenda" | "archived";

function parseView(raw: string): CalendarView {
  return raw === "agenda" || raw === "archived" ? raw : "month";
}

/**
 * Calendar V1 §1/§18/§19/§22 — the single Calendar route. `?view=` picks
 * Month (default)/Agenda/Archived; `?y=&m=` pick which month's range
 * every view is bounded to (locked architecture §15: never an unbounded
 * fetch) — Agenda and Archived reuse the exact same month-boundary range
 * Month view itself fetches, never a separate unbounded window. `?assignee=`
 * is the one filter V1 supports (locked architecture §23): either a real
 * member id, or this Staff member's own id via the "My events" shortcut
 * link — both routed through the identical `assignedToUserId` query
 * filter, never a separate mechanism.
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { user, organizationId } = await getCurrentUserOrganization();
  const resolved = await searchParams;
  const view = parseView(parseSearchParam(resolved.view));

  const timezone = await getOrganizationTimezone(organizationId);
  const now = new Date();
  const orgToday = toWallClockInputValues(now, timezone).date; // "YYYY-MM-DD", organization-local

  const yearParam = Number(parseSearchParam(resolved.y));
  const monthParam = Number(parseSearchParam(resolved.m));
  const [todayYear, todayMonth] = orgToday.split("-").map(Number);
  const year = Number.isInteger(yearParam) && yearParam > 0 ? yearParam : todayYear;
  const month = Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12 ? monthParam : todayMonth;

  const grid = buildMonthGrid(year, month, 0);
  const rangeFrom = grid[0].date;
  const rangeTo = new Date(grid[grid.length - 1].date.getTime() + 24 * 60 * 60 * 1000);

  const assigneeRaw = parseSearchParam(resolved.assignee);
  const assigneeFilter = isUuid(assigneeRaw) ? assigneeRaw : undefined;

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const viewQuery = view === "month" ? "" : `view=${view}&`;
  const assigneeQuery = assigneeFilter ? `assignee=${assigneeFilter}&` : "";
  const monthHref = (y: number, m: number) => `/calendar?${viewQuery}${assigneeQuery}y=${y}&m=${m}`;
  const todayHref = `/calendar?${viewQuery}${assigneeQuery}y=${todayYear}&m=${todayMonth}`;

  const members = await listAssignableMembers(organizationId);

  if (view === "archived") {
    const archivedEvents = await listArchivedCalendarEventsForRange(organizationId, { from: rangeFrom, to: rangeTo });
    return (
      <div>
        <CalendarHeader monthLabel={formatMonthLabel(year, month)} prevHref={monthHref(prev.year, prev.month)} nextHref={monthHref(next.year, next.month)} todayHref={todayHref} view={view} />
        {archivedEvents.length === 0 ? (
          <EmptyState title="No archived events" description="Events you archive in this month will appear here." />
        ) : (
          <ul className="divide-border-default mt-4 divide-y">
            {archivedEvents.map((event) => (
              <li key={event.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-text-primary text-sm font-medium">{event.title}</p>
                  <p className="text-text-muted text-xs">
                    {event.allDay ? formatDateOnlyForDisplay(event.startsAt) : toWallClockInputValues(event.startsAt, timezone).date}
                  </p>
                </div>
                <RestoreCalendarEventButton eventId={event.id} />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const [clientOptions, leadOptions, projectOptions, events, invoiceDueItems] = await Promise.all([
    prisma.client.findMany({ where: { organizationId, status: { not: "ARCHIVED" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.lead.findMany({ where: { organizationId, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    listCalendarEventsForRange(organizationId, { from: rangeFrom, to: rangeTo }, { assignedToUserId: assigneeFilter }),
    listInvoiceDueOverlayForRange(organizationId, { from: rangeFrom, to: rangeTo }),
  ]);

  const allItems: CalendarItem[] = buildCalendarItems(events, invoiceDueItems, timezone);
  const grouped = groupCalendarItemsByDate(allItems);
  const itemsByDate: Record<string, CalendarItem[]> = Object.fromEntries(grouped);

  const monthGridCells: MonthGridCell[] = grid.map((cell) => {
    const dateKey = cell.date.toISOString().slice(0, 10);
    return { dateKey, dayLabel: cell.date.getUTCDate(), isCurrentMonth: cell.isCurrentMonth, isToday: dateKey === orgToday };
  });

  return (
    <div>
      <CalendarHeader monthLabel={formatMonthLabel(year, month)} prevHref={monthHref(prev.year, prev.month)} nextHref={monthHref(next.year, next.month)} todayHref={todayHref} view={view} />

      <form method="GET" action="/calendar" className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="y" value={year} />
        <input type="hidden" name="m" value={month} />
        <div>
          <label htmlFor="calendar-assignee-filter" className="text-text-secondary block text-xs font-medium">
            Assignee
          </label>
          <AutoSubmitSelect id="calendar-assignee-filter" name="assignee" defaultValue={assigneeFilter ?? ""}>
            <option value="">All</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.id === user.id ? `${member.name} (me)` : member.name}
              </option>
            ))}
          </AutoSubmitSelect>
        </div>
        {assigneeFilter !== user.id ? (
          <Link href={`/calendar?${viewQuery}y=${year}&m=${month}&assignee=${user.id}`} className={ACTION_LINK_CLASSES}>
            My events only
          </Link>
        ) : (
          <Link href={`/calendar?${viewQuery}y=${year}&m=${month}`} className={ACTION_LINK_CLASSES}>
            Show all events
          </Link>
        )}
      </form>

      <div className="mt-4">
        <CalendarWorkspace
          view={view === "agenda" ? "agenda" : "month"}
          monthGrid={view === "month" ? monthGridCells : undefined}
          itemsByDate={itemsByDate}
          allItems={allItems}
          clients={clientOptions}
          leads={leadOptions}
          projects={projectOptions}
          members={members}
          timezone={timezone}
          createAction={createCalendarEventAction}
          updateAction={updateCalendarEventAction}
          archiveAction={archiveCalendarEventAction}
        />
      </div>
    </div>
  );
}

function CalendarHeader({
  monthLabel,
  prevHref,
  nextHref,
  todayHref,
  view,
}: {
  monthLabel: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  view: CalendarView;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Calendar</h1>
        <p className="text-text-secondary mt-1 text-sm">{monthLabel}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Link href={prevHref} aria-label="Previous month" className={`${ACTION_LINK_CLASSES} px-2 py-1`}>
            ← Previous
          </Link>
          <Link href={todayHref} className={`${ACTION_LINK_CLASSES} px-2 py-1`}>
            Today
          </Link>
          <Link href={nextHref} aria-label="Next month" className={`${ACTION_LINK_CLASSES} px-2 py-1`}>
            Next →
          </Link>
        </div>
        <CalendarViewTabs active={view} />
      </div>
    </div>
  );
}
