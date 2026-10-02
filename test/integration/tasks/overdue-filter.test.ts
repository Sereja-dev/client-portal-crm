import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildTaskWhere, buildTaskOrderBy, parseTaskListParams, dueThisWeekRange } from "@/app/(dashboard)/tasks/query";
import { testEmail, testSlug } from "../../support/run-id";

/**
 * Dashboard Redesign / Tasks overdue filter — real DB proof that
 * buildTaskWhere's `overdue` composition is exact: status != DONE AND
 * dueDate < now, tenant-scoped, composes correctly with an existing
 * status/priority filter, and a contradictory explicit `status=DONE`
 * deterministically returns zero rows rather than silently overriding
 * either filter.
 */
describe("buildTaskWhere — overdue (Dashboard Redesign)", () => {
  const NOW = new Date("2026-06-15T12:00:00.000Z");
  const PAST_DUE = new Date("2026-06-10T00:00:00.000Z");
  const FUTURE_DUE = new Date("2026-06-20T00:00:00.000Z");

  type Org = { ownerId: string; organization: { id: string }; project: { id: string } };

  async function makeOrg(label: string): Promise<Org> {
    const ownerId = randomUUID();
    await prisma.user.create({ data: { id: ownerId, email: testEmail(label, "test.local"), name: `${label} Owner` } });
    const organization = await prisma.organization.create({ data: { name: `${label} Org`, slug: testSlug(label) } });
    await prisma.membership.create({ data: { userId: ownerId, organizationId: organization.id, role: "OWNER" } });
    const client = await prisma.client.create({
      data: { organizationId: organization.id, userId: ownerId, name: `${label} Client`, status: "ACTIVE" },
    });
    const project = await prisma.project.create({
      data: { organizationId: organization.id, clientId: client.id, ownerId, name: `${label} Project`, status: "IN_PROGRESS" },
    });
    return { ownerId, organization, project };
  }

  async function cleanupOrg(ctx: Org): Promise<void> {
    await prisma.task.deleteMany({ where: { projectId: ctx.project.id } });
    await prisma.project.deleteMany({ where: { id: ctx.project.id } });
    await prisma.client.deleteMany({ where: { organizationId: ctx.organization.id } });
    await prisma.membership.deleteMany({ where: { organizationId: ctx.organization.id } });
    await prisma.organization.deleteMany({ where: { id: ctx.organization.id } });
    await prisma.user.deleteMany({ where: { id: ctx.ownerId } });
  }

  let orgA: Org;
  let orgB: Org;

  beforeAll(async () => {
    orgA = await makeOrg("tasks-overdue-a");
    orgB = await makeOrg("tasks-overdue-b");

    await prisma.task.createMany({
      data: [
        // orgA fixtures.
        { organizationId: orgA.organization.id, projectId: orgA.project.id, title: "A Overdue TODO", status: "TODO", priority: "HIGH", dueDate: PAST_DUE },
        { organizationId: orgA.organization.id, projectId: orgA.project.id, title: "A Overdue IN_PROGRESS Low", status: "IN_PROGRESS", priority: "LOW", dueDate: PAST_DUE },
        { organizationId: orgA.organization.id, projectId: orgA.project.id, title: "A Overdue But DONE", status: "DONE", priority: "HIGH", dueDate: PAST_DUE, completedAt: NOW },
        { organizationId: orgA.organization.id, projectId: orgA.project.id, title: "A Not Yet Due", status: "TODO", priority: "HIGH", dueDate: FUTURE_DUE },
        { organizationId: orgA.organization.id, projectId: orgA.project.id, title: "A No Due Date", status: "TODO", priority: "HIGH", dueDate: null },
        // orgB fixture — must never leak into orgA's own overdue results.
        { organizationId: orgB.organization.id, projectId: orgB.project.id, title: "B Overdue TODO", status: "TODO", priority: "HIGH", dueDate: PAST_DUE },
      ],
    });
  });

  afterAll(async () => {
    await cleanupOrg(orgA);
    await cleanupOrg(orgB);
  });

  it("overdue=true returns only not-DONE, past-due tasks for the caller's own organization", async () => {
    const params = parseTaskListParams({ overdue: "true" });
    const where = buildTaskWhere(orgA.organization.id, params, NOW);
    const tasks = await prisma.task.findMany({ where, orderBy: buildTaskOrderBy(params) });
    const titles = tasks.map((t) => t.title).sort();
    expect(titles).toEqual(["A Overdue IN_PROGRESS Low", "A Overdue TODO"].sort());
  });

  it("DONE is excluded even when its own dueDate is in the past", async () => {
    const params = parseTaskListParams({ overdue: "true" });
    const where = buildTaskWhere(orgA.organization.id, params, NOW);
    const tasks = await prisma.task.findMany({ where });
    expect(tasks.map((t) => t.title)).not.toContain("A Overdue But DONE");
  });

  it("a future-due or null-due task is excluded", async () => {
    const params = parseTaskListParams({ overdue: "true" });
    const where = buildTaskWhere(orgA.organization.id, params, NOW);
    const tasks = await prisma.task.findMany({ where });
    const titles = tasks.map((t) => t.title);
    expect(titles).not.toContain("A Not Yet Due");
    expect(titles).not.toContain("A No Due Date");
  });

  it("tenant isolation: orgB's own overdue task never appears in orgA's own overdue results", async () => {
    const params = parseTaskListParams({ overdue: "true" });
    const where = buildTaskWhere(orgA.organization.id, params, NOW);
    const tasks = await prisma.task.findMany({ where });
    expect(tasks.map((t) => t.title)).not.toContain("B Overdue TODO");
  });

  it("composes with an existing compatible filter — overdue + priority=HIGH", async () => {
    const params = parseTaskListParams({ overdue: "true", priority: "HIGH" });
    const where = buildTaskWhere(orgA.organization.id, params, NOW);
    const tasks = await prisma.task.findMany({ where });
    expect(tasks.map((t) => t.title)).toEqual(["A Overdue TODO"]);
  });

  it("an explicit incompatible status=DONE&overdue=true returns zero rows — never a weakened overdue definition, never a silently-dropped status filter", async () => {
    const params = parseTaskListParams({ overdue: "true", status: "DONE" });
    const where = buildTaskWhere(orgA.organization.id, params, NOW);
    const tasks = await prisma.task.findMany({ where });
    expect(tasks).toEqual([]);
  });

  it("an explicit compatible status (TODO) + overdue composes as a real AND, not an override", async () => {
    const params = parseTaskListParams({ overdue: "true", status: "TODO" });
    const where = buildTaskWhere(orgA.organization.id, params, NOW);
    const tasks = await prisma.task.findMany({ where });
    expect(tasks.map((t) => t.title)).toEqual(["A Overdue TODO"]);
  });
});

