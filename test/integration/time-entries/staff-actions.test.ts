import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTimeEntryAction, updateTimeEntryAction, archiveTimeEntryAction, unarchiveTimeEntryAction } from "@/app/(dashboard)/time/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * Time Tracking Phase 2A — Staff Server Action layer (test items 1-22).
 * Mirrors test/integration/client-requests/staff-actions.test.ts's own
 * seedTestData/actAs/expectRedirect pattern.
 */

async function expectRedirect(promise: Promise<unknown>): Promise<RedirectSignal> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
  return caught as RedirectSignal;
}

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

function baseFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    workDate: "2026-03-15",
    hours: "1",
    minutes: "30",
    billable: "on",
    ...overrides,
  };
}

async function cleanupEntries(organizationIds: string[]) {
  await prisma.timeEntry.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

describe("Time Tracking — Staff Server Actions", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupEntries([fixtures.orgA.id, fixtures.orgB.id]);
    resetAuthMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("1/10/11. a MEMBER creates their own entry — correct work date and duration serialization", async () => {
    actAs(fixtures.member, fixtures.orgA.id);
    const redirect = await expectRedirect(
      createTimeEntryAction({ error: null }, formData(baseFields({ userId: fixtures.member.id, projectId: fixtures.project.id }))),
    );
    expect(redirect.url).toContain("/time/");

    const created = await prisma.timeEntry.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, userId: fixtures.member.id } });
    expect(created.durationMinutes).toBe(90); // 11. 1h30m -> 90
    expect(created.workDate.toISOString()).toBe("2026-03-15T00:00:00.000Z"); // 10.
    expect(created.billable).toBe(true);
  });

  it("2. a MEMBER's Server Action cannot create for another member", async () => {
    actAs(fixtures.member, fixtures.orgA.id);
    const result = await createTimeEntryAction(
      { error: null },
      formData(baseFields({ userId: fixtures.admin.id, projectId: fixtures.project.id })),
    );
    expect(result.error).toBeTruthy();
    expect(await prisma.timeEntry.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("3. an OWNER creates for another member", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(
      createTimeEntryAction({ error: null }, formData(baseFields({ userId: fixtures.member.id, projectId: fixtures.project.id }))),
    );
    const created = await prisma.timeEntry.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id } });
    expect(created.userId).toBe(fixtures.member.id);
  });

  it("4. an ADMIN creates for another member", async () => {
    actAs(fixtures.admin, fixtures.orgA.id);
    await expectRedirect(
      createTimeEntryAction({ error: null }, formData(baseFields({ userId: fixtures.member.id, projectId: fixtures.project.id }))),
    );
    const created = await prisma.timeEntry.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id } });
    expect(created.userId).toBe(fixtures.member.id);
  });

  it("5. an invalid/cross-org target member is rejected", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createTimeEntryAction(
      { error: null },
      formData(baseFields({ userId: fixtures.orgBOwner.id, projectId: fixtures.project.id })),
    );
    expect(result.fieldErrors?.userId).toBeTruthy();
    expect(await prisma.timeEntry.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("6. a valid same-org Project is accepted (see test 1's own redirect assertion for the same claim, in context)", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(
      createTimeEntryAction({ error: null }, formData(baseFields({ userId: fixtures.owner.id, projectId: fixtures.project.id }))),
    );
    const created = await prisma.timeEntry.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id } });
    expect(created.projectId).toBe(fixtures.project.id);
  });

  it("7. a cross-org Project is rejected by the Server Action", async () => {
    const orgBProject = await prisma.project.create({
      data: { name: "Org B Project", clientId: fixtures.clientB.id, organizationId: fixtures.orgB.id, ownerId: fixtures.orgBOwner.id, status: "PLANNING" },
    });
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createTimeEntryAction(
      { error: null },
      formData(baseFields({ userId: fixtures.owner.id, projectId: orgBProject.id })),
    );
    expect(result.fieldErrors?.projectId).toBeTruthy();
    await prisma.project.deleteMany({ where: { id: orgBProject.id } });
  });

  it("8. a same-project Task is accepted", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(
      createTimeEntryAction(
        { error: null },
        formData(baseFields({ userId: fixtures.owner.id, projectId: fixtures.project.id, taskId: fixtures.task.id })),
      ),
    );
    const created = await prisma.timeEntry.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id } });
    expect(created.taskId).toBe(fixtures.task.id);
  });

  it("9. a wrong-project Task is rejected", async () => {
    const otherProject = await prisma.project.create({
      data: { name: "Other Project", clientId: fixtures.clientA.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "PLANNING" },
    });
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createTimeEntryAction(
      { error: null },
      formData(baseFields({ userId: fixtures.owner.id, projectId: otherProject.id, taskId: fixtures.task.id })),
    );
    expect(result.fieldErrors?.taskId).toBeTruthy();
    await prisma.project.deleteMany({ where: { id: otherProject.id } });
  });

  it("12. 0 duration (0h 0m) is rejected", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createTimeEntryAction(
      { error: null },
      formData(baseFields({ userId: fixtures.owner.id, projectId: fixtures.project.id, hours: "0", minutes: "0" })),
    );
    expect(result.fieldErrors?.durationMinutes).toBeTruthy();
    expect(await prisma.timeEntry.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("13. >1440 total minutes (24h + positive minutes) is rejected", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createTimeEntryAction(
      { error: null },
      formData(baseFields({ userId: fixtures.owner.id, projectId: fixtures.project.id, hours: "24", minutes: "1" })),
    );
    expect(result.fieldErrors?.durationMinutes).toBeTruthy();
    expect(await prisma.timeEntry.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("negative/fractional-shaped duration input is rejected before ever reaching the domain layer", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const negative = await createTimeEntryAction(
      { error: null },
      formData(baseFields({ userId: fixtures.owner.id, projectId: fixtures.project.id, hours: "-1", minutes: "0" })),
    );
    expect(negative.fieldErrors?.durationMinutes).toBeTruthy();

    const overMinutes = await createTimeEntryAction(
      { error: null },
      formData(baseFields({ userId: fixtures.owner.id, projectId: fixtures.project.id, hours: "0", minutes: "90" })),
    );
    expect(overMinutes.fieldErrors?.durationMinutes).toBeTruthy();

    expect(await prisma.timeEntry.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("14/15. billable true and false both work", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(
      createTimeEntryAction(
        { error: null },
        formData(baseFields({ userId: fixtures.owner.id, projectId: fixtures.project.id, billable: "on" })),
      ),
    );
    const billableEntry = await prisma.timeEntry.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id } });
    expect(billableEntry.billable).toBe(true);
    await prisma.timeEntry.deleteMany({ where: { id: billableEntry.id } });

    // Omitting the "billable" field entirely simulates an unchecked checkbox.
    await expectRedirect(
      createTimeEntryAction(
        { error: null },
        formData({ workDate: "2026-03-15", hours: "1", minutes: "0", userId: fixtures.owner.id, projectId: fixtures.project.id }),
      ),
    );
    const nonBillableEntry = await prisma.timeEntry.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id } });
    expect(nonBillableEntry.billable).toBe(false);
  });

  describe("update", () => {
    async function createEntry(userId: string) {
      actAs(fixtures.owner, fixtures.orgA.id);
      await expectRedirect(
        createTimeEntryAction({ error: null }, formData(baseFields({ userId, projectId: fixtures.project.id }))),
      );
      resetAuthMock();
      return prisma.timeEntry.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, userId } });
    }

    it("16. a member updates their own entry", async () => {
      const entry = await createEntry(fixtures.member.id);
      actAs(fixtures.member, fixtures.orgA.id);
      await expectRedirect(
        updateTimeEntryAction(
          entry.id,
          { error: null },
          formData(baseFields({ userId: fixtures.member.id, projectId: fixtures.project.id, hours: "2", minutes: "0" })),
        ),
      );
      const updated = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(updated.durationMinutes).toBe(120);
    });

    it("17. a MEMBER cannot update another member's entry", async () => {
      const entry = await createEntry(fixtures.admin.id);
      actAs(fixtures.member, fixtures.orgA.id);
      const result = await updateTimeEntryAction(
        entry.id,
        { error: null },
        formData(baseFields({ userId: fixtures.admin.id, projectId: fixtures.project.id, hours: "2", minutes: "0" })),
      );
      expect(result.error).toBeTruthy();
      expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } })).durationMinutes).toBe(90);
    });

    it("18. OWNER/ADMIN can update another member's entry", async () => {
      const entry = await createEntry(fixtures.member.id);
      actAs(fixtures.owner, fixtures.orgA.id);
      await expectRedirect(
        updateTimeEntryAction(
          entry.id,
          { error: null },
          formData(baseFields({ userId: fixtures.member.id, projectId: fixtures.project.id, hours: "3", minutes: "0" })),
        ),
      );
      expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } })).durationMinutes).toBe(180);
    });
  });

  describe("archive / unarchive", () => {
    async function createEntry(userId: string) {
      actAs(fixtures.owner, fixtures.orgA.id);
      await expectRedirect(
        createTimeEntryAction({ error: null }, formData(baseFields({ userId, projectId: fixtures.project.id }))),
      );
      resetAuthMock();
      return prisma.timeEntry.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, userId } });
    }

    it("19. archive own entry works", async () => {
      const entry = await createEntry(fixtures.member.id);
      actAs(fixtures.member, fixtures.orgA.id);
      const result = await archiveTimeEntryAction(entry.id);
      expect(result).toEqual({ ok: true });
      expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } })).archivedAt).not.toBeNull();
    });

    it("20. a MEMBER cannot archive another's entry", async () => {
      const entry = await createEntry(fixtures.admin.id);
      actAs(fixtures.member, fixtures.orgA.id);
      const result = await archiveTimeEntryAction(entry.id);
      expect(result).toEqual({ ok: false, reason: "FORBIDDEN" });
      expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } })).archivedAt).toBeNull();
    });

    it("21/22. OWNER/ADMIN can archive/unarchive another's entry, and unarchive follows the same permission rule", async () => {
      // Owned by admin — neither the archiving OWNER nor the later
      // unarchiving admin is its owner by coincidence, and fixtures.member
      // (the one MEMBER-role fixture available) is genuinely a non-owner,
      // non-privileged actor for this entry either way.
      const entry = await createEntry(fixtures.admin.id);
      actAs(fixtures.owner, fixtures.orgA.id);
      const archived = await archiveTimeEntryAction(entry.id);
      expect(archived).toEqual({ ok: true });
      resetAuthMock();

      actAs(fixtures.member, fixtures.orgA.id);
      const memberUnarchive = await unarchiveTimeEntryAction(entry.id);
      expect(memberUnarchive).toEqual({ ok: false, reason: "FORBIDDEN" });
      resetAuthMock();

      actAs(fixtures.owner, fixtures.orgA.id);
      const ownerUnarchive = await unarchiveTimeEntryAction(entry.id);
      expect(ownerUnarchive).toEqual({ ok: true });
      expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } })).archivedAt).toBeNull();
    });
  });
});
