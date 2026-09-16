import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createContract,
  sendContract,
  acceptContractByStaff,
  acceptContractByPortal,
  terminateContract,
  archiveContract,
} from "@/lib/contracts/service";
import { getPortalContracts, getPortalContract } from "@/lib/client-portal/queries";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { setMockAuthUser, resetAuthMock } from "../../support/auth-mock";
import { actorFor, contractInput, cleanupContracts } from "./helpers";

/**
 * Contracts Portal V1 §27 — the new Portal-safe read queries
 * (getPortalContracts/getPortalContract in src/lib/client-portal/
 * queries.ts). Deliberately NOT built on getContractForPortalClient
 * (Staff-oriented, unselected full row) — these tests prove the new
 * queries' own visible-status scoping, tenant isolation, and (critically)
 * that internalNotes never appears in the returned object shape at all,
 * not merely "isn't rendered."
 */
describe("Contracts Portal V1 — Portal-safe queries", () => {
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

  const owner = () => actorFor(fixtures.owner, "OWNER");

  async function createDraftForClientA(overrides: Record<string, unknown> = {}) {
    const created = await createContract(fixtures.orgA.id, owner(), contractInput(fixtures.clientA.id, overrides));
    if (!created.ok) throw new Error("fixture setup failed");
    contractIds.push(created.contract.id);
    return created.contract;
  }

  async function createSentForClientA(overrides: Record<string, unknown> = {}) {
    const draft = await createDraftForClientA(overrides);
    const sent = await sendContract(fixtures.orgA.id, draft.id, owner());
    if (!sent.ok) throw new Error("fixture setup failed");
    return sent.contract;
  }

  describe("getPortalContracts", () => {
    it("1. returns the own Client's SENT contract", async () => {
      const contract = await createSentForClientA();
      const results = await getPortalContracts(fixtures.clientA.id, fixtures.orgA.id);
      expect(results.some((c) => c.id === contract.id)).toBe(true);
    });

    it("2. returns an ACCEPTED contract", async () => {
      const sent = await createSentForClientA();
      const accepted = await acceptContractByStaff(fixtures.orgA.id, sent.id, owner());
      if (!accepted.ok) throw new Error("fixture setup failed");

      const results = await getPortalContracts(fixtures.clientA.id, fixtures.orgA.id);
      expect(results.some((c) => c.id === sent.id && c.status === "ACCEPTED")).toBe(true);
    });

    it("3. returns a TERMINATED contract", async () => {
      const sent = await createSentForClientA();
      const accepted = await acceptContractByStaff(fixtures.orgA.id, sent.id, owner());
      if (!accepted.ok) throw new Error("fixture setup failed");
      const terminated = await terminateContract(fixtures.orgA.id, sent.id, owner());
      if (!terminated.ok) throw new Error("fixture setup failed");

      const results = await getPortalContracts(fixtures.clientA.id, fixtures.orgA.id);
      expect(results.some((c) => c.id === sent.id && c.status === "TERMINATED")).toBe(true);
    });

    it("4. excludes a DRAFT contract", async () => {
      const draft = await createDraftForClientA();
      const results = await getPortalContracts(fixtures.clientA.id, fixtures.orgA.id);
      expect(results.some((c) => c.id === draft.id)).toBe(false);
    });

    it("5. excludes an archived contract, even though its stored status is SENT", async () => {
      const sent = await createSentForClientA();
      const archived = await archiveContract(fixtures.orgA.id, sent.id);
      if (!archived.ok) throw new Error("fixture setup failed");

      const results = await getPortalContracts(fixtures.clientA.id, fixtures.orgA.id);
      expect(results.some((c) => c.id === sent.id)).toBe(false);
    });

    it("6. excludes another Client's contract (same organization)", async () => {
      const otherClient = await prisma.client.create({
        data: { name: `Other Client ${fixtures.runId}`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
      });
      const created = await createContract(fixtures.orgA.id, owner(), contractInput(otherClient.id));
      if (!created.ok) throw new Error("fixture setup failed");
      contractIds.push(created.contract.id);
      const sent = await sendContract(fixtures.orgA.id, created.contract.id, owner());
      if (!sent.ok) throw new Error("fixture setup failed");

      const results = await getPortalContracts(fixtures.clientA.id, fixtures.orgA.id);
      expect(results.some((c) => c.id === sent.contract.id)).toBe(false);

      // Contract.clientId is onDelete: Restrict -- the Contract itself
      // must be removed before its Client (contractIds's own afterEach
      // cleanup runs after this test body, so it's done explicitly here,
      // in the correct order, rather than relying on that timing).
      await prisma.contract.delete({ where: { id: sent.contract.id } });
      contractIds = contractIds.filter((id) => id !== sent.contract.id);
      await prisma.client.delete({ where: { id: otherClient.id } });
    });
  });

  describe("getPortalContract", () => {
    it("7. returns the own Client's visible contract", async () => {
      const contract = await createSentForClientA();
      const result = await getPortalContract(fixtures.clientA.id, fixtures.orgA.id, contract.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(contract.id);
      expect(result?.contractNumber).toBe(contract.contractNumber);
    });

    it("8a. a foreign Client's contract returns null, indistinguishable from nonexistent", async () => {
      const contract = await createSentForClientA();
      const result = await getPortalContract(fixtures.clientB.id, fixtures.orgB.id, contract.id);
      expect(result).toBeNull();
    });

    it("8b. a malformed id returns null, never throws", async () => {
      const result = await getPortalContract(fixtures.clientA.id, fixtures.orgA.id, "not-a-uuid");
      expect(result).toBeNull();
    });

    it("8c. a nonexistent id returns null", async () => {
      const result = await getPortalContract(fixtures.clientA.id, fixtures.orgA.id, randomUUID());
      expect(result).toBeNull();
    });

    it("8d. a DRAFT contract returns null (never visible to Portal at all)", async () => {
      const draft = await createDraftForClientA();
      const result = await getPortalContract(fixtures.clientA.id, fixtures.orgA.id, draft.id);
      expect(result).toBeNull();
    });

    it("8e. an archived contract returns null", async () => {
      const sent = await createSentForClientA();
      const archived = await archiveContract(fixtures.orgA.id, sent.id);
      if (!archived.ok) throw new Error("fixture setup failed");
      const result = await getPortalContract(fixtures.clientA.id, fixtures.orgA.id, sent.id);
      expect(result).toBeNull();
    });

    it("9. internalNotes is never present in the returned object shape, even when the row has one set", async () => {
      const draft = await createDraftForClientA();
      await prisma.contract.update({ where: { id: draft.id }, data: { internalNotes: "Sensitive staff-only context." } });
      const sent = await sendContract(fixtures.orgA.id, draft.id, owner());
      if (!sent.ok) throw new Error("fixture setup failed");

      const result = await getPortalContract(fixtures.clientA.id, fixtures.orgA.id, draft.id);
      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty("internalNotes");
      expect(JSON.stringify(result)).not.toContain("Sensitive staff-only context");

      const listResults = await getPortalContracts(fixtures.clientA.id, fixtures.orgA.id);
      const listRow = listResults.find((c) => c.id === draft.id);
      expect(listRow).not.toHaveProperty("internalNotes");
    });

    it("10. exposes the three frozen snapshot fields, parseable by the existing strict parsers", async () => {
      const sent = await createSentForClientA();
      const result = await getPortalContract(fixtures.clientA.id, fixtures.orgA.id, sent.id);
      expect(result).not.toBeNull();
      expect(result?.organizationSnapshot).not.toBeNull();
      expect(result?.clientSnapshot).not.toBeNull();
      // No signatoryContactId was set on this fixture contract, so
      // signatorySnapshot is legitimately null — matches Staff's own
      // identical "no signatory chosen" precedent.
      expect(result?.signatorySnapshot).toBeNull();

      const { parseContractOrganizationSnapshot, parseContractClientSnapshot } = await import("@/lib/contracts/snapshot-types");
      expect(parseContractOrganizationSnapshot(result?.organizationSnapshot).ok).toBe(true);
      expect(parseContractClientSnapshot(result?.clientSnapshot).ok).toBe(true);
    });

    it("does not expose acceptedByUserId/acceptedByPortalUserId raw ids, and correctly discriminates the accepting actor", async () => {
      const sent = await createSentForClientA();
      setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
      const accepted = await acceptContractByPortal(sent.id);
      expect(accepted.ok).toBe(true);

      const result = await getPortalContract(fixtures.clientA.id, fixtures.orgA.id, sent.id);
      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty("acceptedByUserId");
      expect(result).not.toHaveProperty("acceptedByPortalUserId");
      expect(result?.acceptedBy).toEqual({ kind: "portal", name: fixtures.portalUser.name });
    });

    it("discriminates a Staff-recorded acceptance as 'staff', never exposing a Staff name/email", async () => {
      const sent = await createSentForClientA();
      const accepted = await acceptContractByStaff(fixtures.orgA.id, sent.id, owner());
      if (!accepted.ok) throw new Error("fixture setup failed");

      const result = await getPortalContract(fixtures.clientA.id, fixtures.orgA.id, sent.id);
      expect(result?.acceptedBy).toEqual({ kind: "staff" });
      expect(JSON.stringify(result)).not.toContain(fixtures.owner.name);
      expect(JSON.stringify(result)).not.toContain(fixtures.owner.email);
    });
  });
});
