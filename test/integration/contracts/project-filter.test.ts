import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createContract, sendContract, archiveContract } from "@/lib/contracts/service";
import { listContracts } from "@/lib/contracts/queries";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actorFor, contractInput, cleanupContracts } from "./helpers";

/**
 * Documents Slice A — the main Contracts list's own new Project filter
 * (listContracts()'s own `projectId` option), tested at the domain-query
 * layer directly — the same level test/integration/contracts/tenant-
 * isolation.test.ts already tests listContracts() at.
 */
describe("Contracts — listContracts projectId filter", () => {
  let fixtures: TestFixtures;
  let contractIds: string[] = [];
  let extraProjectIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupContracts(contractIds);
    contractIds = [];
    if (extraProjectIds.length > 0) {
      await prisma.project.deleteMany({ where: { id: { in: extraProjectIds } } });
      extraProjectIds = [];
    }
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  async function createOtherProject(organizationId: string, clientId: string, ownerId: string) {
    const project = await prisma.project.create({
      data: { name: `Project Filter Test ${randomUUID().slice(0, 8)}`, organizationId, clientId, ownerId, status: "IN_PROGRESS" },
    });
    extraProjectIds.push(project.id);
    return project;
  }

  it("project-only filter returns only Contracts belonging to that exact Project, excluding a different Project under the same Client", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const otherProject = await createOtherProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);

    const onTarget = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { projectId: fixtures.project.id }));
    const onOther = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { projectId: otherProject.id }));
    const projectless = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
    expect(onTarget.ok && onOther.ok && projectless.ok).toBe(true);
    if (!onTarget.ok || !onOther.ok || !projectless.ok) return;
    contractIds.push(onTarget.contract.id, onOther.contract.id, projectless.contract.id);

    const results = await listContracts(fixtures.orgA.id, { projectId: fixtures.project.id });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(onTarget.contract.id);
    expect(ids).not.toContain(onOther.contract.id);
    expect(ids).not.toContain(projectless.contract.id);
  });

  it("Client + Project compose as AND — a Contract matching only one of the two is excluded", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const matching = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { projectId: fixtures.project.id }));
    expect(matching.ok).toBe(true);
    if (!matching.ok) return;
    contractIds.push(matching.contract.id);

    const bothMatch = await listContracts(fixtures.orgA.id, { clientId: fixtures.clientA.id, projectId: fixtures.project.id });
    expect(bothMatch.map((r) => r.id)).toContain(matching.contract.id);

    // A forged combination that can never legitimately co-occur on any
    // real row (fixtures.clientB does not own fixtures.project) — must
    // resolve to zero matching Contracts, never a cross-target fallback
    // to one filter or the other.
    const forged = await listContracts(fixtures.orgA.id, { clientId: fixtures.clientB.id, projectId: fixtures.project.id });
    expect(forged).toEqual([]);
  });

  it("Status + Project compose as AND", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const draft = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { projectId: fixtures.project.id }));
    const toSend = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { projectId: fixtures.project.id }));
    expect(draft.ok && toSend.ok).toBe(true);
    if (!draft.ok || !toSend.ok) return;
    contractIds.push(draft.contract.id, toSend.contract.id);
    await sendContract(fixtures.orgA.id, toSend.contract.id, owner);

    const sentOnProject = await listContracts(fixtures.orgA.id, { status: "SENT", projectId: fixtures.project.id });
    const ids = sentOnProject.map((r) => r.id);
    expect(ids).toContain(toSend.contract.id);
    expect(ids).not.toContain(draft.contract.id);
  });

  it("Archived + Project compose as AND — includeArchived:true still honors the Project scope", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const otherProject = await createOtherProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const archivedOnTarget = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { projectId: fixtures.project.id }));
    const archivedOnOther = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { projectId: otherProject.id }));
    expect(archivedOnTarget.ok && archivedOnOther.ok).toBe(true);
    if (!archivedOnTarget.ok || !archivedOnOther.ok) return;
    contractIds.push(archivedOnTarget.contract.id, archivedOnOther.contract.id);
    await archiveContract(fixtures.orgA.id, archivedOnTarget.contract.id);
    await archiveContract(fixtures.orgA.id, archivedOnOther.contract.id);

    const results = await listContracts(fixtures.orgA.id, { includeArchived: true, projectId: fixtures.project.id });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(archivedOnTarget.contract.id);
    expect(ids).not.toContain(archivedOnOther.contract.id);
  });

  it("a foreign-org Project id never leaks that org's Contracts — organizationId alone already scopes every candidate row", async () => {
    const orgBOwner = actorFor(fixtures.orgBOwner, "OWNER");
    const orgBProject = await prisma.project.create({
      data: { name: `Project Filter Test ${randomUUID().slice(0, 8)}`, organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, ownerId: fixtures.orgBOwner.id, status: "IN_PROGRESS" },
    });
    extraProjectIds.push(orgBProject.id);
    const foreignContract = await createContract(fixtures.orgB.id, orgBOwner, contractInput(fixtures.clientB.id, { projectId: orgBProject.id }));
    expect(foreignContract.ok).toBe(true);
    if (!foreignContract.ok) return;
    contractIds.push(foreignContract.contract.id);

    // org A's own query, scoped by org A, must never surface org B's
    // Contract — regardless of org B's own projectId ever colliding in
    // appearance with anything in org A (it can't; both are real UUIDs).
    const results = await listContracts(fixtures.orgA.id, { projectId: fixtures.project.id });
    expect(results.map((r) => r.id)).not.toContain(foreignContract.contract.id);

    // Also directly: querying org A with org B's own real (but
    // foreign-org) projectId still yields nothing, since organizationId
    // scoping always wins first.
    const crossOrgAttempt = await listContracts(fixtures.orgA.id, { projectId: orgBProject.id });
    expect(crossOrgAttempt).toEqual([]);
  });

  it("a well-formed but nonexistent project id simply matches zero rows, never leaks unrelated Contracts", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const real = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { projectId: fixtures.project.id }));
    expect(real.ok).toBe(true);
    if (!real.ok) return;
    contractIds.push(real.contract.id);

    const withNonexistentId = await listContracts(fixtures.orgA.id, { projectId: randomUUID() });
    expect(withNonexistentId.map((r) => r.id)).not.toContain(real.contract.id);
    expect(withNonexistentId).toEqual([]);
  });

  // A malformed (non-UUID) project id is guarded at the page's own parse
  // layer (parseContractListParams), never reaching this domain function
  // at all — see test/unit/contracts-list-params.test.ts and
  // ContractListParams.projectId's own doc comment for why that boundary
  // lives there rather than inside listContracts() itself.

  it("clearing/omitting the project filter preserves existing unfiltered behavior — every Contract in the org is still returned", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const otherProject = await createOtherProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const onTarget = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { projectId: fixtures.project.id }));
    const onOther = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { projectId: otherProject.id }));
    expect(onTarget.ok && onOther.ok).toBe(true);
    if (!onTarget.ok || !onOther.ok) return;
    contractIds.push(onTarget.contract.id, onOther.contract.id);

    const unfiltered = await listContracts(fixtures.orgA.id, {});
    const ids = unfiltered.map((r) => r.id);
    expect(ids).toContain(onTarget.contract.id);
    expect(ids).toContain(onOther.contract.id);
  });
});
