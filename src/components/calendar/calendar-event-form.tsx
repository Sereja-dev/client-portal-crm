"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormLabel } from "@/components/ui/form-field";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/toast/toast-provider";
import { isStaleServerActionError, STALE_ACTION_MESSAGE } from "@/lib/action-error";
import type { CalendarEventFieldErrors, CalendarEventTargetType, CalendarEventWritableInput } from "@/lib/calendar-events/validation";
import type { CreateCalendarEventResult, UpdateCalendarEventResult } from "@/lib/calendar-events/service";
import type { ArchiveCalendarEventResult } from "@/lib/calendar-events/service";

const GENERIC_ERROR = "Something went wrong. Please try again.";

export type CalendarEventOption = { id: string; name: string };

export type CalendarEventFormDefaults = {
  title?: string;
  description?: string;
  location?: string;
  allDay?: boolean;
  date?: string;
  startTime?: string;
  endTime?: string;
  targetType?: CalendarEventTargetType;
  targetId?: string;
  assignedToUserId?: string;
};

/**
 * Calendar V1 §20 — the single reusable create/edit CalendarEvent form,
 * built the same way ContractForm/QuoteForm already are (their own
 * header comments' shared reasoning): `action` already takes a plain,
 * already-typed CalendarEventWritableInput object — matching
 * createCalendarEvent()/updateCalendarEvent()'s own exact shape — so
 * this component calls it directly inside startTransition and manages
 * fieldErrors as local state, rather than useActionState/FormData.
 *
 * "Related to" (locked architecture §3) is presented as ONE concept —
 * a type select (None/Client/Lead/Project) plus a second, dynamically-
 * populated select for the specific record — never three independent,
 * freely-combinable dropdowns. Changing the type clears whichever
 * record was previously selected, mirroring InvoiceForm/ContractForm's
 * own "changing the parent selection clears a now-invalid child one"
 * convention. The server (resolveCalendarEventTarget) remains the real
 * authority regardless (locked architecture §3/§13).
 *
 * All-day hides the time inputs entirely (locked architecture §11) —
 * never a disabled-but-visible pair, which would invite confusion about
 * whether a stale time value still matters.
 */
