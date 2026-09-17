import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCalendarEvent } from "@/lib/calendar-events/service";
import { listCalendarEventsForRange, listInvoiceDueOverlayForRange } from "@/lib/calendar-events/queries";
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

    const results = await listCalendarEventsForRange(fixtures.orgA.id, JUNE_RANGE);
    expect(results.some((e) => e.id === inRange.event.id)).toBe(true);
    expect(results.some((e) => e.id === outOfRange.event.id)).toBe(false);
  });

  it("23. a month-boundary event (last day of month, last moment before the range ends) is correctly included/excluded", async () => {
    const lastDayOfJune = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ date: "2026-06-30", startTime: "23:00" }));
    const firstDayOfJuly = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ date: "2026-07-01", startTime: "00:00" }));
    if (!lastDayOfJune.ok || !firstDayOfJuly.ok) throw new Error("fixture setup failed");
    eventIds.push(lastDayOfJune.event.id, firstDayOfJuly.event.id);

    const results = await listCalendarEventsForRange(fixtures.orgA.id, JUNE_RANGE);
    expect(results.some((e) => e.id === lastDayOfJune.event.id)).toBe(true);
    expect(results.some((e) => e.id === firstDayOfJuly.event.id)).toBe(false);
  });

  it("assignee filter narrows to the exact assignedToUserId (locked 'My events' semantics)", async () => {
    const mine = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ date: "2026-06-10", assignedToUserId: fixtures.owner.id }));
    const unassigned = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ date: "2026-06-11" }));
    if (!mine.ok || !unassigned.ok) throw new Error("fixture setup failed");
    eventIds.push(mine.event.id, unassigned.event.id);

    const results = await listCalendarEventsForRange(fixtures.orgA.id, JUNE_RANGE, { assignedToUserId: fixtures.owner.id });
    expect(results.some((e) => e.id === mine.event.id)).toBe(true);
    // "created by me but unassigned" must NEVER match the filter (locked semantics).
    expect(results.some((e) => e.id === unassigned.event.id)).toBe(false);
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
  });
});
