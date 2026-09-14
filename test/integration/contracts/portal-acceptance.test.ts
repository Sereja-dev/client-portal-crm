import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createContract, sendContract, acceptContractByPortal, archiveContract } from "@/lib/contracts/service";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { setMockAuthUser, resetAuthMock } from "../../support/auth-mock";
import { actorFor, contractInput, cleanupContracts } from "./helpers";

/**
 * Contracts Phase 1 — Portal acceptance domain tests (no Portal UI exists
 * yet; acceptContractByPortal is exercised directly, exactly as a future
 * Portal Server Action would call it). Identity is mocked the same way
 * test/integration/portal/welcome-eligibility.test.ts's own
 * getCurrentPortalUser() tests already do: setMockAuthUser({id, email})
 * with a real PortalUser row's own id, never a caller-supplied clientId/
 * organizationId of any kind.
 */
describe("Contracts — Portal acceptance", () => {
  let fixtures: TestFixtures;
  let contractIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    resetAuthMock();
    await cleanupContracts(contractIds);
    contractIds = [];
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  async function createSentContractForClientA() {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
    if (!created.ok) throw new Error("fixture setup failed");
    contractIds.push(created.contract.id);
    const sent = await sendContract(fixtures.orgA.id, created.contract.id, owner);
    if (!sent.ok) throw new Error("fixture setup failed");
    return sent.contract;
  }

  it("the PortalUser for the Contract's own Client can accept a SENT Contract", async () => {
    const contract = await createSentContractForClientA();
    setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });

    const result = await acceptContractByPortal(contract.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contract.status).toBe("ACCEPTED");
      expect(result.contract.acceptedByPortalUserId).toBe(fixtures.portalUser.id);
      expect(result.contract.acceptedByUserId).toBeNull();
    }
  });

  it("writes a STATUS_CHANGED Activity row with a null actorId (Portal has no User row)", async () => {
    const contract = await createSentContractForClientA();
    setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
    await acceptContractByPortal(contract.id);

    // This Contract already has one earlier STATUS_CHANGED Activity from
    // its own send (DRAFT -> SENT, written by the Staff owner who sent
    // it) -- order by createdAt desc to get the ACCEPT transition's own
    // row, not an ambiguous "first" one.
    const activity = await prisma.activity.findFirst({
      where: { organizationId: fixtures.orgA.id, entityType: "CONTRACT", entityId: contract.id, action: "STATUS_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    expect(activity).not.toBeNull();
    expect(activity?.actorId).toBeNull();
    expect(activity?.metadata).toMatchObject({ actor: "portal" });
  });

  it("a PortalUser belonging to a DIFFERENT Client cannot accept -- NOT_FOUND, indistinguishable from a nonexistent Contract", async () => {
    const contract = await createSentContractForClientA();
    const foreignPortalUser = await prisma.portalUser.create({
      data: { id: randomUUID(), clientId: fixtures.clientB.id, email: `foreign-portal-${fixtures.runId}@test.local`, name: "Foreign Portal" },
    });
    setMockAuthUser({ id: foreignPortalUser.id, email: foreignPortalUser.email });

    const result = await acceptContractByPortal(contract.id);
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });

    await prisma.portalUser.delete({ where: { id: foreignPortalUser.id } });
  });

  it("a malformed Contract id fails safely (NOT_FOUND), never throws", async () => {
    setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
    const result = await acceptContractByPortal("not-a-uuid");
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("a nonexistent Contract id fails safely (NOT_FOUND)", async () => {
    setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
    const result = await acceptContractByPortal(randomUUID());
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("a DRAFT Contract cannot be Portal-accepted", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    contractIds.push(created.contract.id);

    setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
    const result = await acceptContractByPortal(created.contract.id);
    expect(result).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
  });

  it("an already-ACCEPTED Contract cannot be accepted again", async () => {
    const contract = await createSentContractForClientA();
    setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
    await acceptContractByPortal(contract.id);

    const second = await acceptContractByPortal(contract.id);
    expect(second).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
  });

  it("a TERMINATED Contract cannot be accepted", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const contract = await createSentContractForClientA();
    setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
    await acceptContractByPortal(contract.id);
    resetAuthMock();

    const { terminateContract } = await import("@/lib/contracts/service");
    await terminateContract(fixtures.orgA.id, contract.id, owner);

    setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
    const result = await acceptContractByPortal(contract.id);
    expect(result).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
  });

  it("an archived Contract cannot be Portal-accepted", async () => {
    const contract = await createSentContractForClientA();
    await archiveContract(fixtures.orgA.id, contract.id);

    setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
    const result = await acceptContractByPortal(contract.id);
    expect(result).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
  });
});
