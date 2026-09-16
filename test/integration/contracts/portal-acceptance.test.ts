import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createContract, sendContract, acceptContractByPortal, acceptContractByStaff, archiveContract } from "@/lib/contracts/service";
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

  // Activity actor label fix -- acceptContractByPortal's Activity now
  // carries metadata.actorName (the authenticated PortalUser's own real
  // name), the same fallback formatActivity's actorLabel already reads
  // for every other null-actorId Activity (see Portal Quote decisions'
  // own buildQuoteStatusChangeMetadata precedent). Never the signatory
  // snapshot name, the Client name, or a Staff actor.
  it("records the authenticated PortalUser's own name as metadata.actorName, and the transition remains SENT -> ACCEPTED", async () => {
    const contract = await createSentContractForClientA();
    setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
    await acceptContractByPortal(contract.id);

    const activity = await prisma.activity.findFirst({
      where: { organizationId: fixtures.orgA.id, entityType: "CONTRACT", entityId: contract.id, action: "STATUS_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    expect(activity?.metadata).toMatchObject({
      from: "SENT",
      to: "ACCEPTED",
      actor: "portal",
      actorName: fixtures.portalUser.name,
    });
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

  it("an already-ACCEPTED Contract cannot be accepted again, and the failed retry writes no duplicate Activity", async () => {
    const contract = await createSentContractForClientA();
    setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
    await acceptContractByPortal(contract.id);

    const second = await acceptContractByPortal(contract.id);
    expect(second).toEqual({ ok: false, reason: "INVALID_TRANSITION" });

    const acceptEvents = await prisma.activity.findMany({
      where: { organizationId: fixtures.orgA.id, entityType: "CONTRACT", entityId: contract.id, action: "STATUS_CHANGED" },
    });
    // Exactly two STATUS_CHANGED rows total for this Contract's whole
    // lifecycle so far (DRAFT->SENT from the fixture's own send, then the
    // one successful SENT->ACCEPTED) -- the rejected second accept call
    // must not add a third.
    expect(acceptEvents).toHaveLength(2);
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

  // Contracts Hardening §13 (locked V1 scope): any authenticated
  // PortalUser belonging to the Contract's own Client may accept --
  // there is no recipient-specific/signatory-specific targeting in this
  // phase. Confirmed cheaply with a second, independent PortalUser on
  // the same Client.
  it("any PortalUser of the Contract's own Client may accept -- not only the first/original one", async () => {
    const contract = await createSentContractForClientA();
    const secondPortalUser = await prisma.portalUser.create({
      data: { id: randomUUID(), clientId: fixtures.clientA.id, email: `second-portal-${fixtures.runId}@test.local`, name: "Second Portal User" },
    });

    setMockAuthUser({ id: secondPortalUser.id, email: secondPortalUser.email });
    const result = await acceptContractByPortal(contract.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contract.acceptedByPortalUserId).toBe(secondPortalUser.id);

    await prisma.portalUser.delete({ where: { id: secondPortalUser.id } });
  });

  // Contracts Hardening §5/§6 -- Staff-vs-Portal concurrent accept race.
  // Both acceptContractByStaff's and acceptContractByPortal's own guarded
  // updates share the identical predicate shape (status: "SENT",
  // archivedAt: null), so this is the same proven status-guard
  // concurrency mechanism the Staff-vs-Staff double-accept race already
  // exercises in lifecycle.test.ts -- just crossing the two entry points.
  it("Staff-vs-Portal concurrent accept race: exactly one side wins, final actor is exactly one column, one Activity transition", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const contract = await createSentContractForClientA();
    setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });

    const [staffResult, portalResult] = await Promise.all([
      acceptContractByStaff(fixtures.orgA.id, contract.id, owner),
      acceptContractByPortal(contract.id),
    ]);

    const results = [staffResult, portalResult];
    const successes = results.filter((r) => r.ok);
    const failures = results.filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toEqual({ ok: false, reason: "INVALID_TRANSITION" });

    const final = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(final.status).toBe("ACCEPTED");
    expect(final.acceptedAt).not.toBeNull();
    // Exactly one actor column populated, whichever side actually won --
    // never both, never neither.
    const staffWon = final.acceptedByUserId !== null;
    const portalWon = final.acceptedByPortalUserId !== null;
    expect(staffWon !== portalWon).toBe(true); // exactly one, XOR
    if (staffWon) expect(final.acceptedByPortalUserId).toBeNull();
    if (portalWon) expect(final.acceptedByUserId).toBeNull();

    const activities = await prisma.activity.findMany({
      where: { organizationId: fixtures.orgA.id, entityType: "CONTRACT", entityId: contract.id, action: "STATUS_CHANGED", metadata: { path: ["to"], equals: "ACCEPTED" } },
    });
    expect(activities).toHaveLength(1);
  });
});
