import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createCalendarEvent,
  updateCalendarEvent,
  archiveCalendarEvent,
  restoreCalendarEvent,
} from "@/lib/calendar-events/service";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actorFor, allDayEventInput, timedEventInput } from "./helpers";

/**
 * Calendar V1 §34 — service-layer integration tests (items 1-21, 27-29).
 * Range-query and Invoice-overlay coverage (items 22-26) lives in
 * queries.test.ts alongside it.
 */
describe("Calendar V1 — service", () => {
  let fixtures: TestFixtures;
  let eventIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    if (eventIds.length > 0) {
      await prisma.calendarEvent.deleteMany({ where: { id: { in: eventIds } } });
      eventIds = [];
    }
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  const owner = () => actorFor(fixtures.owner, "OWNER");
  const admin = () => actorFor(fixtures.admin, "ADMIN");
  const member = () => actorFor(fixtures.member, "MEMBER");

  async function track(id: string) {
    eventIds.push(id);
    return id;
  }

  describe("create — every role", () => {
    it("1. OWNER creates a timed event", async () => {
      const result = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput());
      expect(result.ok).toBe(true);
      if (result.ok) await track(result.event.id);
    });

    it("2. ADMIN creates a timed event", async () => {
      const result = await createCalendarEvent(fixtures.orgA.id, admin(), timedEventInput());
      expect(result.ok).toBe(true);
      if (result.ok) await track(result.event.id);
    });

    it("3. MEMBER creates a timed event", async () => {
      const result = await createCalendarEvent(fixtures.orgA.id, member(), timedEventInput());
      expect(result.ok).toBe(true);
      if (result.ok) await track(result.event.id);
    });

    it("4. an all-day event can be created and read back with the exact same calendar date", async () => {
      const result = await createCalendarEvent(fixtures.orgA.id, owner(), allDayEventInput({ date: "2026-07-04" }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        await track(result.event.id);
        expect(result.event.allDay).toBe(true);
        expect(result.event.endsAt).toBeNull();
        expect(result.event.startsAt.toISOString()).toBe("2026-07-04T00:00:00.000Z");
      }
    });

    it("5. a timed event stores the correct UTC instant derived from the organization's own timezone", async () => {
      await prisma.organizationProfile.create({
        data: { organizationId: fixtures.orgA.id, legalName: "Test Org A LLC", country: "US", currency: "USD", timezone: "America/New_York" },
      });
      try {
        const result = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ date: "2026-01-15", startTime: "14:00" }));
        expect(result.ok).toBe(true);
        if (result.ok) {
          await track(result.event.id);
          // EST (UTC-5) in January -- 14:00 local = 19:00 UTC.
          expect(result.event.startsAt.toISOString()).toBe("2026-01-15T19:00:00.000Z");
        }
      } finally {
        await prisma.organizationProfile.deleteMany({ where: { organizationId: fixtures.orgA.id } });
      }
    });

    it("6. an organization with no OrganizationProfile row falls back to UTC", async () => {
      // fixtures.orgA has no OrganizationProfile row by default (never
      // created by seedTestData) -- confirmed directly before proceeding,
      // not merely assumed.
      const profile = await prisma.organizationProfile.findUnique({ where: { organizationId: fixtures.orgA.id } });
      expect(profile).toBeNull();

      const result = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ date: "2026-01-15", startTime: "14:00" }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        await track(result.event.id);
        expect(result.event.startsAt.toISOString()).toBe("2026-01-15T14:00:00.000Z");
      }
    });

    it("7. a DST spring-forward nonexistent local time is rejected as a validation error, never silently normalized", async () => {
      await prisma.organizationProfile.create({
        data: { organizationId: fixtures.orgA.id, legalName: "Test Org A LLC", country: "US", currency: "USD", timezone: "America/New_York" },
      });
      try {
        const result = await createCalendarEvent(
          fixtures.orgA.id,
          owner(),
          timedEventInput({ date: "2026-03-08", startTime: "02:30" }),
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe("VALIDATION");
          if (result.reason === "VALIDATION") {
            expect(result.fieldErrors.startTime).toBeTruthy();
          }
        }
        expect(await prisma.calendarEvent.count({ where: { organizationId: fixtures.orgA.id, title: "Kickoff call" } })).toBe(0);
      } finally {
        await prisma.organizationProfile.deleteMany({ where: { organizationId: fixtures.orgA.id } });
      }
    });

    it("8. a DST fall-back ambiguous local time is rejected as a validation error, never silently resolved to either instant", async () => {
      await prisma.organizationProfile.create({
        data: { organizationId: fixtures.orgA.id, legalName: "Test Org A LLC", country: "US", currency: "USD", timezone: "America/New_York" },
      });
      try {
        const result = await createCalendarEvent(
          fixtures.orgA.id,
          owner(),
          timedEventInput({ date: "2026-11-01", startTime: "01:30" }),
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe("VALIDATION");
          if (result.reason === "VALIDATION") {
            expect(result.fieldErrors.startTime).toBeTruthy();
          }
        }
      } finally {
        await prisma.organizationProfile.deleteMany({ where: { organizationId: fixtures.orgA.id } });
      }
    });
  });

  describe("update", () => {
    it("9. updates an event's own fields", async () => {
      const created = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput());
      if (!created.ok) throw new Error("fixture setup failed");
      await track(created.event.id);

      const updated = await updateCalendarEvent(fixtures.orgA.id, created.event.id, owner(), timedEventInput({ title: "Renamed" }));
      expect(updated.ok).toBe(true);
      if (updated.ok) expect(updated.event.title).toBe("Renamed");
    });
  });

  describe("archive / restore", () => {
    it("10. archives an event", async () => {
      const created = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput());
      if (!created.ok) throw new Error("fixture setup failed");
      await track(created.event.id);

      const archived = await archiveCalendarEvent(fixtures.orgA.id, created.event.id, owner());
      expect(archived.ok).toBe(true);
      if (archived.ok) expect(archived.event.archivedAt).not.toBeNull();
    });

    it("11. an archived event is excluded from the normal (non-archived) range query", async () => {
      const created = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ date: "2026-06-01" }));
      if (!created.ok) throw new Error("fixture setup failed");
      await track(created.event.id);
      await archiveCalendarEvent(fixtures.orgA.id, created.event.id, owner());

      const { listCalendarEventsForRange } = await import("@/lib/calendar-events/queries");
      const results = await listCalendarEventsForRange(
        fixtures.orgA.id,
        { from: new Date("2026-05-01T00:00:00.000Z"), to: new Date("2026-07-01T00:00:00.000Z") },
        "UTC",
      );
      expect(results.some((e) => e.id === created.event.id)).toBe(false);
    });

    it("12. restores an archived event", async () => {
      const created = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput());
      if (!created.ok) throw new Error("fixture setup failed");
      await track(created.event.id);
      await archiveCalendarEvent(fixtures.orgA.id, created.event.id, owner());

      const restored = await restoreCalendarEvent(fixtures.orgA.id, created.event.id, owner());
      expect(restored.ok).toBe(true);
      if (restored.ok) expect(restored.event.archivedAt).toBeNull();
    });

    it("double archive is idempotent and writes no duplicate Activity row", async () => {
      const created = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput());
      if (!created.ok) throw new Error("fixture setup failed");
      await track(created.event.id);

      await archiveCalendarEvent(fixtures.orgA.id, created.event.id, owner());
      await archiveCalendarEvent(fixtures.orgA.id, created.event.id, owner());

      const archiveEvents = await prisma.activity.findMany({
        where: { organizationId: fixtures.orgA.id, entityType: "CALENDAR_EVENT", entityId: created.event.id, action: "UPDATED" },
      });
      const archivalRows = archiveEvents.filter((row) => {
        const metadata = row.metadata as { changedFields?: string[] } | null;
        return metadata?.changedFields?.includes("archivedAt");
      });
      expect(archivalRows).toHaveLength(1);
    });

    it("double restore is idempotent and safe", async () => {
      const created = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput());
      if (!created.ok) throw new Error("fixture setup failed");
      await track(created.event.id);
      await archiveCalendarEvent(fixtures.orgA.id, created.event.id, owner());

      const first = await restoreCalendarEvent(fixtures.orgA.id, created.event.id, owner());
      const second = await restoreCalendarEvent(fixtures.orgA.id, created.event.id, owner());
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (second.ok) expect(second.event.archivedAt).toBeNull();
    });
  });

  describe("tenant isolation", () => {
    it("13. a foreign-org event id is not found", async () => {
      const created = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput());
      if (!created.ok) throw new Error("fixture setup failed");
      await track(created.event.id);

      const result = await updateCalendarEvent(fixtures.orgB.id, created.event.id, actorFor(fixtures.orgBOwner, "OWNER"), timedEventInput());
      expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
    });

    it("14a. a malformed event id is not found, never throws", async () => {
      const result = await updateCalendarEvent(fixtures.orgA.id, "not-a-uuid", owner(), timedEventInput());
      expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
    });

    it("14b. a nonexistent event id is not found", async () => {
      const result = await updateCalendarEvent(fixtures.orgA.id, randomUUID(), owner(), timedEventInput());
      expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
    });
  });

  describe("target validation", () => {
    it("15. a foreign Client target is rejected", async () => {
      const result = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ targetType: "CLIENT", targetId: fixtures.clientB.id }));
      expect(result).toEqual({ ok: false, reason: "INVALID_TARGET" });
    });

    it("16. a foreign Lead target is rejected", async () => {
      const foreignLead = await prisma.lead.create({ data: { organizationId: fixtures.orgB.id, name: "Foreign Lead" } });
      try {
        const result = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ targetType: "LEAD", targetId: foreignLead.id }));
        expect(result).toEqual({ ok: false, reason: "INVALID_TARGET" });
      } finally {
        await prisma.lead.delete({ where: { id: foreignLead.id } });
      }
    });

    it("17. a foreign Project target is rejected", async () => {
      const result = await createCalendarEvent(
        fixtures.orgA.id,
        owner(),
        timedEventInput({ targetType: "PROJECT", targetId: randomUUID() }),
      );
      expect(result).toEqual({ ok: false, reason: "INVALID_TARGET" });
    });

    it("18a. an archived Client cannot be newly selected on create", async () => {
      const archivedClient = await prisma.client.create({
        data: { name: "Archived Client", organizationId: fixtures.orgA.id, userId: fixtures.owner.id, status: "ARCHIVED" },
      });
      try {
        const result = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ targetType: "CLIENT", targetId: archivedClient.id }));
        expect(result).toEqual({ ok: false, reason: "INVALID_TARGET" });
      } finally {
        await prisma.client.delete({ where: { id: archivedClient.id } });
      }
    });

    it("18b. an already-selected target may become archived without invalidating the existing event (unchanged-target skip)", async () => {
      const client = await prisma.client.create({ data: { name: "Soon Archived", organizationId: fixtures.orgA.id, userId: fixtures.owner.id } });
      try {
        const created = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ targetType: "CLIENT", targetId: client.id }));
        if (!created.ok) throw new Error("fixture setup failed");
        await track(created.event.id);

        await prisma.client.update({ where: { id: client.id }, data: { status: "ARCHIVED" } });

        // Editing the event WITHOUT changing the target must still succeed.
        const updated = await updateCalendarEvent(
          fixtures.orgA.id,
          created.event.id,
          owner(),
          timedEventInput({ title: "Renamed", targetType: "CLIENT", targetId: client.id }),
        );
        expect(updated.ok).toBe(true);

        // Changing to the SAME archived client from a currently-different
        // target would still be rejected -- covered by 18a's own create
        // case; this test only proves the unchanged-target retention.
      } finally {
        await prisma.client.delete({ where: { id: client.id } });
      }
    });

    it("19. multiple target ids cannot be constructed at all -- targetType structurally admits only one id", async () => {
      // parseCalendarEventInput's own shape has exactly one targetId
      // field, gated by exactly one targetType -- there is no code path
      // that could ever submit clientId+leadId+projectId simultaneously.
      // This test proves the structural guarantee by inspecting the
      // parsed shape directly, not by trying to smuggle extra ids
      // through JSON (there is no such vector).
      const { parseCalendarEventInput } = await import("@/lib/calendar-events/validation");
      const { values } = parseCalendarEventInput(
        timedEventInput({ targetType: "CLIENT", targetId: fixtures.clientA.id }) as never,
      );
      expect(values.targetType).toBe("CLIENT");
      expect(typeof values.targetId).toBe("string");
      // Only one id concept exists on the parsed shape at all.
      expect(Object.keys(values)).not.toContain("clientId");
      expect(Object.keys(values)).not.toContain("leadId");
      expect(Object.keys(values)).not.toContain("projectId");
    });
  });

  describe("assignee validation", () => {
    it("20. a foreign/non-member assignee is rejected", async () => {
      const result = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ assignedToUserId: fixtures.orgBOwner.id }));
      expect(result).toEqual({ ok: false, reason: "INVALID_ASSIGNEE" });
    });

    it("21. a valid same-org assignee is accepted", async () => {
      const result = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput({ assignedToUserId: fixtures.member.id }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        await track(result.event.id);
        expect(result.event.assignedToUserId).toBe(fixtures.member.id);
      }
    });
  });

  describe("Activity", () => {
    it("27. create writes a CREATED Activity row", async () => {
      const created = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput());
      if (!created.ok) throw new Error("fixture setup failed");
      await track(created.event.id);

      const activity = await prisma.activity.findFirst({
        where: { organizationId: fixtures.orgA.id, entityType: "CALENDAR_EVENT", entityId: created.event.id, action: "CREATED" },
      });
      expect(activity).not.toBeNull();
      expect(activity?.actorId).toBe(fixtures.owner.id);
      expect(activity?.metadata).toMatchObject({ name: "Kickoff call" });
    });

    it("28a. update writes an UPDATED Activity row with changedFields, only when something actually changed", async () => {
      const created = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput());
      if (!created.ok) throw new Error("fixture setup failed");
      await track(created.event.id);

      await updateCalendarEvent(fixtures.orgA.id, created.event.id, owner(), timedEventInput({ title: "Renamed" }));

      const activity = await prisma.activity.findFirst({
        where: { organizationId: fixtures.orgA.id, entityType: "CALENDAR_EVENT", entityId: created.event.id, action: "UPDATED" },
        orderBy: { createdAt: "desc" },
      });
      expect(activity).not.toBeNull();
      expect((activity?.metadata as { changedFields?: string[] })?.changedFields).toContain("title");
    });

    it("28b. a no-op update (identical values) writes no Activity row at all", async () => {
      const created = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput());
      if (!created.ok) throw new Error("fixture setup failed");
      await track(created.event.id);

      await updateCalendarEvent(fixtures.orgA.id, created.event.id, owner(), timedEventInput());

      const activityCount = await prisma.activity.count({
        where: { organizationId: fixtures.orgA.id, entityType: "CALENDAR_EVENT", entityId: created.event.id, action: "UPDATED" },
      });
      expect(activityCount).toBe(0);
    });

    it("28c. archive/restore write UPDATED + changedFields:['archivedAt'], the exact same convention Lead's own archive/unarchive already established", async () => {
      const created = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput());
      if (!created.ok) throw new Error("fixture setup failed");
      await track(created.event.id);

      await archiveCalendarEvent(fixtures.orgA.id, created.event.id, owner());
      await restoreCalendarEvent(fixtures.orgA.id, created.event.id, owner());

      const rows = await prisma.activity.findMany({
        where: { organizationId: fixtures.orgA.id, entityType: "CALENDAR_EVENT", entityId: created.event.id, action: "UPDATED" },
        orderBy: { createdAt: "asc" },
      });
      const archivalRows = rows.filter((row) => (row.metadata as { changedFields?: string[] })?.changedFields?.includes("archivedAt"));
      expect(archivalRows).toHaveLength(2);
    });

    it("29. no notification and no Workflow Automation side effect is ever produced for a CalendarEvent Activity", async () => {
      // notification-rules.ts's own RULES map and workflow-automations/
      // triggers.ts's own trigger allowlist both have zero CALENDAR_EVENT
      // entries (confirmed by direct source inspection) -- this proves
      // the observable consequence: creating/archiving a CalendarEvent
      // never produces a Notification row.
      const created = await createCalendarEvent(fixtures.orgA.id, owner(), timedEventInput());
      if (!created.ok) throw new Error("fixture setup failed");
      await track(created.event.id);
      await archiveCalendarEvent(fixtures.orgA.id, created.event.id, owner());

      const notificationCount = await prisma.notification.count({ where: { organizationId: fixtures.orgA.id } });
      expect(notificationCount).toBe(0);

      // Scoped to this org's own automations only -- a bare, unscoped
      // count() here would be sensitive to unrelated rows left behind by
      // other integration test files sharing the same ephemeral database.
      const workflowRunCount = await prisma.workflowAutomationRun.count({
        where: { workflowAutomation: { organizationId: fixtures.orgA.id } },
      });
      expect(workflowRunCount).toBe(0);
    });
  });
});
