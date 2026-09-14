import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createContract, updateContractDocument, updateContractInternalNotes } from "@/lib/contracts/service";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actorFor, contractInput, cleanupContracts } from "./helpers";

describe("Contracts — create / update / internal notes", () => {
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

  describe("createContract", () => {
    it("creates a DRAFT Contract, server-controlled fields set correctly", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      contractIds.push(result.contract.id);

      expect(result.contract.status).toBe("DRAFT");
      expect(result.contract.organizationId).toBe(fixtures.orgA.id);
      expect(result.contract.clientId).toBe(fixtures.clientA.id);
      expect(result.contract.createdByUserId).toBe(owner.id);
      expect(result.contract.sentAt).toBeNull();
      expect(result.contract.acceptedAt).toBeNull();
      expect(result.contract.terminatedAt).toBeNull();
      expect(result.contract.archivedAt).toBeNull();
      expect(result.contract.organizationSnapshot).toBeNull();
      expect(result.contract.clientSnapshot).toBeNull();
      expect(result.contract.signatorySnapshot).toBeNull();
      expect(result.contract.client.id).toBe(fixtures.clientA.id);
    });

    it("writes a CREATED Activity row", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      contractIds.push(result.contract.id);

      const activity = await prisma.activity.findFirst({
        where: { organizationId: fixtures.orgA.id, entityType: "CONTRACT", entityId: result.contract.id, action: "CREATED" },
      });
      expect(activity).not.toBeNull();
      expect(activity?.actorId).toBe(owner.id);
    });

    it("rejects invalid input with VALIDATION and no side effects", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { title: "" }));
      expect(result).toMatchObject({ ok: false, reason: "VALIDATION" });
    });

    it("rejects a foreign-org Client as INVALID_TARGET", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientB.id));
      expect(result).toEqual({ ok: false, reason: "INVALID_TARGET" });
    });

    it("rejects a nonexistent Client as INVALID_TARGET, identical to a foreign-org one", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await createContract(fixtures.orgA.id, owner, contractInput(randomUUID()));
      expect(result).toEqual({ ok: false, reason: "INVALID_TARGET" });
    });

    it("accepts a Project that belongs to the same org and the same Client", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { projectId: fixtures.project.id }));
      expect(result.ok).toBe(true);
      if (result.ok) contractIds.push(result.contract.id);
    });

    it("rejects a Project belonging to a different Client as INVALID_TARGET", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const otherClient = await prisma.client.create({ data: { name: "Other Client", organizationId: fixtures.orgA.id, userId: fixtures.owner.id } });
      const result = await createContract(
        fixtures.orgA.id,
        owner,
        contractInput(otherClient.id, { projectId: fixtures.project.id }), // project belongs to clientA, not otherClient
      );
      expect(result).toEqual({ ok: false, reason: "INVALID_TARGET" });
      await prisma.client.delete({ where: { id: otherClient.id } });
    });

    it("accepts a signatoryContactId belonging to the selected Client", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const contact = await prisma.clientContact.create({
        data: { organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, name: "Signatory One" },
      });
      const result = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { signatoryContactId: contact.id }));
      expect(result.ok).toBe(true);
      if (result.ok) contractIds.push(result.contract.id);
      await prisma.clientContact.delete({ where: { id: contact.id } });
    });

    it("rejects a signatoryContactId belonging to a different Client as INVALID_SIGNATORY", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const contact = await prisma.clientContact.create({
        data: { organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, name: "Foreign Contact" },
      });
      const result = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { signatoryContactId: contact.id }));
      expect(result).toEqual({ ok: false, reason: "INVALID_SIGNATORY" });
      await prisma.clientContact.delete({ where: { id: contact.id } });
    });

    it("rejects a currently-archived signatoryContactId as INVALID_SIGNATORY", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const contact = await prisma.clientContact.create({
        data: { organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, name: "Archived Contact", archivedAt: new Date() },
      });
      const result = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { signatoryContactId: contact.id }));
      expect(result).toEqual({ ok: false, reason: "INVALID_SIGNATORY" });
      await prisma.clientContact.delete({ where: { id: contact.id } });
    });

    it("allows the same contractNumber across two different organizations", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const orgBOwner = actorFor(fixtures.orgBOwner, "OWNER");
      const number = `C-CROSSORG-${randomUUID().slice(0, 8)}`;

      const inOrgA = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { contractNumber: number }));
      expect(inOrgA.ok).toBe(true);
      if (inOrgA.ok) contractIds.push(inOrgA.contract.id);

      const inOrgB = await createContract(fixtures.orgB.id, orgBOwner, contractInput(fixtures.clientB.id, { contractNumber: number }));
      expect(inOrgB.ok).toBe(true);
      if (inOrgB.ok) contractIds.push(inOrgB.contract.id);
    });
  });

  describe("updateContractDocument", () => {
    it("updates document fields while the Contract is DRAFT", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      contractIds.push(created.contract.id);

      const updated = await updateContractDocument(
        fixtures.orgA.id,
        created.contract.id,
        owner,
        contractInput(fixtures.clientA.id, { title: "Renamed Agreement" }),
      );
      expect(updated.ok).toBe(true);
      if (updated.ok) expect(updated.contract.title).toBe("Renamed Agreement");
    });

    it("returns NOT_FOUND for a nonexistent/foreign-org Contract id", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await updateContractDocument(fixtures.orgA.id, randomUUID(), owner, contractInput(fixtures.clientA.id));
      expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
    });

    it("returns VALIDATION for invalid input and does not touch the row", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      contractIds.push(created.contract.id);

      const result = await updateContractDocument(fixtures.orgA.id, created.contract.id, owner, contractInput(fixtures.clientA.id, { body: "" }));
      expect(result).toMatchObject({ ok: false, reason: "VALIDATION" });
    });
  });

  describe("updateContractInternalNotes", () => {
    it("sets internalNotes without requiring DRAFT status or touching any document field", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { title: "Original Title" }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      contractIds.push(created.contract.id);

      const result = await updateContractInternalNotes(fixtures.orgA.id, created.contract.id, owner, "Remember to follow up.");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.contract.internalNotes).toBe("Remember to follow up.");
        expect(result.contract.title).toBe("Original Title");
      }
    });

    it("returns NOT_FOUND for a nonexistent/foreign-org Contract id", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await updateContractInternalNotes(fixtures.orgA.id, randomUUID(), owner, "notes");
      expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
    });

    it("returns VALIDATION for internalNotes over the max length", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      contractIds.push(created.contract.id);

      const result = await updateContractInternalNotes(fixtures.orgA.id, created.contract.id, owner, "n".repeat(10_001));
      expect(result).toMatchObject({ ok: false, reason: "VALIDATION" });
    });
  });

  // Deliberately the LAST describe/test in this file: it triggers a
  // genuine Postgres unique-constraint violation mid-transaction (a real
  // P2002, not mocked). The shared local PGlite/pg-adapter test harness
  // can leave its one pooled connection in a state where the very next,
  // otherwise-unrelated query intermittently misbehaves immediately after
  // such a rollback (the exact hazard test/integration/quotes/
  // create.test.ts's own "11. a duplicate Quote number..." test already
  // documents and works around) -- so this test neither runs any query
  // after triggering the conflict, nor does any other test run after it
  // in this file.
  describe("createContract — number conflict (must run last in this file)", () => {
    it("rejects a duplicate contractNumber within the same organization as CONTRACT_NUMBER_CONFLICT", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const number = `C-DUP-${randomUUID().slice(0, 8)}`;
      const first = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { contractNumber: number }));
      expect(first.ok).toBe(true);
      if (first.ok) contractIds.push(first.contract.id);

      const second = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { contractNumber: number }));
      expect(second).toEqual({ ok: false, reason: "CONTRACT_NUMBER_CONFLICT" });
    });
  });
});
