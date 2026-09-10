import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getDashboardAnalytics } from "@/app/(dashboard)/dashboard/query";
import { getPortalOverview } from "@/lib/client-portal/queries";
import { buildClientWhere } from "@/app/(dashboard)/clients/query";
import { buildLeadWhere } from "@/app/(dashboard)/leads/query";
import { buildProjectWhere } from "@/app/(dashboard)/projects/query";
import { fetchLeadPipelineColumns } from "@/app/(dashboard)/leads/pipeline-query";
import { createCustomStatusDefinition, archiveCustomStatusDefinition } from "@/lib/custom-statuses/definitions";
import { assignClientStatus, assignLeadStatus, assignProjectStatus } from "@/lib/custom-statuses/assignment";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Custom Statuses Phase 2A — Read & Semantics Migration. Test items
 * 7-10, 16-23, 27-28 of the originating task's own Section W. Every test
 * here deliberately constructs the adversarial case Section F/H/J exist
 * to guard against: an entity whose statusDefinitionId points at a
 * genuinely CUSTOM definition, while its own legacy enum/stage column
 * still holds a STALE value that happens to equal a real system status
 * (WON/IN_PROGRESS/etc.) — exactly what assignment.ts's own "never sync
 * the legacy column for a custom target" design produces, and exactly
 * the scenario a naive legacy-enum-only read would get wrong.
 *
 * Items 32-34 (security/Portal-scope) are covered by the existing
 * test/integration/custom-statuses/security.test.ts (Phase 1, items
 * 40-42, unchanged by this phase) and by this session's own full Portal
 * regression suite re-run — not duplicated here.
 */