export function CalendarEventForm({
  action,
  clients,
  leads,
  projects,
  members,
  timezone,
  defaultValues,
  submitLabel = "Save event",
  pendingLabel = "Saving…",
  successToast,
  onSuccess,
  onArchive,
}: {
  action: (input: CalendarEventWritableInput) => Promise<CreateCalendarEventResult | UpdateCalendarEventResult>;
  clients: CalendarEventOption[];
  leads: CalendarEventOption[];
  projects: CalendarEventOption[];
  members: CalendarEventOption[];
  /** The organization's own authoritative IANA zone (locked architecture §8) — shown only as a plain informational hint, never used for any client-side date math. */
  timezone: string;
  defaultValues?: CalendarEventFormDefaults;
  submitLabel?: string;
  pendingLabel?: string;
  successToast: string;
  onSuccess: () => void;
  /** Edit mode only — omit entirely in create mode (there is nothing to archive yet). Renders a separate "Archive event" control, confirmed the same way every other archive/delete action in this app is (never a bare `confirm()`). */
  onArchive?: () => Promise<ArchiveCalendarEventResult>;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<CalendarEventFieldErrors>({});
  const archiveDialogRef = useRef<ConfirmDialogHandle>(null);

  const [title, setTitle] = useState(defaultValues?.title ?? "");
  const [description, setDescription] = useState(defaultValues?.description ?? "");
  const [location, setLocation] = useState(defaultValues?.location ?? "");
  const [allDay, setAllDay] = useState(defaultValues?.allDay ?? false);
  const [date, setDate] = useState(defaultValues?.date ?? "");
  const [startTime, setStartTime] = useState(defaultValues?.startTime ?? "");
  const [endTime, setEndTime] = useState(defaultValues?.endTime ?? "");
  const [targetType, setTargetType] = useState<CalendarEventTargetType>(defaultValues?.targetType ?? "NONE");
  const [targetId, setTargetId] = useState(defaultValues?.targetId ?? "");
  const [assignedToUserId, setAssignedToUserId] = useState(defaultValues?.assignedToUserId ?? "");

  const targetOptions = targetType === "CLIENT" ? clients : targetType === "LEAD" ? leads : targetType === "PROJECT" ? projects : [];

  function dismissErrors() {
    setFieldErrors({});
  }

  function handleTargetTypeChange(next: CalendarEventTargetType) {
    setTargetType(next);
    setTargetId("");
    dismissErrors();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    dismissErrors();

    const input: CalendarEventWritableInput = {
      title,
      description: description || undefined,
      location: location || undefined,
      allDay,
      date,
      startTime: allDay ? undefined : startTime,
      endTime: allDay ? undefined : endTime || undefined,
      targetType,
      targetId: targetType === "NONE" ? undefined : targetId,
      assignedToUserId: assignedToUserId || undefined,
    };

    startTransition(async () => {
      try {
        const result = await action(input);
        if (result.ok) {
          showToast(successToast);
          router.refresh();
          onSuccess();
          return;
        }
        switch (result.reason) {
          case "VALIDATION":
            setFieldErrors(result.fieldErrors);
            return;
          case "INVALID_TARGET":
            setFieldErrors((prev) => ({ ...prev, targetId: "This record is no longer available — it may have been archived. Choose another or clear this field." }));
            return;
          case "INVALID_ASSIGNEE":
            setFieldErrors((prev) => ({ ...prev, assignedToUserId: "This person is no longer a member of the organization. Choose another or clear this field." }));
            return;
          case "NOT_FOUND":
            showToast("This event could not be found — it may have been removed elsewhere. Refreshing…", "error");
            router.refresh();
            onSuccess();
            return;
          default:
            showToast(GENERIC_ERROR, "error");
        }
      } catch (err) {
        showToast(isStaleServerActionError(err) ? STALE_ACTION_MESSAGE : GENERIC_ERROR, "error");
      }
    });
  }

  function runArchive() {
    if (!onArchive) return;
    startTransition(async () => {
      try {
        const result = await onArchive();
        if (result.ok) {
          showToast("Event archived");
          router.refresh();
          onSuccess();
          return;
        }
        showToast("This event could not be found — it may have already been removed. Refreshing…", "error");
        router.refresh();
        onSuccess();
      } catch (err) {
        showToast(isStaleServerActionError(err) ? STALE_ACTION_MESSAGE : GENERIC_ERROR, "error");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormField label="Title" htmlFor="calendar-event-title" required error={fieldErrors.title}>
        <Input
          id="calendar-event-title"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            dismissErrors();
          }}
          required
          aria-invalid={!!fieldErrors.title}
          aria-describedby={fieldErrors.title ? "calendar-event-title-error" : undefined}
        />
      </FormField>

      <div className="flex items-center gap-2">
        <input
          id="calendar-event-all-day"
          type="checkbox"
          checked={allDay}
          onChange={(event) => {
            setAllDay(event.target.checked);
            dismissErrors();
          }}
          className="border-border-strong accent-accent focus-visible:ring-focus-ring h-4 w-4 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        />
        <label htmlFor="calendar-event-all-day" className="text-text-secondary text-sm">
          All day
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField label="Date" htmlFor="calendar-event-date" required error={fieldErrors.date}>
          <Input
            id="calendar-event-date"
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              dismissErrors();
            }}
            required
            aria-invalid={!!fieldErrors.date}
          />
        </FormField>

        {!allDay && (
          <>
            <FormField label="Start time" htmlFor="calendar-event-start-time" required error={fieldErrors.startTime}>
              <Input
                id="calendar-event-start-time"
                type="time"
                value={startTime}
                onChange={(event) => {
                  setStartTime(event.target.value);
                  dismissErrors();
                }}
                required
                aria-invalid={!!fieldErrors.startTime}
              />
            </FormField>
            <FormField label="End time" htmlFor="calendar-event-end-time" error={fieldErrors.endTime}>
              <Input
                id="calendar-event-end-time"
                type="time"
                value={endTime}
                onChange={(event) => {
                  setEndTime(event.target.value);
                  dismissErrors();
                }}
                aria-invalid={!!fieldErrors.endTime}
              />
            </FormField>
          </>
        )}
      </div>
      {!allDay && (
        <p className="text-text-muted text-xs">Times are in the organization&rsquo;s timezone ({timezone}).</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <FormLabel htmlFor="calendar-event-target-type">Related to</FormLabel>
          <Select
            id="calendar-event-target-type"
            value={targetType}
            onChange={(event) => handleTargetTypeChange(event.target.value as CalendarEventTargetType)}
          >
            <option value="NONE">None</option>
            <option value="CLIENT">Client</option>
            <option value="LEAD">Lead</option>
            <option value="PROJECT">Project</option>
          </Select>
        </div>

        {targetType !== "NONE" && (
          <FormField label={targetType === "CLIENT" ? "Client" : targetType === "LEAD" ? "Lead" : "Project"} htmlFor="calendar-event-target-id" required error={fieldErrors.targetId}>
            <Select
              id="calendar-event-target-id"
              value={targetId}
              onChange={(event) => {
                setTargetId(event.target.value);
                dismissErrors();
              }}
              required
              aria-invalid={!!fieldErrors.targetId}
            >
              <option value="">Select…</option>
              {targetOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
      </div>

      <FormField label="Assigned to" htmlFor="calendar-event-assignee" error={fieldErrors.assignedToUserId}>
        <Select
          id="calendar-event-assignee"
          value={assignedToUserId}
          onChange={(event) => {
            setAssignedToUserId(event.target.value);
            dismissErrors();
          }}
          aria-invalid={!!fieldErrors.assignedToUserId}
        >
          <option value="">Unassigned</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="Location" htmlFor="calendar-event-location" error={fieldErrors.location}>
        <Input
          id="calendar-event-location"
          value={location}
          onChange={(event) => {
            setLocation(event.target.value);
            dismissErrors();
          }}
          aria-invalid={!!fieldErrors.location}
        />
      </FormField>

      <FormField label="Description" htmlFor="calendar-event-description" error={fieldErrors.description}>
        <Textarea
          id="calendar-event-description"
          rows={3}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
            dismissErrors();
          }}
          aria-invalid={!!fieldErrors.description}
        />
      </FormField>

      <div className="flex items-center justify-between gap-3">
        {onArchive ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => archiveDialogRef.current?.open()}
            className="text-danger focus-visible:ring-focus-ring rounded text-sm font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Archive event
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onSuccess}
            className="border-border-strong text-text-secondary focus-visible:ring-focus-ring rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <Button type="submit" disabled={pending} loading={pending}>
            {pending ? pendingLabel : submitLabel}
          </Button>
        </div>
      </div>

      {onArchive && (
        <ConfirmDialog
          ref={archiveDialogRef}
          title="Archive event"
          description="This event will be hidden from the Calendar's normal Month and Agenda views. Its history is not affected, and it can be restored at any time."
          confirmLabel="Archive event"
          onConfirm={runArchive}
        />
      )}
    </form>
  );
}
