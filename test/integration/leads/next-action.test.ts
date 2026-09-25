import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { fetchLeadPipelineColumns } from "@/app/(dashboard)/leads/pipeline-query";
import { parseLeadListParams } from "@/app/(dashboard)/leads/query";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Leads Pipeline V1 (Section 13/14/33) — Next Action, the nearest
 * upcoming non-archived CalendarEvent linked to a Lead via
 * CalendarEvent.leadId. Mirrors test/integration/leads/pipeline-query.test.ts's
 * own established fixture technique exactly (seedTestData +
 * bootstrapOrganizationStatusDefinitions — fixtures.orgA is never
 * auto-bootstrapped with LEAD CustomStatusDefinition rows).
 *
 * fetchLeadPipelineColumns' own Next Action query reads the real,
 * un-injectable `new Date()` at call time (matching
 * getLeadPipelineSnapshot's own identical "current state" convention —
 * neither accepts a fixed clock) — so "past"/"upcoming" here are offsets
 * from the real current instant, not a fixed calendar anchor.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const PAST = new Date(Date.now() - 5 * DAY_MS);
const SOON = new Date(Date.now() + 1 * DAY_MS);
const LATER = new Date(Date.now() + 5 * DAY_MS);
const ARCHIVED_TIMESTAMP = new Date();

const NAME_PREFIX = "Lead-NextAction";

function uniqueName(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

describe("Leads Pipeline — Next Action (nearest upcoming CalendarEvent per Lead)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgB.id);
  });

  afterAll(async () => {
    await prisma.calendarEvent.deleteMany({ where: { title: { startsWith: NAME_PREFIX } } });
    await prisma.lead.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
    await cleanupTestData(fixtures);
  });

  async function createLead(organizationId: string): Promise<string> {
    const lead = await prisma.lead.create({ data: { name: uniqueName(), organizationId, stage: "NEW" } });
    return lead.id;
  }

  async function createEvent(
    organizationId: string,
    leadId: string | null,
    startsAt: Date,
    opts: { archived?: boolean; title?: string } = {},
  ): Promise<string> {
    const event = await prisma.calendarEvent.create({
      data: {
        organizationId,
        leadId,
        title: opts.title ?? `${NAME_PREFIX}-event-${randomUUID().slice(0, 6)}`,
        allDay: false,
        startsAt,
        createdByUserId: fixtures.owner.id,
        archivedAt: opts.archived ? ARCHIVED_TIMESTAMP : null,
      },
    });
    return event.id;
  }

  async function nextActionFor(leadId: string, organizationId = fixtures.orgA.id) {
    const columns = await fetchLeadPipelineColumns(organizationId, parseLeadListParams({}));
    const lead = columns.flatMap((c) => c.leads).find((l) => l.id === leadId);
    if (!lead) {
      throw new Error(`Lead ${leadId} not found on the ${organizationId} board — fixture bug, not a real "no next action" case.`);
    }
    return lead.nextAction;
  }

  it("1. two upcoming events: the nearest one (by startsAt) is shown, not the farther one", async () => {
    const leadId = await createLead(fixtures.orgA.id);
    await createEvent(fixtures.orgA.id, leadId, LATER, { title: `${NAME_PREFIX}-far` });
    await createEvent(fixtures.orgA.id, leadId, SOON, { title: `${NAME_PREFIX}-near` });

    const nextAction = await nextActionFor(leadId);
    expect(nextAction).not.toBeNull();
    expect(nextAction!.title).toBe(`${NAME_PREFIX}-near`);
  });

  it("2. a past event is excluded — never shown as the next action", async () => {
    const leadId = await createLead(fixtures.orgA.id);
    await createEvent(fixtures.orgA.id, leadId, PAST, { title: `${NAME_PREFIX}-past-only` });

    const nextAction = await nextActionFor(leadId);
    expect(nextAction).toBeNull();
  });

  it("3. an archived future event is excluded, even though it's otherwise the nearest", async () => {
    const leadId = await createLead(fixtures.orgA.id);
    await createEvent(fixtures.orgA.id, leadId, SOON, { archived: true, title: `${NAME_PREFIX}-archived` });
    await createEvent(fixtures.orgA.id, leadId, LATER, { title: `${NAME_PREFIX}-real-next` });

    const nextAction = await nextActionFor(leadId);
    expect(nextAction).not.toBeNull();
    expect(nextAction!.title).toBe(`${NAME_PREFIX}-real-next`);
  });

  it("4. a Lead with no linked event at all has a null next action, never a fabricated one", async () => {
    const leadId = await createLead(fixtures.orgA.id);
    const nextAction = await nextActionFor(leadId);
    expect(nextAction).toBeNull();
  });

  it("5. an event belonging to a DIFFERENT Lead never appears as this Lead's own next action", async () => {
    const leadA = await createLead(fixtures.orgA.id);
    const leadB = await createLead(fixtures.orgA.id);
    await createEvent(fixtures.orgA.id, leadB, SOON, { title: `${NAME_PREFIX}-belongs-to-b` });

    const nextActionForA = await nextActionFor(leadA);
    expect(nextActionForA).toBeNull();
    const nextActionForB = await nextActionFor(leadB);
    expect(nextActionForB?.title).toBe(`${NAME_PREFIX}-belongs-to-b`);
  });

  it("6. tenant isolation — org B's own event never surfaces as org A's Lead's next action, and org A's board never sees org B's Lead at all", async () => {
    const leadA = await createLead(fixtures.orgA.id);
    const leadB = await createLead(fixtures.orgB.id);
    await createEvent(fixtures.orgB.id, leadB, SOON, { title: `${NAME_PREFIX}-org-b-event` });

    const columnsA = await fetchLeadPipelineColumns(fixtures.orgA.id, parseLeadListParams({}));
    const idsInOrgABoard = columnsA.flatMap((c) => c.leads.map((l) => l.id));
    expect(idsInOrgABoard).not.toContain(leadB);

    const nextActionForA = await nextActionFor(leadA);
    expect(nextActionForA).toBeNull();

    await prisma.lead.deleteMany({ where: { id: leadB } });
  });
});
