"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { CalendarEventDialog } from "./calendar-event-dialog";
import type { CalendarEventOption } from "./calendar-event-form";
import { groupCalendarItemsByDate, type CalendarItem } from "@/lib/calendar-events/calendar-item";
import type { CalendarEventWritableInput } from "@/lib/calendar-events/validation";
import type {
  ArchiveCalendarEventResult,
  CreateCalendarEventResult,
  UpdateCalendarEventResult,
} from "@/lib/calendar-events/service";

export type MonthGridCell = { dateKey: string; dayLabel: number; isCurrentMonth: boolean; isToday: boolean };

/**
 * Calendar V1 §18/§19/§20 — the one interactive surface both Month and
 * Agenda render through, and the sole owner of the shared create/edit
 * dialog (locked architecture: one reusable dialog, no per-event
 * duplicate). `view`/`itemsByDate`/`allItems`/the grid are all computed
 * server-side (page.tsx) — this component only renders already-resolved
 * plain data and drives the dialog's open/edit state; it performs no
 * date/timezone math of its own beyond simple dateKey string lookups.
 *
 * `createAction`/`updateAction`/`archiveAction` are real Server Action
 * references passed down as props (never a plain closure — see
 * calendar-event-dialog.tsx's own doc comment on `formKey` for the
 * related "must remount, not just re-prop" concern this component's own
 * `.bind()` calls below feed into) — `.bind(null, eventId)` on an
 * already-received Server Action reference is a plain client-side JS
 * operation on a value already safely on this side of the boundary,
 * exactly the same technique src/app/(dashboard)/recurring-invoices/
 * [id]/edit/page.tsx already uses server-side for its own bound update
 * action.
 */
export function CalendarWorkspace({
  view,
  monthGrid,
  itemsByDate,
  allItems,
  clients,
  leads,
  projects,
  members,
  timezone,
  createAction,
  updateAction,
  archiveAction,
}: {
  view: "month" | "agenda";
  monthGrid?: MonthGridCell[];
  itemsByDate: Record<string, CalendarItem[]>;
  allItems: CalendarItem[];
  clients: CalendarEventOption[];
  leads: CalendarEventOption[];
  projects: CalendarEventOption[];
  members: CalendarEventOption[];
  timezone: string;
  createAction: (input: CalendarEventWritableInput) => Promise<CreateCalendarEventResult>;
  updateAction: (eventId: string, input: CalendarEventWritableInput) => Promise<UpdateCalendarEventResult>;
  archiveAction: (eventId: string) => Promise<ArchiveCalendarEventResult>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [dialogState, setDialogState] = useState<{
    mode: "create" | "edit";
    eventId: string | null;
    title: string;
    defaultValues: Parameters<typeof CalendarEventDialog>[0]["defaultValues"];
  }>({ mode: "create", eventId: null, title: "New event", defaultValues: undefined });
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

  function openCreate(prefillDateKey?: string) {
    setDialogState({
      mode: "create",
      eventId: null,
      title: "New event",
      defaultValues: prefillDateKey ? { date: prefillDateKey } : undefined,
    });
    dialogRef.current?.showModal();
  }

  function openEdit(item: Extract<CalendarItem, { kind: "event" }>) {
    setDialogState({
      mode: "edit",
      eventId: item.id,
      title: "Edit event",
      defaultValues: {
        title: item.title,
        allDay: item.allDay,
        date: item.dateKey,
        startTime: item.startTimeValue ?? undefined,
        endTime: item.endTimeValue ?? undefined,
        targetType: item.targetType,
        targetId: item.targetId ?? undefined,
        assignedToUserId: item.assignedToUserId ?? undefined,
        description: item.description ?? undefined,
        location: item.location ?? undefined,
      },
    });
    dialogRef.current?.showModal();
  }

  const boundAction =
    dialogState.mode === "create" ? createAction : (input: CalendarEventWritableInput) => updateAction(dialogState.eventId as string, input);
  const boundArchive = dialogState.eventId ? () => archiveAction(dialogState.eventId as string) : undefined;

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button type="button" onClick={() => openCreate()}>
          New event
        </Button>
      </div>

      {view === "month" && monthGrid && (
        <MonthGrid grid={monthGrid} itemsByDate={itemsByDate} onSelectDay={setSelectedDateKey} onCreateOnDay={openCreate} onOpenEvent={openEdit} />
      )}

      {view === "month" && selectedDateKey && (
        <div className="mt-6">
          <h2 className="text-text-primary text-sm font-semibold">{selectedDateKey}</h2>
          <DayItemsList items={itemsByDate[selectedDateKey] ?? []} onOpenEvent={openEdit} />
        </div>
      )}

      {view === "agenda" && <AgendaList items={allItems} onOpenEvent={openEdit} />}

      <CalendarEventDialog
        dialogRef={dialogRef}
        title={dialogState.title}
        action={boundAction}
        clients={clients}
        leads={leads}
        projects={projects}
        members={members}
        timezone={timezone}
        defaultValues={dialogState.defaultValues}
        successToast={dialogState.mode === "create" ? "Event created" : "Event updated"}
        formKey={dialogState.eventId ?? "create"}
        onArchive={dialogState.mode === "edit" ? boundArchive : undefined}
      />
    </div>
  );
}