describe("Custom Statuses Phase 2A — read & semantics migration", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
  });

  afterEach(async () => {
    // Clear every entity's own reference FIRST (Lead delete, Client/
    // Project reset to null) — only then can the CUSTOM definitions
    // those rows pointed at actually be deleted; the FK is RESTRICT-
    // equivalent (deferred only within a single transaction, not across
    // separate statements — see the Custom Statuses Phase 1 migration's
    // own deviation (c) comment) and rejects deleting a still-referenced
    // definition. System definitions from beforeAll survive untouched.
    await prisma.lead.deleteMany({ where: { organizationId: fixtures.orgA.id } });
    await prisma.client.update({ where: { id: fixtures.clientA.id }, data: { status: "LEAD", statusDefinitionId: null } });
    await prisma.project.update({ where: { id: fixtures.project.id }, data: { status: "PLANNING", statusDefinitionId: null } });
    await prisma.customStatusDefinition.deleteMany({ where: { organizationId: fixtures.orgA.id, isSystem: false } });
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  async function findSystemDef(entityType: "CLIENT" | "LEAD" | "PROJECT", key: string) {
    return prisma.customStatusDefinition.findFirstOrThrow({
      where: { organizationId: fixtures.orgA.id, entityType, isSystem: true, key },
    });
  }

  describe("Lead pipeline (Section G, items 7-10)", () => {
    it("7/8. pipeline columns group by definition, in definition.position order", async () => {
      const columns = await fetchLeadPipelineColumns(fixtures.orgA.id, { q: "", archived: false, sortField: "createdAt", sortDir: "desc" });
      const systemKeysInOrder = ["new", "contacted", "qualified", "proposal", "won", "lost"];
      expect(columns.map((c) => c.key)).toEqual(systemKeysInOrder);
    });

    it("9. a custom Lead status appears as its own dedicated column", async () => {
      const created = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD", { label: "Nurturing" });
      if (!created.ok) throw new Error("expected ok");
      const lead = await prisma.lead.create({ data: { organizationId: fixtures.orgA.id, name: "Nurture Lead", stage: "NEW" } });
      const result = await assignLeadStatus(fixtures.orgA.id, lead.id, created.definition.id);
      expect(result).toEqual({ ok: true });

      const columns = await fetchLeadPipelineColumns(fixtures.orgA.id, { q: "", archived: false, sortField: "createdAt", sortDir: "desc" });
      const nurturingColumn = columns.find((c) => c.definitionId === created.definition.id);
      expect(nurturingColumn).toBeDefined();
      expect(nurturingColumn?.label).toBe("Nurturing");
      expect(nurturingColumn?.leads.map((l) => l.id)).toContain(lead.id);
    });

    it("10. a Lead with a CUSTOM status and a STALE legacy stage='WON' does NOT appear in the WON column — it appears only in its own custom column", async () => {
      const created = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD", { label: "Stalled" });
      if (!created.ok) throw new Error("expected ok");
      // Created directly at legacy stage WON, then reassigned to a
      // CUSTOM definition — assignment.ts's own design leaves the legacy
      // column untouched for a custom target, producing exactly this
      // adversarial "stale WON, real status is custom" row.
      const lead = await prisma.lead.create({ data: { organizationId: fixtures.orgA.id, name: "Stalled Lead", stage: "WON" } });
      await assignLeadStatus(fixtures.orgA.id, lead.id, created.definition.id);

      const columns = await fetchLeadPipelineColumns(fixtures.orgA.id, { q: "", archived: false, sortField: "createdAt", sortDir: "desc" });
      const wonColumn = columns.find((c) => c.key === "won")!;
      const customColumn = columns.find((c) => c.definitionId === created.definition.id)!;
      expect(wonColumn.leads.map((l) => l.id)).not.toContain(lead.id);
      expect(customColumn.leads.map((l) => l.id)).toContain(lead.id);
    });
  });

  describe("Filters are authoritative via statusDefinitionId (Section C/H, items 16-20)", () => {
    it("16. Client filter (?status=ACTIVE) excludes a Client whose real status is CUSTOM, even with a stale legacy status=ACTIVE", async () => {
      const activeDef = await findSystemDef("CLIENT", "active");
      const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "VIP" });
      if (!customDef.ok) throw new Error("expected ok");

      // Real system-ACTIVE client — must match the filter.
      await assignClientStatus(fixtures.orgA.id, fixtures.clientA.id, activeDef.id);
      // Second client: legacy status ACTIVE (stale), but reassigned to
      // the CUSTOM definition — must NOT match a `status=ACTIVE` filter.
      const staleClient = await prisma.client.create({
        data: { name: "Stale Active Client", status: "ACTIVE", organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
      });
      await assignClientStatus(fixtures.orgA.id, staleClient.id, customDef.definition.id);

      const where = await buildClientWhere(fixtures.orgA.id, { q: "", status: "ACTIVE" });
      const results = await prisma.client.findMany({ where });
      const ids = results.map((c) => c.id);
      expect(ids).toContain(fixtures.clientA.id);
      expect(ids).not.toContain(staleClient.id);

      await prisma.client.delete({ where: { id: staleClient.id } });
    });

    it("17/20. Lead filter (?stage=WON) excludes a Lead whose real status is CUSTOM, even with a stale legacy stage=WON — the stale legacy value never leaks into custom-status filtering", async () => {
      const wonDef = await findSystemDef("LEAD", "won");
      const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD", { label: "On Hold" });
      if (!customDef.ok) throw new Error("expected ok");

      const realWonLead = await prisma.lead.create({ data: { organizationId: fixtures.orgA.id, name: "Real Won", stage: "WON" } });
      await assignLeadStatus(fixtures.orgA.id, realWonLead.id, wonDef.id);

      const staleLead = await prisma.lead.create({ data: { organizationId: fixtures.orgA.id, name: "Stale Won", stage: "WON" } });
      await assignLeadStatus(fixtures.orgA.id, staleLead.id, customDef.definition.id);

      const where = await buildLeadWhere(fixtures.orgA.id, { q: "", stage: "WON", assignedToUserId: undefined, archived: false });
      const results = await prisma.lead.findMany({ where });
      const ids = results.map((l) => l.id);
      expect(ids).toContain(realWonLead.id);
      expect(ids).not.toContain(staleLead.id);
    });

    it("18. Project filter (?status=IN_PROGRESS) excludes a Project whose real status is CUSTOM, even with a stale legacy status=IN_PROGRESS", async () => {
      const inProgressDef = await findSystemDef("PROJECT", "in_progress");
      const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "PROJECT", { label: "Blocked" });
      if (!customDef.ok) throw new Error("expected ok");

      await assignProjectStatus(fixtures.orgA.id, fixtures.project.id, inProgressDef.id);
      const staleProject = await prisma.project.create({
        data: {
          name: "Stale In Progress",
          status: "IN_PROGRESS",
          clientId: fixtures.clientA.id,
          ownerId: fixtures.owner.id,
          organizationId: fixtures.orgA.id,
        },
      });
      await assignProjectStatus(fixtures.orgA.id, staleProject.id, customDef.definition.id);

      const where = await buildProjectWhere(fixtures.orgA.id, { q: "", status: "IN_PROGRESS" });
      const results = await prisma.project.findMany({ where });
      const ids = results.map((p) => p.id);
      expect(ids).toContain(fixtures.project.id);
      expect(ids).not.toContain(staleProject.id);

      await prisma.project.delete({ where: { id: staleProject.id } });
    });

    it("19. a filter combined with a search query still applies BOTH conditions correctly (the AND-composition fix — a bare OR spread would silently drop one of them)", async () => {
      const activeDef = await findSystemDef("CLIENT", "active");
      await assignClientStatus(fixtures.orgA.id, fixtures.clientA.id, activeDef.id);
      const otherActive = await prisma.client.create({
        data: { name: "Unrelated Active Co", status: "ACTIVE", organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
      });
      const otherActiveDef = await findSystemDef("CLIENT", "active");
      await assignClientStatus(fixtures.orgA.id, otherActive.id, otherActiveDef.id);

      const where = await buildClientWhere(fixtures.orgA.id, { q: fixtures.clientA.name, status: "ACTIVE" });
      const results = await prisma.client.findMany({ where });
      const ids = results.map((c) => c.id);
      expect(ids).toContain(fixtures.clientA.id);
      expect(ids).not.toContain(otherActive.id);

      await prisma.client.delete({ where: { id: otherActive.id } });
    });
  });

  describe("Project IN_PROGRESS KPI/Portal count isolation (Section K/L, items 21-23)", () => {
    it("21/22. dashboard activeProjects KPI counts only the system IN_PROGRESS definition — a custom status with a stale legacy IN_PROGRESS value is not counted", async () => {
      const inProgressDef = await findSystemDef("PROJECT", "in_progress");
      const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "PROJECT", { label: "Blocked" });
      if (!customDef.ok) throw new Error("expected ok");

      await assignProjectStatus(fixtures.orgA.id, fixtures.project.id, inProgressDef.id);
      const before = await getDashboardAnalytics({ organizationId: fixtures.orgA.id, period: "30d", now: new Date() });

      const staleProject = await prisma.project.create({
        data: {
          name: "Stale KPI Project",
          status: "IN_PROGRESS",
          clientId: fixtures.clientA.id,
          ownerId: fixtures.owner.id,
          organizationId: fixtures.orgA.id,
        },
      });
      await assignProjectStatus(fixtures.orgA.id, staleProject.id, customDef.definition.id);

      const after = await getDashboardAnalytics({ organizationId: fixtures.orgA.id, period: "30d", now: new Date() });
      // The custom-status project must NOT have incremented the KPI.
      expect(after.kpis.activeProjects).toBe(before.kpis.activeProjects);

      await prisma.project.delete({ where: { id: staleProject.id } });
    });

    it("23. Portal active-project count applies the identical rule", async () => {
      const inProgressDef = await findSystemDef("PROJECT", "in_progress");
      const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "PROJECT", { label: "Blocked" });
      if (!customDef.ok) throw new Error("expected ok");

      await assignProjectStatus(fixtures.orgA.id, fixtures.project.id, inProgressDef.id);
      const before = await getPortalOverview(fixtures.clientA.id, fixtures.orgA.id);

      const staleProject = await prisma.project.create({
        data: {
          name: "Stale Portal Project",
          status: "IN_PROGRESS",
          clientId: fixtures.clientA.id,
          ownerId: fixtures.owner.id,
          organizationId: fixtures.orgA.id,
        },
      });
      await assignProjectStatus(fixtures.orgA.id, staleProject.id, customDef.definition.id);

      const after = await getPortalOverview(fixtures.clientA.id, fixtures.orgA.id);
      expect(after.activeProjectsCount).toBe(before.activeProjectsCount);

      await prisma.project.delete({ where: { id: staleProject.id } });
    });
  });

  describe("Archived definitions (Section Q, items 27-28)", () => {
    it("27. a Lead assigned to a now-archived definition remains fully visible in the pipeline — never silently dropped", async () => {
      const created = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD", { label: "Soon Archived" });
      if (!created.ok) throw new Error("expected ok");
      const lead = await prisma.lead.create({ data: { organizationId: fixtures.orgA.id, name: uniqueLeadName(), stage: "NEW" } });
      await assignLeadStatus(fixtures.orgA.id, lead.id, created.definition.id);

      const archiveResult = await archiveCustomStatusDefinition(fixtures.orgA.id, created.definition.id);
      expect(archiveResult.ok).toBe(true);

      const columns = await fetchLeadPipelineColumns(fixtures.orgA.id, { q: "", archived: false, sortField: "createdAt", sortDir: "desc" });
      const archivedColumn = columns.find((c) => c.definitionId === created.definition.id);
      expect(archivedColumn).toBeDefined();
      expect(archivedColumn?.archived).toBe(true);
      expect(archivedColumn?.leads.map((l) => l.id)).toContain(lead.id);
    });

    it("28. the archived definition's own label/color remain fully renderable (fetched via the same include every other column uses)", async () => {
      const created = await createCustomStatusDefinition(fixtures.orgA.id, "LEAD", { label: "Renderable Archived", color: "WARNING" });
      if (!created.ok) throw new Error("expected ok");
      const lead = await prisma.lead.create({ data: { organizationId: fixtures.orgA.id, name: uniqueLeadName(), stage: "NEW" } });
      await assignLeadStatus(fixtures.orgA.id, lead.id, created.definition.id);
      await archiveCustomStatusDefinition(fixtures.orgA.id, created.definition.id);

      const columns = await fetchLeadPipelineColumns(fixtures.orgA.id, { q: "", archived: false, sortField: "createdAt", sortDir: "desc" });
      const column = columns.find((c) => c.definitionId === created.definition.id)!;
      expect(column.label).toBe("Renderable Archived");
      const cardLead = column.leads.find((l) => l.id === lead.id)!;
      expect(cardLead.statusDefinition).toEqual({ label: "Renderable Archived", color: "WARNING" });
    });
  });

  function uniqueLeadName(): string {
    return `Phase2A-Lead-${randomUUID().slice(0, 8)}`;
  }
});
