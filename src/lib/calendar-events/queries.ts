import "server-only";
import { prisma } from "@/lib/prisma";
import type { CalendarEvent } from "@/generated/prisma/client";
import { isUuid } from "@/lib/validation/lead";
import type { PrismaClientOrTx } from "./types";

/**
 * Calendar V1 — read-side queries. Every list here is bounded by an
 * explicit date range (locked architecture §15: "Do not fetch the
 * organization's entire CalendarEvent history for Month view") and
 * scoped by organizationId together with the relevant date filter —
 * never the organization's own entire table.
 */

export type CalendarEventWithRelations = CalendarEvent & {
  client: { id: string; name: string } | null;
  lead: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  assignedToUser: { id: string; name: string } | null;
  createdByUser: { id: string; name: string };
};

const WITH_RELATIONS = {
  client: { select: { id: true, name: true } },
  lead: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  assignedToUser: { select: { id: true, name: true } },
  createdByUser: { select: { id: true, name: true } },
};

/**
 * Reads OrganizationProfile.timezone — the authoritative IANA zone for
 * every timed CalendarEvent in this organization (locked architecture
 * §8). OrganizationProfile is itself an entirely optional row (see its
 * own schema doc comment: "no row = not set up yet") — when it doesn't
 * exist, or exists with no timezone set (schema requires it once the row
 * exists, but this is defensive), the locked fallback is "UTC", exactly
 * matching this app's own "no row = default/not-yet-acted" convention
 * for NotificationPreference/OrganizationOnboardingStep. This is the one
 * piece of I/O src/lib/calendar-events/timezone.ts's own pure resolver
 * needs — every caller fetches it here, never inline.
 */
export async function getOrganizationTimezone(organizationId: string): Promise<string> {
  const profile = await prisma.organizationProfile.findUnique({
    where: { organizationId },
    select: { timezone: true },
  });
  return profile?.timezone ?? "UTC";
}

export type AssignableMember = { id: string; name: string };

/**
 * Every current Membership's own User, for the assignee picker (locked
 * architecture §24: "must only offer current members of the
 * organization... Do not expose Platform users from another
 * organization"). Same `prisma.membership.findMany({where:
 * {organizationId}, include: {user}})` shape Team's own page.tsx already
 * uses for its member list.
 */
export async function listAssignableMembers(organizationId: string): Promise<AssignableMember[]> {
  const memberships = await prisma.membership.findMany({
    where: { organizationId },
    orderBy: { user: { name: "asc" } },
    select: { user: { select: { id: true, name: true } } },
  });
  return memberships.map((m) => m.user);
}

export type CalendarEventRangeFilters = {
  /** LOCKED semantics (§23): assignedToUserId === this exact user id. Never "created by me but unassigned". */
  assignedToUserId?: string;
};

/**
 * The bounded Month/Agenda manual-event query (locked architecture §15).
 * `from`/`to` are real UTC instants (already resolved from whichever
 * calendar-grid boundary the caller is rendering) — `startsAt` is
 * compared directly against them, which is correct for both timed
 * events (a real instant) and all-day events (UTC-midnight on their own
 * named calendar date, so a range aligned to UTC-midnight boundaries
 * still includes every all-day event that falls within it). Excludes
 * archived by default — there is no Portal archive-toggle-equivalent
 * for Calendar; archived events are a separate, deliberately distinct
 * query (see listArchivedCalendarEventsForRange below).
 */
