import type { CalendarEventActor } from "@/lib/calendar-events/authorization";
import type { CalendarEventWritableInput } from "@/lib/calendar-events/validation";

/** Mirrors test/integration/contracts/helpers.ts's own actorFor exactly. */
export function actorFor(user: { id: string; name: string }, role: "OWNER" | "ADMIN" | "MEMBER"): CalendarEventActor {
  return { id: user.id, name: user.name, role };
}

/** A minimal valid all-day event input, matching parseCalendarEventInput's own requirements. */
export function allDayEventInput(overrides: Partial<CalendarEventWritableInput> = {}): CalendarEventWritableInput {
  return {
    title: "Kickoff call",
    allDay: true,
    date: "2026-06-01",
    ...overrides,
  };
}

/** A minimal valid timed event input. */
export function timedEventInput(overrides: Partial<CalendarEventWritableInput> = {}): CalendarEventWritableInput {
  return {
    title: "Kickoff call",
    allDay: false,
    date: "2026-06-01",
    startTime: "14:00",
    ...overrides,
  };
}
