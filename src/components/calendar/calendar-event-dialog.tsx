"use client";

import { useId, type RefObject } from "react";
import { DIALOG_CENTER_CLASSES } from "@/components/ui/dialog-classes";
import { CalendarEventForm, type CalendarEventFormDefaults, type CalendarEventOption } from "./calendar-event-form";
import type { CalendarEventWritableInput } from "@/lib/calendar-events/validation";
import type { ArchiveCalendarEventResult, CreateCalendarEventResult, UpdateCalendarEventResult } from "@/lib/calendar-events/service";

/**
 * Calendar V1 §20/§31 — a form-holding sibling of ConfirmDialog, same
 * shape as ContactFormDialog (src/components/clients/contact-form-
 * dialog.tsx): same native `<dialog>` + DIALOG_CENTER_CLASSES
 * foundation (modal focus trapping, Escape-to-close, backdrop all from
 * the browser), and deliberately presentational only — the caller
 * (calendar-workspace.tsx) owns the `dialogRef` and decides when to
 * open it in create vs. edit mode, exactly like ContactFormDialog's own
 * caller. Closes itself automatically on a successful submit
 * (CalendarEventForm's own onSuccess callback) — never on a validation
 * error, so the visitor doesn't lose their in-progress input.
 */
export function CalendarEventDialog({
  dialogRef,
  title,
  action,
  clients,
  leads,
  projects,
  members,
  timezone,
  defaultValues,
  successToast,
  formKey,
  onArchive,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  title: string;
  action: (input: CalendarEventWritableInput) => Promise<CreateCalendarEventResult | UpdateCalendarEventResult>;
  clients: CalendarEventOption[];
  leads: CalendarEventOption[];
  projects: CalendarEventOption[];
  members: CalendarEventOption[];
  timezone: string;
  defaultValues?: CalendarEventFormDefaults;
  successToast: string;
  onArchive?: () => Promise<ArchiveCalendarEventResult>;
  /**
   * This one dialog instance is reused for both "create new" and every
   * "edit event X" open (owned/toggled by calendar-workspace.tsx) —
   * without a `key` that changes across opens, CalendarEventForm's own
   * internal useState() would keep whichever event's data it first
   * mounted with instead of picking up a different `defaultValues` prop
   * on a later open (React never re-runs a hook's own initializer just
   * because a prop changed). Passing this straight through as the
   * form's `key` forces a full remount — and therefore a fresh
   * useState() read of the new defaultValues — every time the caller
   * opens a different event (or switches from an existing event to a
   * brand-new one).
   */
  formKey: string;
}) {
  const titleId = useId();

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          (event.currentTarget as HTMLDialogElement).close();
        }
      }}
      className={`border-border-default bg-surface w-full max-w-md rounded-lg border p-6 shadow-xl backdrop:bg-black/40 ${DIALOG_CENTER_CLASSES}`}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 id={titleId} className="text-text-primary text-base font-semibold">
          {title}
        </h2>
        <button
          type="button"
          onClick={(event) => (event.currentTarget.closest("dialog") as HTMLDialogElement | null)?.close()}
          aria-label="Close"
          className="text-text-muted focus-visible:ring-focus-ring rounded p-1 hover:text-text-secondary focus:outline-none focus-visible:ring-2"
        >
          ✕
        </button>
      </div>
      <CalendarEventForm
        key={formKey}
        action={action}
        clients={clients}
        leads={leads}
        projects={projects}
        members={members}
        timezone={timezone}
        defaultValues={defaultValues}
        successToast={successToast}
        onSuccess={() => dialogRef.current?.close()}
        onArchive={onArchive}
      />
    </dialog>
  );
}
