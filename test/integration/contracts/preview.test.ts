import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createContract, sendContract, acceptContractByStaff, terminateContract, archiveContract } from "@/lib/contracts/service";
import { getContractForStaff } from "@/lib/contracts/queries";
import { isContractPreviewable } from "@/lib/contracts/status";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actorFor, contractInput, cleanupContracts } from "./helpers";

/**
 * Documents Slice C — Contract Preview V1. This file proves the exact
 * access gate `/contracts/[id]/preview` relies on
 * (getContractForStaff() + isContractPreviewable()) against REAL,
 * DB-backed Contract rows moved through the REAL lifecycle service
 * functions — not just isContractPreviewable()'s own pure-function unit
 * tests (test/unit/contracts-status.test.ts). The page component itself
 * is not imported/invoked directly here — this app's own established
 * convention is that a Next.js page's own notFound()/redirect() routing
 * is proven at the E2E layer (see EditContractPage's own equivalent
 * coverage in test/e2e/contracts.spec.ts), never by importing the page
 * function into an integration test; test/e2e/contract-preview.spec.ts
 * covers that layer for this route.
 *
 * Also proves the read-only invariant directly: a `getContractForStaff`
 * read (standing in for what the Preview route itself does — the exact
 * same query, see that route's own header comment) never mutates the
 * Contract row or writes an Activity row, and never populates a SEND
 * snapshot ahead of an actual Send.
 */
describe("Contract Preview — access gate and no-mutation guarantee", () => {
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

  describe("status/access gate, against real persisted rows", () => {
    it("a non-archived DRAFT Contract is previewable", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      contractIds.push(created.contract.id);

      const contract = await getContractForStaff(fixtures.orgA.id, created.contract.id);
      expect(contract).not.toBeNull();
      expect(isContractPreviewable(contract!.status, contract!.archivedAt)).toBe(true);
    });

    it("an archived DRAFT Contract is NOT previewable", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      contractIds.push(created.contract.id);

      await archiveContract(fixtures.orgA.id, created.contract.id);

      const contract = await getContractForStaff(fixtures.orgA.id, created.contract.id);
      expect(contract).not.toBeNull();
      expect(contract!.status).toBe("DRAFT");
      expect(contract!.archivedAt).not.toBeNull();
      expect(isContractPreviewable(contract!.status, contract!.archivedAt)).toBe(false);
    });

    it("a SENT Contract is NOT previewable", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      contractIds.push(created.contract.id);

      const sent = await sendContract(fixtures.orgA.id, created.contract.id, owner);
      expect(sent.ok).toBe(true);

      const contract = await getContractForStaff(fixtures.orgA.id, created.contract.id);
      expect(contract!.status).toBe("SENT");
      expect(isContractPreviewable(contract!.status, contract!.archivedAt)).toBe(false);
    });

    it("an ACCEPTED Contract is NOT previewable", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      contractIds.push(created.contract.id);

      await sendContract(fixtures.orgA.id, created.contract.id, owner);
      const accepted = await acceptContractByStaff(fixtures.orgA.id, created.contract.id, owner);
      expect(accepted.ok).toBe(true);

      const contract = await getContractForStaff(fixtures.orgA.id, created.contract.id);
      expect(contract!.status).toBe("ACCEPTED");
      expect(isContractPreviewable(contract!.status, contract!.archivedAt)).toBe(false);
    });

    it("a TERMINATED Contract is NOT previewable", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      contractIds.push(created.contract.id);

      await sendContract(fixtures.orgA.id, created.contract.id, owner);
      await acceptContractByStaff(fixtures.orgA.id, created.contract.id, owner);
      const terminated = await terminateContract(fixtures.orgA.id, created.contract.id, owner);
      expect(terminated.ok).toBe(true);

      const contract = await getContractForStaff(fixtures.orgA.id, created.contract.id);
      expect(contract!.status).toBe("TERMINATED");
      expect(isContractPreviewable(contract!.status, contract!.archivedAt)).toBe(false);
    });
  });

  describe("tenant isolation (same gate getContractForStaff already establishes elsewhere)", () => {
    it("a foreign-org Contract resolves to null, indistinguishable from nonexistent", async () => {
      const orgBOwnerActor = actorFor(fixtures.orgBOwner, "OWNER");
      const created = await createContract(fixtures.orgB.id, orgBOwnerActor, contractInput(fixtures.clientB.id));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      contractIds.push(created.contract.id);

      const contract = await getContractForStaff(fixtures.orgA.id, created.contract.id);
      expect(contract).toBeNull();
    });

    it("a nonexistent (well-formed) Contract id resolves to null", async () => {
      const contract = await getContractForStaff(fixtures.orgA.id, randomUUID());
      expect(contract).toBeNull();
    });

    it("a malformed (non-UUID) Contract id resolves to null, never reaching the database as a raw string", async () => {
      const contract = await getContractForStaff(fixtures.orgA.id, "not-a-real-uuid");
      expect(contract).toBeNull();
    });
  });

  describe("no-mutation guarantee", () => {
    it("reading a DRAFT Contract (the Preview route's own query) never changes updatedAt, status, timestamps, snapshots, or the Activity count", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      contractIds.push(created.contract.id);

      const before = await prisma.contract.findUniqueOrThrow({ where: { id: created.contract.id } });
      const activityCountBefore = await prisma.activity.count({ where: { entityType: "CONTRACT", entityId: created.contract.id } });

      // Simulates opening Preview multiple times — the exact same
      // read-only query the route itself performs, called repeatedly.
      await getContractForStaff(fixtures.orgA.id, created.contract.id);
      await getContractForStaff(fixtures.orgA.id, created.contract.id);
      await getContractForStaff(fixtures.orgA.id, created.contract.id);

      const after = await prisma.contract.findUniqueOrThrow({ where: { id: created.contract.id } });
      const activityCountAfter = await prisma.activity.count({ where: { entityType: "CONTRACT", entityId: created.contract.id } });

      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      expect(after.status).toBe(before.status);
      expect(after.sentAt).toBeNull();
      expect(after.acceptedAt).toBeNull();
      expect(after.terminatedAt).toBeNull();
      expect(after.organizationSnapshot).toBeNull();
      expect(after.clientSnapshot).toBeNull();
      expect(after.signatorySnapshot).toBeNull();
      expect(activityCountAfter).toBe(activityCountBefore);
    });

    it("snapshot immutability regression: repeated 'preview' reads before Send never populate snapshots, and the subsequent real Send still populates them exactly as before", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      contractIds.push(created.contract.id);

      // "Open Preview" several times before ever sending.
      for (let i = 0; i < 3; i++) {
        const previewed = await getContractForStaff(fixtures.orgA.id, created.contract.id);
        expect(previewed!.organizationSnapshot).toBeNull();
        expect(previewed!.clientSnapshot).toBeNull();
        expect(previewed!.signatorySnapshot).toBeNull();
        expect(previewed!.status).toBe("DRAFT");
      }

      // The real SEND transaction remains the sole place snapshots are
      // ever written, and still behaves exactly as before this slice.
      const sent = await sendContract(fixtures.orgA.id, created.contract.id, owner);
      expect(sent.ok).toBe(true);
      if (!sent.ok) return;

      expect(sent.contract.status).toBe("SENT");
      expect(sent.contract.organizationSnapshot).not.toBeNull();
      expect(sent.contract.clientSnapshot).not.toBeNull();
      expect(sent.contract.sentAt).not.toBeNull();
    });
  });
});