/**
 * Work Hub V1 — `mine` and `dueThisWeek`, the two new quick filters the
 * read-only audit found missing (My tasks, Due this week — Overdue and
 * High priority already existed). Reuses the exact same org/fixture
 * pattern as the `overdue` suite above.
 */
describe("buildTaskWhere — mine and dueThisWeek (Work Hub V1)", () => {
  const NOW = new Date("2026-06-15T12:00:00.000Z"); // Monday, mid-day UTC.

  type Org = { ownerId: string; organization: { id: string }; project: { id: string } };

  async function makeOrg(label: string): Promise<Org> {
    const ownerId = randomUUID();
    await prisma.user.create({ data: { id: ownerId, email: testEmail(label, "test.local"), name: `${label} Owner` } });
    const organization = await prisma.organization.create({ data: { name: `${label} Org`, slug: testSlug(label) } });
    await prisma.membership.create({ data: { userId: ownerId, organizationId: organization.id, role: "OWNER" } });
    const client = await prisma.client.create({
      data: { organizationId: organization.id, userId: ownerId, name: `${label} Client`, status: "ACTIVE" },
    });
    const project = await prisma.project.create({
      data: { organizationId: organization.id, clientId: client.id, ownerId, name: `${label} Project`, status: "IN_PROGRESS" },
    });
    return { ownerId, organization, project };
  }

  async function cleanupOrg(ctx: Org): Promise<void> {
    await prisma.task.deleteMany({ where: { projectId: ctx.project.id } });
    await prisma.project.deleteMany({ where: { id: ctx.project.id } });
    await prisma.client.deleteMany({ where: { organizationId: ctx.organization.id } });
    await prisma.membership.deleteMany({ where: { organizationId: ctx.organization.id } });
    await prisma.organization.deleteMany({ where: { id: ctx.organization.id } });
    await prisma.user.deleteMany({ where: { id: ctx.ownerId } });
  }

  let org: Org;
  let otherMemberId: string;

  beforeAll(async () => {
    org = await makeOrg("tasks-mine-dtw");
    otherMemberId = randomUUID();
    await prisma.user.create({
      data: { id: otherMemberId, email: testEmail("tasks-mine-dtw-other", "test.local"), name: "Other Member" },
    });
    await prisma.membership.create({ data: { userId: otherMemberId, organizationId: org.organization.id, role: "MEMBER" } });

    const { start } = dueThisWeekRange(NOW);
    const dayMs = 24 * 60 * 60 * 1000;

    await prisma.task.createMany({
      data: [
        { organizationId: org.organization.id, projectId: org.project.id, title: "Mine TODO", status: "TODO", priority: "LOW", assigneeId: org.ownerId },
        { organizationId: org.organization.id, projectId: org.project.id, title: "Other Member TODO", status: "TODO", priority: "LOW", assigneeId: otherMemberId },
        { organizationId: org.organization.id, projectId: org.project.id, title: "Unassigned TODO", status: "TODO", priority: "LOW", assigneeId: null },
        { organizationId: org.organization.id, projectId: org.project.id, title: "Due Today", status: "TODO", priority: "LOW", dueDate: start },
        { organizationId: org.organization.id, projectId: org.project.id, title: "Due Day+6", status: "TODO", priority: "LOW", dueDate: new Date(start.getTime() + 6 * dayMs) },
        { organizationId: org.organization.id, projectId: org.project.id, title: "Due Day+7 Excluded", status: "TODO", priority: "LOW", dueDate: new Date(start.getTime() + 7 * dayMs) },
        { organizationId: org.organization.id, projectId: org.project.id, title: "Due Yesterday Excluded", status: "TODO", priority: "LOW", dueDate: new Date(start.getTime() - dayMs) },
        { organizationId: org.organization.id, projectId: org.project.id, title: "Due This Week But DONE", status: "DONE", priority: "LOW", dueDate: new Date(start.getTime() + 2 * dayMs), completedAt: NOW },
      ],
    });
  });

  afterAll(async () => {
    await cleanupOrg(org);
    await prisma.user.deleteMany({ where: { id: otherMemberId } });
  });

  it("mine=true returns only the caller's own assigned tasks — never unassigned, never another member's", async () => {
    const params = parseTaskListParams({ mine: "true" });
    const where = buildTaskWhere(org.organization.id, params, NOW, org.ownerId);
    const tasks = await prisma.task.findMany({ where });
    expect(tasks.map((t) => t.title)).toEqual(["Mine TODO"]);
  });

  it("mine=true is a convenience filter, not a security boundary — the same query composes identically for any caller id (e.g. the other member's own)", async () => {
    const params = parseTaskListParams({ mine: "true" });
    const where = buildTaskWhere(org.organization.id, params, NOW, otherMemberId);
    const tasks = await prisma.task.findMany({ where });
    expect(tasks.map((t) => t.title)).toEqual(["Other Member TODO"]);
  });

  it("mine=true with no currentUserId supplied is omitted entirely — never an accidental 'show nothing'/'unassigned only'", async () => {
    const params = parseTaskListParams({ mine: "true" });
    const where = buildTaskWhere(org.organization.id, params, NOW);
    const tasks = await prisma.task.findMany({ where });
    // Every fixture task for this org is returned — `mine` had no effect.
    expect(tasks.length).toBeGreaterThanOrEqual(8);
  });

  it("dueThisWeek=true includes today and day+6, excludes day+7 and before-today", async () => {
    const params = parseTaskListParams({ dueThisWeek: "true" });
    const where = buildTaskWhere(org.organization.id, params, NOW);
    const tasks = await prisma.task.findMany({ where });
    const titles = tasks.map((t) => t.title);
    expect(titles).toContain("Due Today");
    expect(titles).toContain("Due Day+6");
    expect(titles).not.toContain("Due Day+7 Excluded");
    expect(titles).not.toContain("Due Yesterday Excluded");
  });

  it("dueThisWeek=true never implies status != DONE — a DONE task due this week still matches; status remains independently composable", async () => {
    const params = parseTaskListParams({ dueThisWeek: "true" });
    const where = buildTaskWhere(org.organization.id, params, NOW);
    const tasks = await prisma.task.findMany({ where });
    expect(tasks.map((t) => t.title)).toContain("Due This Week But DONE");

    const paramsExcludingDone = parseTaskListParams({ dueThisWeek: "true", status: "TODO" });
    const whereExcludingDone = buildTaskWhere(org.organization.id, paramsExcludingDone, NOW);
    const todoOnly = await prisma.task.findMany({ where: whereExcludingDone });
    expect(todoOnly.map((t) => t.title)).not.toContain("Due This Week But DONE");
  });
});
