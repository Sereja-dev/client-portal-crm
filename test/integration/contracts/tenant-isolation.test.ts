import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createContract,
  updateContractDocument,
  updateContractInternalNotes,
  sendContract,
  acceptContractByStaff,
  terminateContract,
  archiveContract,
  restoreContract,
} from "@/lib/contracts/service";
import { getContractForStaff, listContracts } from "@/lib/contracts/queries";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actorFor, contractInput, cleanupContracts } from "./helpers";

/**
 * Contracts Phase 1 — explicit forging tests (locked architecture §19):
 * a Contract belonging to org A must be completely unreachable through
 * org B's own organizationId, and a foreign-org id must be
 * indistinguishable from a nonexistent one at every entry point.
 */
describe("Contracts — tenant isolation", () => {
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

  async function createOrgAContract() {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
    if (!created.ok) throw new Error("fixture setup failed");
    contractIds.push(created.contract.id);
    return created.contract;
  }

  it("getContractForStaff scoped to org B cannot see org A's Contract", async () => {
    const contract = await createOrgAContract();
    const result = await getContractForStaff(fixtures.orgB.id, contract.id);
    expect(result).toBeNull();
  });

  it("listContracts scoped to org B never includes org A's Contract", async () => {
    const contract = await createOrgAContract();
    const results = await listContracts(fixtures.orgB.id, { search: contract.contractNumber });
    expect(results.find((row) => row.id === contract.id)).toBeUndefined();
  });

  it("updateContractDocument scoped to org B returns NOT_FOUND for org A's Contract", async () => {
    const contract = await createOrgAContract();
    const orgBOwner = actorFor(fixtures.orgBOwner, "OWNER");
    const result = await updateContractDocument(fixtures.orgB.id, contract.id, orgBOwner, contractInput(fixtures.clientA.id));
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("updateContractInternalNotes scoped to org B returns NOT_FOUND for org A's Contract", async () => {
    const contract = await createOrgAContract();
    const orgBOwner = actorFor(fixtures.orgBOwner, "OWNER");
    const result = await updateContractInternalNotes(fixtures.orgB.id, contract.id, orgBOwner, "forged notes");
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("sendContract scoped to org B returns NOT_FOUND for org A's Contract", async () => {
    const contract = await createOrgAContract();
    const orgBOwner = actorFor(fixtures.orgBOwner, "OWNER");
    const result = await sendContract(fixtures.orgB.id, contract.id, orgBOwner);
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("acceptContractByStaff scoped to org B returns NOT_FOUND for org A's Contract", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const contract = await createOrgAContract();
    await sendContract(fixtures.orgA.id, contract.id, owner);

    const orgBOwner = actorFor(fixtures.orgBOwner, "OWNER");
    const result = await acceptContractByStaff(fixtures.orgB.id, contract.id, orgBOwner);
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("terminateContract scoped to org B returns NOT_FOUND for org A's Contract", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const contract = await createOrgAContract();
    await sendContract(fixtures.orgA.id, contract.id, owner);
    await acceptContractByStaff(fixtures.orgA.id, contract.id, owner);

    const orgBOwner = actorFor(fixtures.orgBOwner, "OWNER");
    const result = await terminateContract(fixtures.orgB.id, contract.id, orgBOwner);
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("archiveContract/restoreContract scoped to org B return NOT_FOUND for org A's Contract", async () => {
    const contract = await createOrgAContract();
    expect(await archiveContract(fixtures.orgB.id, contract.id)).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(await restoreContract(fixtures.orgB.id, contract.id)).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("createContract rejects a foreign-org Client (org B's Client supplied under org A)", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const result = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientB.id));
    expect(result).toEqual({ ok: false, reason: "INVALID_TARGET" });
  });

  it("createContract rejects a foreign-org Project even under the correct Client", async () => {
    const orgBOwner = actorFor(fixtures.orgBOwner, "OWNER");
    // fixtures.project belongs to orgA/clientA -- attempt to reference it under orgB with orgB's own client.
    const result = await createContract(fixtures.orgB.id, orgBOwner, contractInput(fixtures.clientB.id, { projectId: fixtures.project.id }));
    expect(result).toEqual({ ok: false, reason: "INVALID_TARGET" });
  });

  it("a malformed Contract id at every read entry point resolves to null/NOT_FOUND, never throws", async () => {
    expect(await getContractForStaff(fixtures.orgA.id, "not-a-uuid")).toBeNull();
    const owner = actorFor(fixtures.owner, "OWNER");
    expect(await updateContractDocument(fixtures.orgA.id, "not-a-uuid", owner, contractInput(fixtures.clientA.id))).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
  });

  it("a well-formed but entirely nonexistent Contract id behaves identically to a foreign-org one", async () => {
    const nonexistentId = randomUUID();
    const orgBOwner = actorFor(fixtures.orgBOwner, "OWNER");
    expect(await getContractForStaff(fixtures.orgB.id, nonexistentId)).toBeNull();
    expect(await sendContract(fixtures.orgB.id, nonexistentId, orgBOwner)).toEqual({ ok: false, reason: "NOT_FOUND" });
  });
});
