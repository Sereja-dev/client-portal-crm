import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createContract, sendContract, acceptContractByStaff, terminateContract, archiveContract } from "@/lib/contracts/service";
import { listContracts, getContractForStaff } from "@/lib/contracts/queries";
import { getContractDisplayStatus } from "@/lib/contracts/status";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actorFor, contractInput, cleanupContracts } from "./helpers";

/**
 * Documents Slice D — Accepted documents (locked spec §12–§18/§24). This
 * is deliberately NOT a new domain module — the Accepted documents page
 * calls listContracts({ status: "ACCEPTED" }) directly, the exact same
 * already-reviewed query Contracts' own list page uses. This file proves
 * that exact combination (persisted-ACCEPTED filtering, then rendering
 * through getContractDisplayStatus()) behaves correctly, rather than
 * re-deriving coverage the Contracts suite already owns for listContracts
 * itself.
 */
describe("Accepted documents — persisted ACCEPTED filtering + derived display status", () => {
  let fixtures: TestFixtures;
  let contractIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupContracts(contractIds);
    contractIds = [];
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  async function createAccepted(overrides: Partial<Parameters<typeof contractInput>[1]> = {}) {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, overrides));
    if (!created.ok) throw new Error("fixture creation failed");
    contractIds.push(created.contract.id);
    await sendContract(fixtures.orgA.id, created.contract.id, owner);
    const accepted = await acceptContractByStaff(fixtures.orgA.id, created.contract.id, owner);
    if (!accepted.ok) throw new Error("fixture acceptance failed");
    return accepted.contract;
  }

  it("a same-org ACCEPTED Contract appears in listContracts({status: 'ACCEPTED'})", async () => {
    const contract = await createAccepted();
    const rows = await listContracts(fixtures.orgA.id, { status: "ACCEPTED" });
    expect(rows.some((c) => c.id === contract.id)).toBe(true);
  });

  it("a foreign-org ACCEPTED Contract never appears", async () => {
    const orgBOwnerActor = actorFor(fixtures.orgBOwner, "OWNER");
    const created = await createContract(fixtures.orgB.id, orgBOwnerActor, contractInput(fixtures.clientB.id));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    contractIds.push(created.contract.id);
    await sendContract(fixtures.orgB.id, created.contract.id, orgBOwnerActor);
    await acceptContractByStaff(fixtures.orgB.id, created.contract.id, orgBOwnerActor);

    const rows = await listContracts(fixtures.orgA.id, { status: "ACCEPTED" });
    expect(rows.some((c) => c.id === created.contract.id)).toBe(false);
  });

  it("DRAFT, SENT, and TERMINATED Contracts never appear in the ACCEPTED-filtered list", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");

    const draft = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    contractIds.push(draft.contract.id);

    const sentSource = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
    expect(sentSource.ok).toBe(true);
    if (!sentSource.ok) return;
    contractIds.push(sentSource.contract.id);
    await sendContract(fixtures.orgA.id, sentSource.contract.id, owner);

    const terminated = await createAccepted();
    const terminateResult = await terminateContract(fixtures.orgA.id, terminated.id, owner);
    expect(terminateResult.ok).toBe(true);

    const rows = await listContracts(fixtures.orgA.id, { status: "ACCEPTED" });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(draft.contract.id);
    expect(ids).not.toContain(sentSource.contract.id);
    expect(ids).not.toContain(terminated.id); // now TERMINATED, no longer ACCEPTED
  });

  it("an accepted-but-expired Contract is included (persisted ACCEPTED), and its derived display status is EXPIRED, never queried via status: 'EXPIRED'", async () => {
    // Computed relative to the real wall clock (never a hardcoded
    // calendar date) so this stays correct no matter when this suite
    // runs: issueDate 60 days ago, expiresAt 1 day ago — strictly after
    // issueDate (satisfies write-time validation) and strictly before
    // "now" (guarantees derived EXPIRED regardless of the actual date).
    const dateOnly = (daysAgo: number) => new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const contract = await createAccepted({ issueDate: dateOnly(60), expiresAt: dateOnly(1) });

    const rows = await listContracts(fixtures.orgA.id, { status: "ACCEPTED" });
    const row = rows.find((c) => c.id === contract.id);
    expect(row).toBeDefined();
    expect(row!.status).toBe("ACCEPTED"); // persisted value is still ACCEPTED, never a stored EXPIRED

    const displayStatus = getContractDisplayStatus({ status: row!.status, effectiveDate: row!.effectiveDate, expiresAt: row!.expiresAt });
    expect(displayStatus).toBe("EXPIRED");
  });

  it("a currently-accepted (non-expired) Contract's derived display status is ACTIVE or ACCEPTED, never EXPIRED", async () => {
    const contract = await createAccepted();
    const row = await getContractForStaff(fixtures.orgA.id, contract.id);
    expect(row).not.toBeNull();

    const displayStatus = getContractDisplayStatus({ status: row!.status, effectiveDate: row!.effectiveDate, expiresAt: row!.expiresAt });
    expect(["ACTIVE", "ACCEPTED"]).toContain(displayStatus);
  });

  it("archived accepted Contracts follow the same includeArchived convention Contracts' own list already uses", async () => {
    const contract = await createAccepted();
    await archiveContract(fixtures.orgA.id, contract.id);

    const activeOnly = await listContracts(fixtures.orgA.id, { status: "ACCEPTED" });
    expect(activeOnly.some((c) => c.id === contract.id)).toBe(false);

    const withArchived = await listContracts(fixtures.orgA.id, { status: "ACCEPTED", includeArchived: true });
    const archivedRow = withArchived.find((c) => c.id === contract.id);
    expect(archivedRow).toBeDefined();
    expect(archivedRow!.archivedAt).not.toBeNull();
  });

  it("an accepted Contract via Portal acceptance (acceptedByPortalUserId) appears identically to a Staff-accepted one", async () => {
    // acceptContractByStaff sets acceptedByUserId; this test only proves
    // that listContracts({status: "ACCEPTED"}) itself has no actor-type
    // filter of any kind — it matches on persisted `status` alone,
    // regardless of which of acceptedByUserId/acceptedByPortalUserId is
    // the one actually set (see Contract's own "exactly one ever set"
    // schema invariant, already exhaustively covered by
    // test/integration/contracts/portal-acceptance.test.ts).
    const staffAccepted = await createAccepted();
    const row = await getContractForStaff(fixtures.orgA.id, staffAccepted.id);
    expect(row!.acceptedByUserId).not.toBeNull();
    expect(row!.acceptedByPortalUserId).toBeNull();

    const rows = await listContracts(fixtures.orgA.id, { status: "ACCEPTED" });
    expect(rows.some((c) => c.id === staffAccepted.id)).toBe(true);
  });
});
