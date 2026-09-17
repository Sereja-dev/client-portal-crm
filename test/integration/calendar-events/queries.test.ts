import { describe, expect, it, vi, beforeAll, afterAll, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCalendarEvent } from "@/lib/calendar-events/service";
import { listCalendarEventsForRange, listArchivedCalendarEventsForRange, listInvoiceDueOverlayForRange } from "@/lib/calendar-events/queries";
import { resolveWallClockToInstant, type WallClockDateTime } from "@/lib/calendar-events/timezone";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actorFor, timedEventInput } from "./helpers";

/** Calendar V1 §34 — range-query and Invoice-overlay coverage (items 22-26). */
describe("Calendar V1 — queries", () => {
  let fixtures: TestFixtures;
  let eventIds: string[] = [];
  let invoiceIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    if (eventIds.length > 0) {
      await prisma.calendarEvent.deleteMany({ where: { id: { in: eventIds } } });
      eventIds = [];
    }
    if (invoiceIds.length > 0) {
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      invoiceIds = [];
    }
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  const owner = () => actorFor(fixtures.owner, "OWNER");
  const JUNE_RANGE = { from: new Date("2026-06-01T00:00:00.000Z"), to: new Date("2026-07-01T00:00:00.000Z") };

  it("22. a bounded month range returns only events within it", async () => {
    const inRange = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ date: "2026-06-15" }));
    const outOfRange = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ date: "2026-08-15" }));
    if (!inRange.ok || !outOfRange.ok) throw new Error("fixture setup failed");
    eventIds.push(inRange.event.id, outOfRange.event.id);

    const results = await listCalendarEventsForRange(fixtures.orgA.id, JUNE_RANGE, "UTC");
    expect(results.some((e) => e.id === inRange.event.id)).toBe(true);
    expect(results.some((e) => e.id === outOfRange.event.id)).toBe(false);
  });

  it("23. a month-boundary event (last day of month, last moment before the range ends) is correctly included/excluded", async () => {
    const lastDayOfJune = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ date: "2026-06-30", startTime: "23:00" }));
    const firstDayOfJuly = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ date: "2026-07-01", startTime: "00:00" }));
    if (!lastDayOfJune.ok || !firstDayOfJuly.ok) throw new Error("fixture setup failed");
    eventIds.push(lastDayOfJune.event.id, firstDayOfJuly.event.id);

    const results = await listCalendarEventsForRange(fixtures.orgA.id, JUNE_RANGE, "UTC");
    expect(results.some((e) => e.id === lastDayOfJune.event.id)).toBe(true);
    expect(results.some((e) => e.id === firstDayOfJuly.event.id)).toBe(false);
  });

  it("assignee filter narrows to the exact assignedToUserId (locked 'My events' semantics)", async () => {
    const mine = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ date: "2026-06-10", assignedToUserId: fixtures.owner.id }));
    const unassigned = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ date: "2026-06-11" }));
    if (!mine.ok || !unassigned.ok) throw new Error("fixture setup failed");
    eventIds.push(mine.event.id, unassigned.event.id);

    const results = await listCalendarEventsForRange(fixtures.orgA.id, JUNE_RANGE, "UTC", { assignedToUserId: fixtures.owner.id });
    expect(results.some((e) => e.id === mine.event.id)).toBe(true);
    // "created by me but unassigned" must NEVER match the filter (locked semantics).
    expect(results.some((e) => e.id === unassigned.event.id)).toBe(false);
  });

  /**
   * Calendar Range Boundary Fix — the requested visible Calendar range is
   * always a canonical date-only interval: `fromDate` inclusive, `toDate`
   * exclusive (the locked design's own "canonicalDateOnlyFrom"/
   * "canonicalDateOnlyTo" terminology). Built here directly from the
   * calendar month's own first-of-month/first-of-next-month boundaries
   * (UTC-midnight date-only Dates, matching src/lib/invoices/date-only.ts's
   * own convention) rather than through buildMonthGrid's own Month-view
   * grid, which pads out to whole weeks with leading/trailing spillover
   * days from adjacent months — a Month-view UI-rendering detail that
   * would otherwise let incidental spillover margin accidentally include
   * a boundary event regardless of whether the underlying query fix is
   * correct, exactly the "do not rely on incidental month-grid spillover"
   * anti-pattern the locked design calls out.
   */
  function monthRange(year: number, month: number): { from: Date; to: Date } {
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
    return { from, to };
  }

  /** Resolves `wall` in `timezone` via the real resolver and fails loudly if it isn't a plain unambiguous instant -- every boundary case below is deliberately chosen to be unambiguous. */
  function resolveOrThrow(wall: WallClockDateTime, timezone: string): Date {
    const result = resolveWallClockToInstant(wall, timezone);
    if (!result.ok) throw new Error(`expected an unambiguous instant for ${JSON.stringify(wall)} in ${timezone}, got ${result.reason}`);
    return result.instant;
  }

  async function insertTimedEvent(organizationId: string, startsAt: Date, title: string): Promise<string> {
    const event = await prisma.calendarEvent.create({
      data: { organizationId, title, allDay: false, startsAt, createdByUserId: fixtures.owner.id },
    });
    eventIds.push(event.id);
    return event.id;
  }

  async function insertAllDayEvent(organizationId: string, startsAt: Date, title: string): Promise<string> {
    const event = await prisma.calendarEvent.create({
      data: { organizationId, title, allDay: true, startsAt, createdByUserId: fixtures.owner.id },
    });
    eventIds.push(event.id);
    return event.id;
  }

  describe("Calendar Range Boundary Fix — organization-local timed-event month inclusion", () => {
    it("America/Los_Angeles: a 23:45-local event on Jan 31 (stored as 2026-02-01T07:45:00Z) is included when browsing January", async () => {
      const instant = resolveOrThrow({ year: 2026, month: 1, day: 31, hour: 23, minute: 45 }, "America/Los_Angeles");
      expect(instant.toISOString()).toBe("2026-02-01T07:45:00.000Z"); // sanity-check the stated blocker's own numbers
      const id = await insertTimedEvent(fixtures.orgA.id, instant, "LA late-night kickoff");

      const results = await listCalendarEventsForRange(fixtures.orgA.id, monthRange(2026, 1), "America/Los_Angeles");
      expect(results.some((e) => e.id === id)).toBe(true);
    });

    it("America/Los_Angeles: the same Jan-31-local event must NOT appear when browsing February (its UTC date)", async () => {
      const instant = resolveOrThrow({ year: 2026, month: 1, day: 31, hour: 23, minute: 45 }, "America/Los_Angeles");
      const id = await insertTimedEvent(fixtures.orgA.id, instant, "LA late-night kickoff");

      const results = await listCalendarEventsForRange(fixtures.orgA.id, monthRange(2026, 2), "America/Los_Angeles");
      expect(results.some((e) => e.id === id)).toBe(false);
    });

    it("Asia/Bangkok: a 00:15-local event on Oct 1 (stored on the previous UTC date) is included when browsing October", async () => {
      const instant = resolveOrThrow({ year: 2026, month: 10, day: 1, hour: 0, minute: 15 }, "Asia/Bangkok");
      expect(instant.toISOString()).toBe("2026-09-30T17:15:00.000Z");
      const id = await insertTimedEvent(fixtures.orgA.id, instant, "Bangkok early-morning standup");

      const results = await listCalendarEventsForRange(fixtures.orgA.id, monthRange(2026, 10), "Asia/Bangkok");
      expect(results.some((e) => e.id === id)).toBe(true);
    });

    it("Asia/Bangkok: the same Oct-1-local event must NOT appear when browsing September (its UTC date)", async () => {
      const instant = resolveOrThrow({ year: 2026, month: 10, day: 1, hour: 0, minute: 15 }, "Asia/Bangkok");
      const id = await insertTimedEvent(fixtures.orgA.id, instant, "Bangkok early-morning standup");

      const results = await listCalendarEventsForRange(fixtures.orgA.id, monthRange(2026, 9), "Asia/Bangkok");
      expect(results.some((e) => e.id === id)).toBe(false);
    });

    it("UTC organization: a month-boundary event's inclusion is unaffected by this fix (zero offset, guard widening is a no-op on the result)", async () => {
      const instant = resolveOrThrow({ year: 2026, month: 12, day: 31, hour: 23, minute: 45 }, "UTC");
      const id = await insertTimedEvent(fixtures.orgA.id, instant, "UTC year-end wrap-up");

      const decResults = await listCalendarEventsForRange(fixtures.orgA.id, monthRange(2026, 12), "UTC");
      expect(decResults.some((e) => e.id === id)).toBe(true);
      const janResults = await listCalendarEventsForRange(fixtures.orgA.id, monthRange(2027, 1), "UTC");
      expect(janResults.some((e) => e.id === id)).toBe(false);
    });

    it("Asia/Kathmandu (+05:45, no DST): a just-after-midnight event on May 1 (stored on the previous UTC date) belongs to May, not April", async () => {
      const instant = resolveOrThrow({ year: 2026, month: 5, day: 1, hour: 0, minute: 15 }, "Asia/Kathmandu");
      const id = await insertTimedEvent(fixtures.orgA.id, instant, "Kathmandu month-start check-in");

      const aprilResults = await listCalendarEventsForRange(fixtures.orgA.id, monthRange(2026, 4), "Asia/Kathmandu");
      expect(aprilResults.some((e) => e.id === id)).toBe(false);
      const mayResults = await listCalendarEventsForRange(fixtures.orgA.id, monthRange(2026, 5), "Asia/Kathmandu");
      expect(mayResults.some((e) => e.id === id)).toBe(true);
    });

    it("Australia/Adelaide (+10:30 DST): a just-after-midnight event on Nov 1 (stored on the previous UTC date) belongs to November, not October", async () => {
      const instant = resolveOrThrow({ year: 2026, month: 11, day: 1, hour: 0, minute: 15 }, "Australia/Adelaide");
      const id = await insertTimedEvent(fixtures.orgA.id, instant, "Adelaide month-start check-in");

      const octResults = await listCalendarEventsForRange(fixtures.orgA.id, monthRange(2026, 10), "Australia/Adelaide");
      expect(octResults.some((e) => e.id === id)).toBe(false);
      const novResults = await listCalendarEventsForRange(fixtures.orgA.id, monthRange(2026, 11), "Australia/Adelaide");
      expect(novResults.some((e) => e.id === id)).toBe(true);
    });

    it("Australia/Lord_Howe (+11:00 DST, the 30-minute-shift zone): a just-after-midnight event on Nov 1 (stored on the previous UTC date) belongs to November, not October", async () => {
      const instant = resolveOrThrow({ year: 2026, month: 11, day: 1, hour: 0, minute: 15 }, "Australia/Lord_Howe");
      const id = await insertTimedEvent(fixtures.orgA.id, instant, "Lord Howe month-start check-in");

      const octResults = await listCalendarEventsForRange(fixtures.orgA.id, monthRange(2026, 10), "Australia/Lord_Howe");
      expect(octResults.some((e) => e.id === id)).toBe(false);
      const novResults = await listCalendarEventsForRange(fixtures.orgA.id, monthRange(2026, 11), "Australia/Lord_Howe");
      expect(novResults.some((e) => e.id === id)).toBe(true);
    });

    it("an all-day event on Jan 31 stays on Jan 31 regardless of organization timezone -- never migrates to February", async () => {
      const startsAt = new Date(Date.UTC(2026, 0, 31));
      const laId = await insertAllDayEvent(fixtures.orgA.id, startsAt, "All-day (checked as LA)");

      for (const timezone of ["America/Los_Angeles", "Asia/Bangkok", "UTC"]) {
        const januaryResults = await listCalendarEventsForRange(fixtures.orgA.id, monthRange(2026, 1), timezone);
        expect(januaryResults.some((e) => e.id === laId), `all-day Jan 31 event missing from January under ${timezone}`).toBe(true);
        const februaryResults = await listCalendarEventsForRange(fixtures.orgA.id, monthRange(2026, 2), timezone);
        expect(februaryResults.some((e) => e.id === laId), `all-day Jan 31 event wrongly appeared in February under ${timezone}`).toBe(false);
      }
    });

    it("Archived view: the same organization-local fix applies to listArchivedCalendarEventsForRange", async () => {
      const instant = resolveOrThrow({ year: 2026, month: 1, day: 31, hour: 23, minute: 45 }, "America/Los_Angeles");
      const id = await insertTimedEvent(fixtures.orgA.id, instant, "LA late-night kickoff (archived)");
      await prisma.calendarEvent.update({ where: { id }, data: { archivedAt: new Date() } });

      const januaryResults = await listArchivedCalendarEventsForRange(fixtures.orgA.id, monthRange(2026, 1), "America/Los_Angeles");
      expect(januaryResults.some((e) => e.id === id)).toBe(true);
      const februaryResults = await listArchivedCalendarEventsForRange(fixtures.orgA.id, monthRange(2026, 2), "America/Los_Angeles");
      expect(februaryResults.some((e) => e.id === id)).toBe(false);
    });

    it("boundedness: the timed-candidate DB fetch widens the requested range by exactly +/-24h, never an unbounded window", async () => {
      const spy = vi.spyOn(prisma.calendarEvent, "findMany");
      try {
        const range = monthRange(2026, 6);
        await listCalendarEventsForRange(fixtures.orgA.id, range, "America/Los_Angeles");

        const timedCall = spy.mock.calls.find((call) => {
          const where = (call[0] as { where?: { allDay?: boolean } })?.where;
          return where?.allDay === false;
        });
        expect(timedCall).toBeDefined();
        const where = (timedCall![0] as { where: { startsAt: { gte: Date; lt: Date } } }).where;
        const guardMs = 24 * 60 * 60 * 1000;
        expect(where.startsAt.gte.getTime()).toBe(range.from.getTime() - guardMs);
        expect(where.startsAt.lt.getTime()).toBe(range.to.getTime() + guardMs);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("Invoice due-date overlay", () => {
    async function seedInvoice(overrides: Record<string, unknown>) {
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber: `CAL-TEST-${Math.random().toString(36).slice(2, 10)}`,
          status: "SENT",
          amount: "100.00",
          subtotal: "100.00",
          discountAmount: "0.00",
          taxAmount: "0.00",
          issueDate: new Date("2026-06-01T00:00:00.000Z"),
          dueDate: new Date("2026-06-15T00:00:00.000Z"),
          clientId: fixtures.clientA.id,
          organizationId: fixtures.orgA.id,
          ...overrides,
        },
      });
      invoiceIds.push(invoice.id);
      return invoice;
    }

    it("24. the overlay is organization-scoped -- only the current org's own invoices appear", async () => {
      const own = await seedInvoice({});
      const results = await listInvoiceDueOverlayForRange(fixtures.orgA.id, JUNE_RANGE);
      expect(results.some((i) => i.id === own.id)).toBe(true);
    });

    it("25. a foreign organization's Invoice is absent from the overlay", async () => {
      const foreignInvoice = await prisma.invoice.create({
        data: {
          invoiceNumber: `CAL-TEST-FOREIGN-${Math.random().toString(36).slice(2, 10)}`,
          status: "SENT",
          amount: "100.00",
          subtotal: "100.00",
          discountAmount: "0.00",
          taxAmount: "0.00",
          issueDate: new Date("2026-06-01T00:00:00.000Z"),
          dueDate: new Date("2026-06-15T00:00:00.000Z"),
          clientId: fixtures.clientB.id,
          organizationId: fixtures.orgB.id,
        },
      });
      invoiceIds.push(foreignInvoice.id);

      const results = await listInvoiceDueOverlayForRange(fixtures.orgA.id, JUNE_RANGE);
      expect(results.some((i) => i.id === foreignInvoice.id)).toBe(false);
    });

    it("26. the overlay's own dueDate is unchanged by timezone -- the exact stored date-only instant is returned, never shifted", async () => {
      const invoice = await seedInvoice({ dueDate: new Date("2026-06-20T00:00:00.000Z") });
      const results = await listInvoiceDueOverlayForRange(fixtures.orgA.id, JUNE_RANGE);
      const found = results.find((i) => i.id === invoice.id);
      expect(found?.dueDate.toISOString()).toBe("2026-06-20T00:00:00.000Z");
    });

    it("DRAFT invoices are excluded from the overlay", async () => {
      const draft = await seedInvoice({ status: "DRAFT" });
      const results = await listInvoiceDueOverlayForRange(fixtures.orgA.id, JUNE_RANGE);
      expect(results.some((i) => i.id === draft.id)).toBe(false);
    });

    it("CANCELLED invoices are excluded from the overlay", async () => {
      const cancelled = await seedInvoice({ status: "CANCELLED" });
      const results = await listInvoiceDueOverlayForRange(fixtures.orgA.id, JUNE_RANGE);
      expect(results.some((i) => i.id === cancelled.id)).toBe(false);
    });

    it("SENT, OVERDUE, and PAID invoices are all included in the overlay", async () => {
      const sent = await seedInvoice({ status: "SENT" });
      const overdue = await seedInvoice({ status: "OVERDUE" });
      const paid = await seedInvoice({ status: "PAID", paidAt: new Date("2026-06-10T00:00:00.000Z") });
      const results = await listInvoiceDueOverlayForRange(fixtures.orgA.id, JUNE_RANGE);
      expect(results.some((i) => i.id === sent.id)).toBe(true);
      expect(results.some((i) => i.id === overdue.id)).toBe(true);
      expect(results.some((i) => i.id === paid.id)).toBe(true);
    });

    it("Calendar Range Boundary Fix: a Dec-31 dueDate stays in December (never shifted by organization timezone -- this overlay takes no timezone parameter at all)", async () => {
      const decInvoice = await seedInvoice({ dueDate: new Date("2026-12-31T00:00:00.000Z") });
      const janInvoice = await seedInvoice({ dueDate: new Date("2027-01-01T00:00:00.000Z") });

      const decResults = await listInvoiceDueOverlayForRange(fixtures.orgA.id, { from: new Date("2026-12-01T00:00:00.000Z"), to: new Date("2027-01-01T00:00:00.000Z") });
      expect(decResults.some((i) => i.id === decInvoice.id)).toBe(true);
      expect(decResults.some((i) => i.id === janInvoice.id)).toBe(false);
    });
  });
});
