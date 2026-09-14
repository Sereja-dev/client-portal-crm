import { describe, expect, it, afterAll, afterEach, beforeAll } from "vitest";
import { createContract, updateContractDocument, sendContract, terminateContract, archiveContract, restoreContract } from "@/lib/contracts/service";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actorFor, contractInput, cleanupContracts } from "./helpers";

/**
 * Contracts Phase 1 — authorization (locked architecture §I: no
 * privileged-role gate; every authenticated Staff role — OWNER/ADMIN/
 * MEMBER — may list/view/create/update-a-DRAFT/send/terminate/archive/
 * restore). Staff acceptance's own OWNER/ADMIN/MEMBER matrix is already
 * covered in lifecycle.test.ts; this file covers the rest of the
 * lifecycle end to end for each role.
 */
describe("Contracts — authorization (any Staff role, full lifecycle)", () => {
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

  it.each(["OWNER", "ADMIN", "MEMBER"] as const)(
    "%s can create, update-DRAFT, send, terminate (after Staff-accepting), archive, and restore",
    async (role) => {
      const user = role === "OWNER" ? fixtures.owner : role === "ADMIN" ? fixtures.admin : fixtures.member;
      const actor = actorFor(user, role);

      const created = await createContract(fixtures.orgA.id, actor, contractInput(fixtures.clientA.id));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      contractIds.push(created.contract.id);

      const updated = await updateContractDocument(
        fixtures.orgA.id,
        created.contract.id,
        actor,
        contractInput(fixtures.clientA.id, { title: `Updated by ${role}` }),
      );
      expect(updated.ok).toBe(true);

      const sent = await sendContract(fixtures.orgA.id, created.contract.id, actor);
      expect(sent.ok).toBe(true);

      const { acceptContractByStaff } = await import("@/lib/contracts/service");
      const accepted = await acceptContractByStaff(fixtures.orgA.id, created.contract.id, actor);
      expect(accepted.ok).toBe(true);

      const terminated = await terminateContract(fixtures.orgA.id, created.contract.id, actor);
      expect(terminated.ok).toBe(true);

      const archived = await archiveContract(fixtures.orgA.id, created.contract.id);
      expect(archived.ok).toBe(true);

      const restored = await restoreContract(fixtures.orgA.id, created.contract.id);
      expect(restored.ok).toBe(true);
    },
  );
});
