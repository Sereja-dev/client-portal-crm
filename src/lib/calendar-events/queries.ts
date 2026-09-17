import "server-only";
import { prisma } from "@/lib/prisma";
import type { CalendarEvent } from "@/generated/prisma/client";
import { isUuid } from "@/lib/validation/lead";
import { formatDateOnly } from "@/lib/invoices/date-only";
import { toWallClockInputValues } from "./timezone";
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
 * One calendar-day guard on each side of the requested visible range, used
 * only to widen the DB-level candidate fetch for TIMED events (Calendar
 * Range Boundary Fix). A timed event's `startsAt` is a real UTC instant,
 * but which organization-LOCAL calendar date it belongs to can differ from
 * its own UTC date by at most one day in either direction, for any real
 * IANA zone (the largest UTC offsets are ±14:00, well under 24h) — so a
 * ±24h widened fetch is always a safe superset. This is still a bounded
 * query, never an unbounded one: it grows the requested range by exactly
 * two fixed days, regardless of how wide the requested range itself is.
 */
const LOCAL_DATE_GUARD_MS = 24 * 60 * 60 * 1000;

/**
 * Locked design (Calendar Range Boundary Fix): a timed CalendarEvent
 * belongs to the organization-LOCAL calendar date its `startsAt` falls on
 * (via the same centralized timezone helper used for display), never the
 * raw UTC date. `fromDateKey`/`toDateKey` are the requested visible
 * range's own date-only boundaries ("YYYY-MM-DD"), `fromDateKey` inclusive
 * and `toDateKey` exclusive — comparing plain padded strings is a correct,
 * deterministic stand-in for date-only comparison here.
 */
function isTimedEventInLocalRange(startsAt: Date, timezone: string, fromDateKey: string, toDateKey: string): boolean {
  const localDate = toWallClockInputValues(startsAt, timezone).date;
  return localDate >= fromDateKey && localDate < toDateKey;
}

function byStartsAtThenId(direction: "asc" | "desc") {
  return (a: CalendarEventWithRelations, b: CalendarEventWithRelations): number => {
    const diff = a.startsAt.getTime() - b.startsAt.getTime();
    const ordered = direction === "asc" ? diff : -diff;
    if (ordered !== 0) return ordered;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

/**
 * The bounded Month/Agenda manual-event query (locked architecture §15),
 * corrected by the Calendar Range Boundary Fix to distinguish two
 * genuinely different semantics that a single raw `startsAt: {gte, lt}`
 * filter previously conflated:
 *
 * - All-day events: `startsAt` is already a timezone-agnostic UTC-midnight
 *   date-only value (src/lib/invoices/date-only.ts's own convention) — the
 *   exact same `range.from`/`range.to` date-only boundaries used to build
 *   this request correctly select them directly, with no timezone
 *   conversion at all (organization timezone must never shift an all-day
 *   event onto a different date).
 * - Timed events: `startsAt` is a real UTC instant, and which calendar
 *   date it belongs to depends on `timezone` (locked architecture §8/§10)
 *   — a raw UTC-date-aligned filter mis-files any timed event whose local
 *   date differs from its UTC date (e.g. a late-night America/Los_Angeles
 *   or early-morning Asia/Bangkok event near a month boundary). Fixed by
 *   fetching a ±24h widened candidate set (`LOCAL_DATE_GUARD_MS`), then
 *   keeping only the candidates whose organization-LOCAL date actually
 *   falls in the requested range (`isTimedEventInLocalRange`).
 *
 * The two result sets are fetched independently, then merged and
 * re-sorted in application code (`byStartsAtThenId`) to reproduce the
 * original single-query `orderBy` exactly. Excludes archived by default —
 * there is no Portal archive-toggle-equivalent for Calendar; archived
 * events are a separate, deliberately distinct query (see
 * listArchivedCalendarEventsForRange below, which shares this same fix).
 */
export async function listCalendarEventsForRange(
  organizationId: string,
  range: { from: Date; to: Date },
  timezone: string,
  filters: CalendarEventRangeFilters = {},
): Promise<CalendarEventWithRelations[]> {
  const fromDateKey = formatDateOnly(range.from);
  const toDateKey = formatDateOnly(range.to);
  const guardFrom = new Date(range.from.getTime() - LOCAL_DATE_GUARD_MS);
  const guardTo = new Date(range.to.getTime() + LOCAL_DATE_GUARD_MS);
  const assigneeWhere = filters.assignedToUserId ? { assignedToUserId: filters.assignedToUserId } : {};

  const [allDayEvents, timedCandidates] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { organizationId, archivedAt: null, allDay: true, startsAt: { gte: range.from, lt: range.to }, ...assigneeWhere },
      include: WITH_RELATIONS,
    }),
    prisma.calendarEvent.findMany({
      where: { organizationId, archivedAt: null, allDay: false, startsAt: { gte: guardFrom, lt: guardTo }, ...assigneeWhere },
      include: WITH_RELATIONS,
    }),
  ]);

  const timedEvents = timedCandidates.filter((event) => isTimedEventInLocalRange(event.startsAt, timezone, fromDateKey, toDateKey));

  return [...allDayEvents, ...timedEvents].sort(byStartsAtThenId("asc"));
}

/**
 * The archived-events view (locked architecture §22: "a minimal way to
 * view/restore archived events... a query-param archived view/list is
 * acceptable"). Also bounded by the same range — archived events are
 * never fetched without limit either. Shares the exact same all-day/timed
 * distinction as listCalendarEventsForRange above (Calendar Range
 * Boundary Fix) — an archived timed event near a month boundary is
 * exactly as susceptible to the same UTC-vs-organization-local mismatch.
 */
export async function listArchivedCalendarEventsForRange(
  organizationId: string,
  range: { from: Date; to: Date },
  timezone: string,
): Promise<CalendarEventWithRelations[]> {
  const fromDateKey = formatDateOnly(range.from);
  const toDateKey = formatDateOnly(range.to);
  const guardFrom = new Date(range.from.getTime() - LOCAL_DATE_GUARD_MS);
  const guardTo = new Date(range.to.getTime() + LOCAL_DATE_GUARD_MS);

  const [allDayEvents, timedCandidates] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { organizationId, archivedAt: { not: null }, allDay: true, startsAt: { gte: range.from, lt: range.to } },
      include: WITH_RELATIONS,
    }),
    prisma.calendarEvent.findMany({
      where: { organizationId, archivedAt: { not: null }, allDay: false, startsAt: { gte: guardFrom, lt: guardTo } },
      include: WITH_RELATIONS,
    }),
  ]);

  const timedEvents = timedCandidates.filter((event) => isTimedEventInLocalRange(event.startsAt, timezone, fromDateKey, toDateKey));

  return [...allDayEvents, ...timedEvents].sort(byStartsAtThenId("desc"));
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
