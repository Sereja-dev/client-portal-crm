import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTimeEntry, getTimeEntry, listTimeEntries, archiveTimeEntry, type TimeEntryActor } from "@/lib/time-entries/entries";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/** Time Tracking, Phase 1 — getTimeEntry/listTimeEntries (test items 32-39). */

async function cleanupEntries(organizationIds: string[]) {
  await prisma.timeEntry.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

function actorFor(user: { id: string; name: string }, role: "OWNER" | "ADMIN" | "MEMBER"): TimeEntryActor {
  return { id: user.id, name: user.name, role };
}

describe("Time Tracking — getTimeEntry / listTimeEntries", () => {
  let fixtures: TestFixtures;
  const ownerActor = () => actorFor(fixtures.owner, "OWNER");

  async function createEntry(overrides: Record<string, unknown> = {}) {
    const result = await createTimeEntry(fixtures.orgA.id, ownerActor(), {
      userId: fixtures.owner.id,
      projectId: fixtures.project.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
      ...overrides,
    });
    if (!result.ok) throw new Error("expected ok");
    return result.entry;
  }

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupEntries([fixtures.orgA.id, fixtures.orgB.id]);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("32. get is org-scoped — a cross-org entry is indistinguishable from nonexistent", async () => {
    const orgBEntry = await prisma.timeEntry.create({
      data: { organizationId: fixtures.orgB.id, userId: fixtures.orgBOwner.id, workDate: new Date("2026-03-15T00:00:00.000Z"), durationMinutes: 60 },
    });
    expect(await getTimeEntry(fixtures.orgA.id, orgBEntry.id)).toBeNull();
    expect(await getTimeEntry(fixtures.orgA.id, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("33. list is org-scoped", async () => {
    const own = await createEntry();
    const orgBEntry = await prisma.timeEntry.create({
      data: { organizationId: fixtures.orgB.id, userId: fixtures.orgBOwner.id, workDate: new Date("2026-03-15T00:00:00.000Z"), durationMinutes: 60 },
    });

    const list = await listTimeEntries(fixtures.orgA.id);
    expect(list.map((e) => e.id)).toContain(own.id);
    expect(list.map((e) => e.id)).not.toContain(orgBEntry.id);
  });

  it("34. userId filter works", async () => {
    const ownEntry = await createEntry();
    const memberResult = await createTimeEntry(fixtures.orgA.id, ownerActor(), {
      userId: fixtures.member.id,
      projectId: fixtures.project.id,
      workDate: "2026-03-16",
      durationMinutes: 30,
    });
    if (!memberResult.ok) throw new Error("expected ok");

    const list = await listTimeEntries(fixtures.orgA.id, { userId: fixtures.owner.id });
    expect(list.map((e) => e.id)).toEqual([ownEntry.id]);
  });

  it("35. project filter works", async () => {
    const otherProject = await prisma.project.create({
      data: { name: "Other Project", clientId: fixtures.clientA.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "PLANNING" },
    });
    const inMain = await createEntry();
    const inOther = await createTimeEntry(fixtures.orgA.id, ownerActor(), {
      userId: fixtures.owner.id,
      projectId: otherProject.id,
      workDate: "2026-03-15",
      durationMinutes: 60,
    });
    if (!inOther.ok) throw new Error("expected ok");

    const list = await listTimeEntries(fixtures.orgA.id, { projectId: fixtures.project.id });
    expect(list.map((e) => e.id)).toEqual([inMain.id]);

    await prisma.project.deleteMany({ where: { id: otherProject.id } });
  });

  it("36. workDate range (fromDate/toDate) works", async () => {
    const early = await createEntry({ workDate: "2026-01-01" });
    const mid = await createEntry({ workDate: "2026-03-15" });
    const late = await createEntry({ workDate: "2026-06-01" });

    const list = await listTimeEntries(fixtures.orgA.id, {
      fromDate: new Date("2026-02-01T00:00:00.000Z"),
      toDate: new Date("2026-04-01T00:00:00.000Z"),
    });
    expect(list.map((e) => e.id)).toEqual([mid.id]);
    expect(list.map((e) => e.id)).not.toContain(early.id);
    expect(list.map((e) => e.id)).not.toContain(late.id);
  });

  it("37. billable filter works", async () => {
    const billableEntry = await createEntry({ billable: true });
    const nonBillableEntry = await createEntry({ billable: false, workDate: "2026-03-16" });

    const billableOnly = await listTimeEntries(fixtures.orgA.id, { billable: true });
    expect(billableOnly.map((e) => e.id)).toContain(billableEntry.id);
    expect(billableOnly.map((e) => e.id)).not.toContain(nonBillableEntry.id);

    const nonBillableOnly = await listTimeEntries(fixtures.orgA.id, { billable: false });
    expect(nonBillableOnly.map((e) => e.id)).toContain(nonBillableEntry.id);
    expect(nonBillableOnly.map((e) => e.id)).not.toContain(billableEntry.id);
  });

  it("38/39. archived entries are excluded by default, included with includeArchived", async () => {
    const entry = await createEntry();
    await archiveTimeEntry(fixtures.orgA.id, entry.id, ownerActor());

    const activeOnly = await listTimeEntries(fixtures.orgA.id);
    expect(activeOnly.map((e) => e.id)).not.toContain(entry.id);

    const withArchived = await listTimeEntries(fixtures.orgA.id, { includeArchived: true });
    expect(withArchived.map((e) => e.id)).toContain(entry.id);
  });

  it("orders newest workDate first, then createdAt/id tie-breaker", async () => {
    const first = await createEntry({ workDate: "2026-01-01" });
    const second = await createEntry({ workDate: "2026-06-01" });

    const list = await listTimeEntries(fixtures.orgA.id);
    expect(list[0].id).toBe(second.id);
    expect(list[1].id).toBe(first.id);
  });
});
