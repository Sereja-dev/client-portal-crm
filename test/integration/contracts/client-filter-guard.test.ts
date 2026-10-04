import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createContract } from "@/lib/contracts/service";
import { listContracts } from "@/lib/contracts/queries";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actorFor, contractInput, cleanupContracts } from "./helpers";

/**
 * Contract client-filter UUID fix — listContracts()'s own `clientId`
 * option, tested at the domain-query layer directly (the same level
 * test/integration/contracts/tenant-isolation.test.ts and
 * project-filter.test.ts already test listContracts() at). The malformed-
 * value guard itself lives one layer up, at parseContractListParams
 * (see test/unit/contracts-list-params.test.ts) — listContracts() was
 * never given its own isUuid guard, matching projectId's own identical
 * "boundary normalizes untrusted input, the query API stays explicit"
 * structure, so every case here uses well-formed UUIDs throughout.
 */
describe("Contracts — listContracts clientId filter", () => {
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

  it("a valid client-only filter returns only Contracts belonging to that exact Client, excluding another Client's own", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const onTarget = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
    expect(onTarget.ok).toBe(true);
    if (!onTarget.ok) return;
    contractIds.push(onTarget.contract.id);

    const results = await listContracts(fixtures.orgA.id, { clientId: fixtures.clientA.id });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(onTarget.contract.id);
    expect(results.every((r) => r.clientId === fixtures.clientA.id)).toBe(true);
  });

  it("a foreign-org's own well-formed Client id never leaks that org's Contracts when queried under a different organizationId", async () => {
    const orgBOwner = actorFor(fixtures.orgBOwner, "OWNER");
    const foreignContract = await createContract(fixtures.orgB.id, orgBOwner, contractInput(fixtures.clientB.id));
    expect(foreignContract.ok).toBe(true);
    if (!foreignContract.ok) return;
    contractIds.push(foreignContract.contract.id);

    // org A's own query, scoped by org A, must never surface org B's
    // Contract, even when queried with org B's own real, well-formed
    // clientId — organizationId scoping always wins first.
    const crossOrgAttempt = await listContracts(fixtures.orgA.id, { clientId: fixtures.clientB.id });
    expect(crossOrgAttempt).toEqual([]);
  });

  it("a well-formed but nonexistent client id simply matches zero rows, never leaks unrelated Contracts", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const real = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
    expect(real.ok).toBe(true);
    if (!real.ok) return;
    contractIds.push(real.contract.id);

    const withNonexistentId = await listContracts(fixtures.orgA.id, { clientId: randomUUID() });
    expect(withNonexistentId).toEqual([]);
  });

  it("client + project composition still behaves correctly with a genuinely valid pair", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const matching = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { projectId: fixtures.project.id }));
    expect(matching.ok).toBe(true);
    if (!matching.ok) return;
    contractIds.push(matching.contract.id);

    const results = await listContracts(fixtures.orgA.id, { clientId: fixtures.clientA.id, projectId: fixtures.project.id });
    expect(results.map((r) => r.id)).toContain(matching.contract.id);
  });

  it("an ordinary unfiltered list is unchanged by this fix", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const contract = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
    expect(contract.ok).toBe(true);
    if (!contract.ok) return;
    contractIds.push(contract.contract.id);

    const unfiltered = await listContracts(fixtures.orgA.id, {});
    expect(unfiltered.map((r) => r.id)).toContain(contract.contract.id);
  });
});