export async function listCalendarEventsForRange(
  organizationId: string,
  range: { from: Date; to: Date },
  filters: CalendarEventRangeFilters = {},
): Promise<CalendarEventWithRelations[]> {
  return prisma.calendarEvent.findMany({
    where: {
      organizationId,
      archivedAt: null,
      startsAt: { gte: range.from, lt: range.to },
      ...(filters.assignedToUserId ? { assignedToUserId: filters.assignedToUserId } : {}),
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    include: WITH_RELATIONS,
  });
}

/** The archived-events view (locked architecture §22: "a minimal way to view/restore archived events... a query-param archived view/list is acceptable"). Also bounded by the same range — archived events are never fetched without limit either. */
export async function listArchivedCalendarEventsForRange(
  organizationId: string,
  range: { from: Date; to: Date },
): Promise<CalendarEventWithRelations[]> {
  return prisma.calendarEvent.findMany({
    where: { organizationId, archivedAt: { not: null }, startsAt: { gte: range.from, lt: range.to } },
    orderBy: [{ startsAt: "desc" }, { id: "asc" }],
    include: WITH_RELATIONS,
  });
}

/**
 * For Staff management (view/edit/archive/restore) — returned regardless
 * of archivedAt (an archive/restore action must still be able to look up
 * an already-archived row). Mirrors getContractForStaff's own exact
 * isUuid()-guarded, organizationId-scoped shape.
 */
export async function getCalendarEventForStaff(
  organizationId: string,
  eventId: string,
  client: PrismaClientOrTx = prisma,
): Promise<CalendarEventWithRelations | null> {
  if (!isUuid(eventId)) return null;
  return client.calendarEvent.findFirst({
    where: { id: eventId, organizationId },
    include: WITH_RELATIONS,
  });
}

// ---------------------------------------------------------------------------
// Invoice due-date overlay (locked architecture §16) — read-only,
// query-time only, never copied into a CalendarEvent row.
// ---------------------------------------------------------------------------

// Which Invoice statuses represent a real, currently-meaningful due-date
// commitment worth surfacing on the Calendar (inspected directly against
// InvoiceStatus's own five values, never guessed):
//   DRAFT     — excluded. Not yet issued/sent to the client; its own
//               dueDate is not a live commitment yet and may still
//               change before the real SEND (mirrors this app's own
//               "a DRAFT document is Staff-only, not a real external
//               commitment yet" rule already established for Quote/
//               Contract/Portal-visible Invoice statuses).
//   SENT      — included. The core case: an issued, outstanding invoice
//               with a real due date.
//   OVERDUE   — included. The Dashboard's own "Overdue items" widget
//               already treats this as the one real overdue signal
//               (never a re-derived "dueDate < now" check) — the
//               Calendar overlay surfaces the same real due date.
//   PAID      — included. The commitment already resolved, but the due
//               date remains meaningful historical context on the
//               Calendar (a Staff member reviewing a past month should
//               still see what was due and that it was paid) — matches
//               VISIBLE_PORTAL_STATUSES's own inclusion of PAID.
//   CANCELLED — excluded, matching this task's own explicit "VOID/
//               CANCELLED equivalents should be excluded" instruction —
//               a cancelled invoice's due date is no longer a real
//               commitment of any kind, and showing it on the Calendar
//               would be actively misleading, unlike PAID.
const INVOICE_DUE_OVERLAY_STATUSES = ["SENT", "OVERDUE", "PAID"] as const;

export type InvoiceDueOverlayItem = {
  id: string;
  invoiceNumber: string;
  dueDate: Date;
  status: (typeof INVOICE_DUE_OVERLAY_STATUSES)[number];
  clientName: string | null;
};

/**
 * Organization-scoped only (locked architecture §16/§28: no Portal
 * involvement of any kind) — a foreign organization's Invoice is simply
 * never selected by this `where`, not filtered out afterward.
 */
export async function listInvoiceDueOverlayForRange(
  organizationId: string,
  range: { from: Date; to: Date },
): Promise<InvoiceDueOverlayItem[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId,
      dueDate: { gte: range.from, lt: range.to },
      status: { in: [...INVOICE_DUE_OVERLAY_STATUSES] },
    },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    select: { id: true, invoiceNumber: true, dueDate: true, status: true, client: { select: { name: true } } },
  });

  return invoices.map((invoice) => ({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    // dueDate is never null here -- the `where` clause's own
    // `dueDate: { gte, lt }` range comparison already excludes null
    // (Prisma/Postgres: `NULL >= x` is never true), so this cast only
    // narrows a type Prisma itself still reports as nullable.
    dueDate: invoice.dueDate as Date,
    status: invoice.status as (typeof INVOICE_DUE_OVERLAY_STATUSES)[number],
    clientName: invoice.client?.name ?? null,
  }));
}
