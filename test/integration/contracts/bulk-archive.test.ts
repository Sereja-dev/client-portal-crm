import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createContract } from "@/lib/contracts/service";
import { bulkArchiveContractsAction } from "@/app/(dashboard)/contracts/bulk-actions";
import { BULK_SELECTION_MAX } from "@/lib/bulk-actions/shared";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { actorFor, contractInput, cleanupContracts } from "./helpers";

/**
 * Tables Improvement Slice C — Contracts' one approved V1 bulk action
 * (Archive), via the exact Server Action the Active list's own
 * BulkActionBar calls. Mirrors test/integration/client-requests/
 * staff-actions.test.ts's own seedTestData/actAs pattern (this action
 * resolves organizationId via getCurrentUserOrganization() itself, so
 * it needs the mocked auth context, unlike this directory's own
 * lifecycle.test.ts, which calls the lower-level domain functions
 * directly).
 */
describe("Contracts — bulk Archive (Tables Improvement Slice C)", () => {
  let fixtures: TestFixtures;
  let contractIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupContracts(contractIds);
    contractIds = [];
    resetAuthMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  async function createDraft(organizationId = fixtures.orgA.id, clientId = fixtures.clientA.id) {
    const result = await createContract(organizationId, actorFor(fixtures.owner, "OWNER"), contractInput(clientId));
    if (!result.ok) throw new Error("expected ok");
    contractIds.push(result.contract.id);
    return result.contract;
  }

  it("archives multiple selected Contracts in one call, through the exact existing archiveContract() path (archivedAt set, status/lifecycle untouched)", async () => {
    const a = await createDraft();
    const b = await createDraft();
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await bulkArchiveContractsAction([a.id, b.id]);
    expect(result).toEqual({ updatedCount: 2, failedCount: 0, failures: [] });

    const refreshedA = await prisma.contract.findUniqueOrThrow({ where: { id: a.id } });
    const refreshedB = await prisma.contract.findUniqueOrThrow({ where: { id: b.id } });
    expect(refreshedA.archivedAt).not.toBeNull();
    expect(refreshedB.archivedAt).not.toBeNull();
    // Lifecycle status is completely untouched by Archive -- still DRAFT.
    expect(refreshedA.status).toBe("DRAFT");
    expect(refreshedB.status).toBe("DRAFT");
  });

  it("an empty selection is a safe no-op, never an error", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await bulkArchiveContractsAction([]);
    expect(result).toEqual({ updatedCount: 0, failedCount: 0, failures: [] });
  });

  it(`accepts exactly ${BULK_SELECTION_MAX} ids`, async () => {
    const contracts = await Promise.all(Array.from({ length: BULK_SELECTION_MAX }, () => createDraft()));
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await bulkArchiveContractsAction(contracts.map((c) => c.id));
    expect(result.updatedCount).toBe(BULK_SELECTION_MAX);
    expect(result.failedCount).toBe(0);
  });

  it(`rejects a selection larger than ${BULK_SELECTION_MAX} safely -- zero rows mutated, a bounded TOO_MANY_SELECTED failure, never a partial silent truncation`, async () => {
    const tooMany = Array.from({ length: BULK_SELECTION_MAX + 1 }, () => crypto.randomUUID());
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await bulkArchiveContractsAction(tooMany);
    expect(result.updatedCount).toBe(0);
    expect(result.failedCount).toBe(tooMany.length);
    expect(result.failures).toEqual([{ id: "", reason: "TOO_MANY_SELECTED" }]);
  });

  it("mixed valid + stale/nonexistent ids: valid ones succeed, the stale one fails on its own without aborting the batch (partial success, Tasks-style)", async () => {
    const valid = await createDraft();
    const staleId = crypto.randomUUID();
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await bulkArchiveContractsAction([valid.id, staleId]);
    expect(result.updatedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.failures).toEqual([{ id: staleId, reason: "NOT_FOUND" }]);

    const refreshed = await prisma.contract.findUniqueOrThrow({ where: { id: valid.id } });
    expect(refreshed.archivedAt).not.toBeNull();
  });

  it("organization isolation: a foreign-org Contract id fails with the exact same NOT_FOUND as a nonexistent one -- never leaking that it exists, and never archived", async () => {
    const foreign = await createDraft(fixtures.orgB.id, fixtures.clientB.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await bulkArchiveContractsAction([foreign.id]);
    expect(result).toEqual({ updatedCount: 0, failedCount: 1, failures: [{ id: foreign.id, reason: "NOT_FOUND" }] });

    const refreshed = await prisma.contract.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(refreshed.archivedAt).toBeNull();
  });

  it("archiving an already-archived Contract is idempotent (success, no error) -- matches the existing single-record archiveContract() convention exactly", async () => {
    const contract = await createDraft();
    actAs(fixtures.owner, fixtures.orgA.id);

    await bulkArchiveContractsAction([contract.id]);
    const secondCall = await bulkArchiveContractsAction([contract.id]);
    expect(secondCall).toEqual({ updatedCount: 1, failedCount: 0, failures: [] });
  });

  it("bulk Archive never touches sentAt/acceptedAt/terminatedAt or triggers any Send/Accept/Terminate side effect -- archiveContract() itself only ever sets archivedAt", async () => {
    const contract = await createDraft();
    actAs(fixtures.owner, fixtures.orgA.id);

    await bulkArchiveContractsAction([contract.id]);
    const refreshed = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(refreshed.sentAt).toBeNull();
    expect(refreshed.acceptedAt).toBeNull();
    expect(refreshed.terminatedAt).toBeNull();
  });
});