function MonthGrid({
  grid,
  itemsByDate,
  onSelectDay,
  onCreateOnDay,
  onOpenEvent,
}: {
  grid: MonthGridCell[];
  itemsByDate: Record<string, CalendarItem[]>;
  onSelectDay: (dateKey: string) => void;
  onCreateOnDay: (dateKey: string) => void;
  onOpenEvent: (item: Extract<CalendarItem, { kind: "event" }>) => void;
}) {
  const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[280px] grid-cols-7 gap-px text-center text-xs font-medium">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="text-text-muted py-1">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {grid.map((cell) => {
          const items = itemsByDate[cell.dateKey] ?? [];
          return (
            <div
              key={cell.dateKey}
              className={`border-border-default min-h-[64px] border p-1 sm:min-h-[96px] sm:p-2 ${cell.isCurrentMonth ? "bg-surface" : "bg-surface-recessed"}`}
            >
              <button
                type="button"
                onClick={() => onSelectDay(cell.dateKey)}
                aria-label={`${cell.dateKey}${items.length > 0 ? `, ${items.length} ${items.length === 1 ? "item" : "items"}` : ""}`}
                className={`focus-visible:ring-focus-ring w-full rounded text-left text-xs font-medium focus:outline-none focus-visible:ring-2 ${
                  cell.isToday ? "text-accent font-semibold" : cell.isCurrentMonth ? "text-text-primary" : "text-text-muted"
                }`}
              >
                {cell.dayLabel}
              </button>

              {/* Mobile (<sm): a bounded count indicator only, never dense event text in every cell (locked architecture §18). */}
              {items.length > 0 && (
                <span className="text-text-muted mt-1 block text-[10px] sm:hidden">
                  {items.length} {items.length === 1 ? "item" : "items"}
                </span>
              )}

              {/* sm and up: real chips, each a real button/link, never color-only. */}
              <div className="mt-1 hidden space-y-0.5 sm:block">
                {items.slice(0, 3).map((item) => (
                  <CalendarItemChip key={`${item.kind}-${item.id}`} item={item} onOpenEvent={onOpenEvent} />
                ))}
                {items.length > 3 && (
                  <button
                    type="button"
                    onClick={() => onSelectDay(cell.dateKey)}
                    className="text-text-muted focus-visible:ring-focus-ring block text-[11px] hover:underline focus:outline-none focus-visible:ring-2"
                  >
                    +{items.length - 3} more
                  </button>
                )}
              </div>

              {cell.isCurrentMonth && (
                <button
                  type="button"
                  onClick={() => onCreateOnDay(cell.dateKey)}
                  className="text-text-muted focus-visible:ring-focus-ring mt-1 hidden text-[11px] hover:underline focus:outline-none focus-visible:ring-2 sm:block"
                >
                  + Add
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarItemChip({
  item,
  onOpenEvent,
}: {
  item: CalendarItem;
  onOpenEvent: (item: Extract<CalendarItem, { kind: "event" }>) => void;
}) {
  if (item.kind === "event") {
    return (
      <button
        type="button"
        onClick={() => onOpenEvent(item)}
        title={item.title}
        className="bg-accent-subtle text-accent focus-visible:ring-focus-ring block w-full truncate rounded px-1 py-0.5 text-left text-[11px] font-medium hover:underline focus:outline-none focus-visible:ring-2"
      >
        {item.timeLabel ? `${item.timeLabel} ` : ""}
        {item.title}
      </button>
    );
  }
  return (
    <Link
      href={`/invoices/${item.id}/edit`}
      title={`Invoice ${item.invoiceNumber} due`}
      className="text-text-secondary focus-visible:ring-focus-ring block w-full truncate rounded px-1 py-0.5 text-left text-[11px] hover:underline focus:outline-none focus-visible:ring-2"
    >
      Due: {item.invoiceNumber}
    </Link>
  );
}

function DayItemsList({
  items,
  onOpenEvent,
}: {
  items: CalendarItem[];
  onOpenEvent: (item: Extract<CalendarItem, { kind: "event" }>) => void;
}) {
  if (items.length === 0) {
    return <p className="text-text-muted mt-2 text-sm">Nothing on this day.</p>;
  }
  return (
    <ul className="divide-border-default mt-2 divide-y">
      {items.map((item) => (
        <li key={`${item.kind}-${item.id}`} className="py-2">
          <CalendarItemRow item={item} onOpenEvent={onOpenEvent} />
        </li>
      ))}
    </ul>
  );
}

function CalendarItemRow({
  item,
  onOpenEvent,
}: {
  item: CalendarItem;
  onOpenEvent: (item: Extract<CalendarItem, { kind: "event" }>) => void;
}) {
  if (item.kind === "event") {
    return (
      <button
        type="button"
        onClick={() => onOpenEvent(item)}
        className="focus-visible:ring-focus-ring block w-full rounded text-left focus:outline-none focus-visible:ring-2"
      >
        <div className="flex items-center gap-2">
          <StatusBadge status="EVENT" label="Event" tone="info" />
          <span className="text-text-primary text-sm font-medium">{item.title}</span>
        </div>
        <p className="text-text-muted mt-0.5 text-xs">
          {item.timeLabel ?? "All day"}
          {item.targetLabel ? ` · ${item.targetLabel}` : ""}
          {item.assigneeLabel ? ` · ${item.assigneeLabel}` : ""}
        </p>
      </button>
    );
  }
  return (
    <Link href={`/invoices/${item.id}/edit`} className="focus-visible:ring-focus-ring block rounded focus:outline-none focus-visible:ring-2">
      <div className="flex items-center gap-2">
        <StatusBadge status="INVOICE_DUE" label="Invoice due" tone="warning" />
        <span className="text-text-primary text-sm font-medium">{item.invoiceNumber}</span>
      </div>
      <p className="text-text-muted mt-0.5 text-xs">
        {item.clientName ?? "No client"} · <StatusBadge status={item.status} />
      </p>
    </Link>
  );
}

function AgendaList({
  items,
  onOpenEvent,
}: {
  items: CalendarItem[];
  onOpenEvent: (item: Extract<CalendarItem, { kind: "event" }>) => void;
}) {
  if (items.length === 0) {
    return <EmptyState title="Nothing scheduled" description="Events and upcoming invoice due dates in this range will appear here." />;
  }

  const grouped = groupCalendarItemsByDate(items);

  return (
    <div className="space-y-6">
      {[...grouped.entries()].map(([dateKey, dayItems]) => (
        <div key={dateKey} className={`p-4 ${CARD_SURFACE_CLASSES}`}>
          <h2 className="text-text-primary text-sm font-semibold">{dateKey}</h2>
          <DayItemsList items={dayItems} onOpenEvent={onOpenEvent} />
        </div>
      ))}
    </div>
  );
}
