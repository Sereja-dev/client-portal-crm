"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMembership } from "@/lib/current-user";
import {
  createCalendarEvent,
  updateCalendarEvent,
  archiveCalendarEvent,
  restoreCalendarEvent,
  type CreateCalendarEventResult,
  type UpdateCalendarEventResult,
  type ArchiveCalendarEventResult,
  type RestoreCalendarEventResult,
} from "@/lib/calendar-events/service";
import type { CalendarEventActor } from "@/lib/calendar-events/authorization";
import type { CalendarEventWritableInput } from "@/lib/calendar-events/validation";

/**
 * Calendar V1 (locked architecture §26) — the Server Action layer
 * binding src/lib/calendar-events/service.ts's own domain functions to
 * the Calendar UI. Mirrors src/app/(dashboard)/contracts/actions.ts's
 * own shape exactly: every action re-resolves {user, organizationId,
 * membership} itself via getCurrentMembership() — never trusts a
 * client-supplied organizationId, actor id, or role — and hands off
 * straight to the service layer, which is the only place any lifecycle/
 * validation/authorization logic lives. No role check exists here
 * either — Calendar has no privileged gate (canManageCalendarEvents
 * always returns true for any authenticated Membership role; see
 * authorization.ts's own doc comment) — every one of OWNER/ADMIN/MEMBER
 * reaches the same service call.
 *
 * No rate limiting: Contract's own actions.ts (the closest architectural
 * sibling this whole feature mirrors throughout — same authorization
 * shape, same target/types/service structure) has none either, and
 * locked architecture §27 asks for existing precedent to clearly support
 * adding it, not merely for it to exist somewhere in the app (Task/Quote
 * create actions do rate-limit, but neither is the sibling this feature
 * was modeled on).
 *
 * revalidatePath is only ever called on a successful outcome — matching
 * every other lifecycle action's own identical discipline — so a
 * rejected mutation never invalidates a cache for a page that didn't
 * actually change. Foreign-vs-nonexistent distinctions are never exposed
 * — every NOT_FOUND/INVALID_TARGET/INVALID_ASSIGNEE result the service
 * layer returns is already a single, generic, non-distinguishable
 * outcome (see target.ts's own doc comment).
 */

function actorFor(user: { id: string; name: string }, role: CalendarEventActor["role"]): CalendarEventActor {
  return { id: user.id, name: user.name, role };
}

export async function createCalendarEventAction(input: CalendarEventWritableInput): Promise<CreateCalendarEventResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await createCalendarEvent(organizationId, actorFor(user, membership.role), input);
  if (result.ok) {
    revalidatePath("/calendar");
  }
  return result;
}

export async function updateCalendarEventAction(
  eventId: string,
  input: CalendarEventWritableInput,
): Promise<UpdateCalendarEventResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await updateCalendarEvent(organizationId, eventId, actorFor(user, membership.role), input);
  if (result.ok) {
    revalidatePath("/calendar");
  }
  return result;
}

export async function archiveCalendarEventAction(eventId: string): Promise<ArchiveCalendarEventResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await archiveCalendarEvent(organizationId, eventId, actorFor(user, membership.role));
  if (result.ok) {
    revalidatePath("/calendar");
  }
  return result;
}

export async function restoreCalendarEventAction(eventId: string): Promise<RestoreCalendarEventResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await restoreCalendarEvent(organizationId, eventId, actorFor(user, membership.role));
  if (result.ok) {
    revalidatePath("/calendar");
  }
  return result;
}
