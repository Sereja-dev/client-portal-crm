import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { suggestNextContractNumber } from "@/lib/contracts/suggest-next-contract-number";
import { createContract } from "@/lib/contracts/service";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actorFor, contractInput, cleanupContracts } from "./helpers";

/**
 * Contracts Phase 1 — the DB-touching half of the numbering helper (see
 * src/lib/contracts/numbering.ts's own header comment; the pure half is
 * covered in test/unit/contracts-numbering.test.ts). Advisory only — the
 * real race-safety mechanism is the @@unique DB constraint, exercised in
 * test/integration/contracts/crud.test.ts.
 */
describe("suggestNextContractNumber (DB-touching)", () => {
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

  it("suggests C-0001 for an organization with no existing Contracts", async () => {
    expect(await suggestNextContractNumber(fixtures.orgA.id)).toBe("C-0001");
  });

  it("increments from this organization's own highest existing C-number, scoped by organization", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { contractNumber: "C-0004" }));
    expect(created.ok).toBe(true);
    if (created.ok) contractIds.push(created.contract.id);

    expect(await suggestNextContractNumber(fixtures.orgA.id)).toBe("C-0005");
    // org B has no Contracts of its own -- unaffected by org A's numbers.
    expect(await suggestNextContractNumber(fixtures.orgB.id)).toBe("C-0001");
  });
});
