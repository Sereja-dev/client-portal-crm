import { formatDateOnly } from "@/lib/invoices/date-only";
import { toWallClockInputValues, formatTimeInTimezone } from "./timezone";
import type { CalendarEventWithRelations, InvoiceDueOverlayItem } from "./queries";
import type { CalendarEventTargetType } from "./validation";

/**
 * Calendar V1 §17 — the small presentation-layer discriminated union
 * every Month/Agenda view renders. Deliberately NOT a polymorphic DB
 * model (see CalendarEvent's own schema doc comment) — this is built
 * fresh, at read time, from the two independent sources (manual
 * CalendarEvent rows and the read-only Invoice due-date overlay) and
 * never persisted anywhere. Manual event actions (edit/archive/restore)
 * only ever accept a real CalendarEvent id — an "invoice_due" item's own
 * `id` is an Invoice id, structurally impossible to pass to any
 * CalendarEvent mutation because those functions are never given this
 * union at all, only a plain string id from a call site that already
 * knows which kind of id it has (locked architecture §17: "Manual event
 * actions must only accept CalendarEvent ids").
 *
 * Pure (no I/O) — takes already-fetched plain data plus the
 * organization's own resolved timezone string, exactly like every other
 * builder in src/lib/*-metadata.ts.
 */
export type CalendarItem =
  | {
      kind: "event";
      id: string;
      title: string;
      allDay: boolean;
      dateKey: string;
      /** null for an all-day event — never a fabricated "12:00 AM". */
      timeLabel: string | null;
      targetLabel: string | null;
      assigneeLabel: string | null;
      archivedAt: Date | null;
      /**
       * Raw edit-prefill fields — the same data as the labels above, but
       * un-formatted, for populating CalendarEventForm's own inputs
       * (see calendar-workspace.tsx's own openEdit). Still built
       * entirely server-side, from the same already-fetched row, never
       * a second query.
       */
      description: string | null;
      location: string | null;
      /** Organization-local "HH:MM", null for an all-day event. */
      startTimeValue: string | null;
      endTimeValue: string | null;
      targetType: CalendarEventTargetType;
      targetId: string | null;
      assignedToUserId: string | null;
    }
  | {
      kind: "invoice_due";
      id: string;
      invoiceNumber: string;
      dateKey: string;
      clientName: string | null;
      status: InvoiceDueOverlayItem["status"];
    };

function targetLabelFor(event: CalendarEventWithRelations): string | null {
  return event.client?.name ?? event.lead?.name ?? event.project?.name ?? null;
}

/**
 * `dateKey` is always the organization-LOCAL calendar date ("YYYY-MM-DD")
 * — for an all-day event, its stored startsAt already IS that date-only
 * value (formatDateOnly reads it directly, matching every other date-
 * only field in this app); for a timed event, the stored UTC instant is
 * converted back through the organization's own timezone (never the
 * viewer's browser zone) via toWallClockInputValues, which is exactly
 * how a Bangkok-local midnight event that lands on the previous UTC date
 * still buckets into the LOCAL calendar day it was actually created for
 * (locked architecture §10.F).
 */
function targetTypeFor(event: CalendarEventWithRelations): CalendarEventTargetType {
  if (event.clientId) return "CLIENT";
  if (event.leadId) return "LEAD";
  if (event.projectId) return "PROJECT";
  return "NONE";
}

export function buildEventCalendarItem(event: CalendarEventWithRelations, timezone: string): CalendarItem {
  const dateKey = event.allDay ? formatDateOnly(event.startsAt) : toWallClockInputValues(event.startsAt, timezone).date;

  const timeLabel = event.allDay
    ? null
    : event.endsAt
      ? `${formatTimeInTimezone(event.startsAt, timezone)} – ${formatTimeInTimezone(event.endsAt, timezone)}`
      : formatTimeInTimezone(event.startsAt, timezone);

  return {
    kind: "event",
    id: event.id,
    title: event.title,
    allDay: event.allDay,
    dateKey,
    timeLabel,
    targetLabel: targetLabelFor(event),
    assigneeLabel: event.assignedToUser?.name ?? null,
    archivedAt: event.archivedAt,
    description: event.description,
    location: event.location,
    startTimeValue: event.allDay ? null : toWallClockInputValues(event.startsAt, timezone).time,
    endTimeValue: event.allDay || !event.endsAt ? null : toWallClockInputValues(event.endsAt, timezone).time,
    targetType: targetTypeFor(event),
    targetId: event.clientId ?? event.leadId ?? event.projectId ?? null,
    assignedToUserId: event.assignedToUserId,
  };
}

export function buildInvoiceDueCalendarItem(invoice: InvoiceDueOverlayItem): CalendarItem {
  return {
    kind: "invoice_due",
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    dateKey: formatDateOnly(invoice.dueDate),
    clientName: invoice.clientName,
    status: invoice.status,
  };
}

/** Groups an already-built item list by its own `dateKey` — the Month view's own per-cell bucket, and the ordering source for Agenda (still sorted chronologically overall, see buildCalendarItems below). */
export function groupCalendarItemsByDate(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const grouped = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const bucket = grouped.get(item.dateKey);
    if (bucket) {
      bucket.push(item);
    } else {
      grouped.set(item.dateKey, [item]);
    }
  }
  return grouped;
}

/**
 * The one combined, chronologically-sorted list both Month (via
 * groupCalendarItemsByDate above) and Agenda render from — manual
 * events and Invoice-due items merged, sorted by dateKey then by kind
 * (events before their day's own invoice items, a stable, arbitrary but
 * deterministic tie-break) then by title/invoiceNumber.
 */
export function buildCalendarItems(
  events: CalendarEventWithRelations[],
  invoiceDueItems: InvoiceDueOverlayItem[],
  timezone: string,
): CalendarItem[] {
  const items: CalendarItem[] = [
    ...events.map((event) => buildEventCalendarItem(event, timezone)),
    ...invoiceDueItems.map(buildInvoiceDueCalendarItem),
  ];

  return items.sort((a, b) => {
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "event" ? -1 : 1;
    const aLabel = a.kind === "event" ? a.title : a.invoiceNumber;
    const bLabel = b.kind === "event" ? b.title : b.invoiceNumber;
    return aLabel.localeCompare(bLabel);
  });
}
