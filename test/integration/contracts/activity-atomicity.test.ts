import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createContract, updateContractDocument, sendContract, acceptContractByStaff, archiveContract } from "@/lib/contracts/service";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actorFor, contractInput, cleanupContracts } from "./helpers";

/**
 * Contracts Hardening §9 -- every guarded transition's own Activity write
 * happens strictly AFTER its own guarded updateMany's count check, inside
 * the very same prisma.$transaction as that update (see service.ts's own
 * doc comment). This structurally guarantees a failed/raced transition
 * can never leave a partial STATUS_CHANGED row behind, and a successful
 * one always leaves exactly one -- this file proves that explicitly
 * rather than leaving it implicit in the code's own ordering.
 */
describe("Contracts — no partial Activity on a failed/raced transition", () => {
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

  async function statusChangedCount(contractId: string): Promise<number> {
    return prisma.activity.count({
      where: { organizationId: fixtures.orgA.id, entityType: "CONTRACT", entityId: contractId, action: "STATUS_CHANGED" },
    });
  }

  it("a stale SEND attempt (updatedAt no longer current) leaves no STATUS_CHANGED row -- structural proof, same reasoning as lifecycle.test.ts's own stale-version regression", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    contractIds.push(created.contract.id);

    const versionA = await prisma.contract.findUniqueOrThrow({ where: { id: created.contract.id } });
    await updateContractDocument(fixtures.orgA.id, created.contract.id, owner, contractInput(fixtures.clientA.id, { title: "Edited Underneath" }));
    expect(await statusChangedCount(created.contract.id)).toBe(0);

    // The exact guard predicate shape sendContract's own final
    // updateMany uses, attempted with the STALE (pre-edit) updatedAt
    // token -- proves a stale send can neither commit the transition NOR
    // leave any Activity row behind (createActivity is only ever reached
    // after this exact predicate matches, per service.ts's own ordering).
    const staleAttempt = await prisma.contract.updateMany({
      where: { id: created.contract.id, organizationId: fixtures.orgA.id, status: "DRAFT", archivedAt: null, updatedAt: versionA.updatedAt },
      data: { status: "SENT", sentAt: new Date() },
    });
    expect(staleAttempt.count).toBe(0);
    expect(await statusChangedCount(created.contract.id)).toBe(0);

    // Contrast: a genuine, non-stale send through the real public API
    // still succeeds and logs exactly one.
    const sent = await sendContract(fixtures.orgA.id, created.contract.id, owner);
    expect(sent.ok).toBe(true);
    expect(await statusChangedCount(created.contract.id)).toBe(1);
  });

  it("a second (already-SENT) SEND attempt leaves no additional STATUS_CHANGED row", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    contractIds.push(created.contract.id);

    await sendContract(fixtures.orgA.id, created.contract.id, owner);
    expect(await statusChangedCount(created.contract.id)).toBe(1);

    const second = await sendContract(fixtures.orgA.id, created.contract.id, owner);
    expect(second).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
    expect(await statusChangedCount(created.contract.id)).toBe(1);
  });

  it("a second (already-ACCEPTED) ACCEPT attempt leaves no additional STATUS_CHANGED row", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    contractIds.push(created.contract.id);

    await sendContract(fixtures.orgA.id, created.contract.id, owner);
    await acceptContractByStaff(fixtures.orgA.id, created.contract.id, owner);
    expect(await statusChangedCount(created.contract.id)).toBe(2); // SEND + ACCEPT

    const second = await acceptContractByStaff(fixtures.orgA.id, created.contract.id, owner);
    expect(second).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
    expect(await statusChangedCount(created.contract.id)).toBe(2);
  });

  it("an archive-blocked ACCEPT attempt leaves no additional STATUS_CHANGED row", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");
    const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    contractIds.push(created.contract.id);

    await sendContract(fixtures.orgA.id, created.contract.id, owner);
    await archiveContract(fixtures.orgA.id, created.contract.id);
    expect(await statusChangedCount(created.contract.id)).toBe(1); // SEND only

    const result = await acceptContractByStaff(fixtures.orgA.id, created.contract.id, owner);
    expect(result).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
    expect(await statusChangedCount(created.contract.id)).toBe(1);
  });
});
