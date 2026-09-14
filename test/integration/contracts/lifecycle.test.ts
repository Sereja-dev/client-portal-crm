import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createContract,
  sendContract,
  acceptContractByStaff,
  terminateContract,
  archiveContract,
  restoreContract,
} from "@/lib/contracts/service";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actorFor, contractInput, cleanupContracts } from "./helpers";

describe("Contracts — lifecycle (send / accept / terminate / archive / restore)", () => {
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

  async function createDraft(overrides: Parameters<typeof contractInput>[1] = {}) {
    const owner = actorFor(fixtures.owner, "OWNER");
    const result = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, overrides));
    if (!result.ok) throw new Error("fixture setup failed");
    contractIds.push(result.contract.id);
    return result.contract;
  }

  describe("sendContract", () => {
    it("DRAFT -> SENT: sentAt set, all 3 snapshots written (signatory null when none selected)", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();

      const result = await sendContract(fixtures.orgA.id, draft.id, owner);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.contract.status).toBe("SENT");
      expect(result.contract.sentAt).not.toBeNull();
      expect(result.contract.organizationSnapshot).not.toBeNull();
      expect(result.contract.clientSnapshot).not.toBeNull();
      expect(result.contract.signatorySnapshot).toBeNull();
    });

    it("writes a real signatorySnapshot when a signatoryContactId is set", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const contact = await prisma.clientContact.create({
        data: { organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, name: "Jane Doe", email: "jane@example.com", role: "CEO" },
      });
      const draft = await createDraft({ signatoryContactId: contact.id });

      const result = await sendContract(fixtures.orgA.id, draft.id, owner);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const snapshot = result.contract.signatorySnapshot as { name: string; email: string | null; role: string | null };
        expect(snapshot.name).toBe("Jane Doe");
        expect(snapshot.email).toBe("jane@example.com");
        expect(snapshot.role).toBe("CEO");
      }
      await prisma.clientContact.delete({ where: { id: contact.id } });
    });

    it("writes a STATUS_CHANGED Activity row (DRAFT -> SENT)", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      await sendContract(fixtures.orgA.id, draft.id, owner);

      const activity = await prisma.activity.findFirst({
        where: { organizationId: fixtures.orgA.id, entityType: "CONTRACT", entityId: draft.id, action: "STATUS_CHANGED" },
      });
      expect(activity).not.toBeNull();
      expect(activity?.metadata).toMatchObject({ from: "DRAFT", to: "SENT" });
    });

    it("cannot send an already-SENT Contract (INVALID_TRANSITION)", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      await sendContract(fixtures.orgA.id, draft.id, owner);

      const second = await sendContract(fixtures.orgA.id, draft.id, owner);
      expect(second).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
    });

    it("returns NOT_FOUND for a nonexistent/foreign-org Contract id", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const result = await sendContract(fixtures.orgA.id, randomUUID(), owner);
      expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
    });

    it("document content is frozen once SENT -- updateContractDocument returns NOT_EDITABLE", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      await sendContract(fixtures.orgA.id, draft.id, owner);

      const { updateContractDocument } = await import("@/lib/contracts/service");
      const result = await updateContractDocument(fixtures.orgA.id, draft.id, owner, contractInput(fixtures.clientA.id, { title: "Hacked" }));
      expect(result).toEqual({ ok: false, reason: "NOT_EDITABLE" });
    });
  });

  describe("acceptContractByStaff", () => {
    it("SENT -> ACCEPTED: acceptedAt/acceptedByUserId set, acceptedByPortalUserId stays null", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      await sendContract(fixtures.orgA.id, draft.id, owner);

      const result = await acceptContractByStaff(fixtures.orgA.id, draft.id, owner);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.contract.status).toBe("ACCEPTED");
      expect(result.contract.acceptedAt).not.toBeNull();
      expect(result.contract.acceptedByUserId).toBe(owner.id);
      expect(result.contract.acceptedByPortalUserId).toBeNull();
    });

    it.each(["OWNER", "ADMIN", "MEMBER"] as const)("%s may record Staff acceptance", async (role) => {
      const creator = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      await sendContract(fixtures.orgA.id, draft.id, creator);

      const actorUser = role === "OWNER" ? fixtures.owner : role === "ADMIN" ? fixtures.admin : fixtures.member;
      const actor = actorFor(actorUser, role);
      const result = await acceptContractByStaff(fixtures.orgA.id, draft.id, actor);
      expect(result.ok).toBe(true);
    });

    it("snapshots are unchanged by acceptance even if Client/Profile changed after send", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      const sent = await sendContract(fixtures.orgA.id, draft.id, owner);
      expect(sent.ok).toBe(true);
      if (!sent.ok) return;
      const snapshotAtSend = sent.contract.clientSnapshot;

      await prisma.client.update({ where: { id: fixtures.clientA.id }, data: { name: "Renamed Client Co" } });

      const accepted = await acceptContractByStaff(fixtures.orgA.id, draft.id, owner);
      expect(accepted.ok).toBe(true);
      if (accepted.ok) {
        expect(accepted.contract.clientSnapshot).toEqual(snapshotAtSend);
      }

      await prisma.client.update({ where: { id: fixtures.clientA.id }, data: { name: "Test Client A" } });
    });

    it("cannot accept a DRAFT Contract", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      const result = await acceptContractByStaff(fixtures.orgA.id, draft.id, owner);
      expect(result).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
    });

    it("cannot accept an already-ACCEPTED Contract twice", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      await sendContract(fixtures.orgA.id, draft.id, owner);
      await acceptContractByStaff(fixtures.orgA.id, draft.id, owner);

      const second = await acceptContractByStaff(fixtures.orgA.id, draft.id, owner);
      expect(second).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
    });

    it("cannot accept a TERMINATED Contract", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      await sendContract(fixtures.orgA.id, draft.id, owner);
      await acceptContractByStaff(fixtures.orgA.id, draft.id, owner);
      await terminateContract(fixtures.orgA.id, draft.id, owner);

      const result = await acceptContractByStaff(fixtures.orgA.id, draft.id, owner);
      expect(result).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
    });

    it("cannot accept an archived Contract", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      await sendContract(fixtures.orgA.id, draft.id, owner);
      await archiveContract(fixtures.orgA.id, draft.id);

      const result = await acceptContractByStaff(fixtures.orgA.id, draft.id, owner);
      expect(result).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
    });

    it("double-accept race: concurrent calls resolve to exactly one success with consistent actor metadata", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const admin = actorFor(fixtures.admin, "ADMIN");
      const draft = await createDraft();
      await sendContract(fixtures.orgA.id, draft.id, owner);

      const [a, b] = await Promise.all([
        acceptContractByStaff(fixtures.orgA.id, draft.id, owner),
        acceptContractByStaff(fixtures.orgA.id, draft.id, admin),
      ]);

      const results = [a, b];
      const successes = results.filter((r) => r.ok);
      const failures = results.filter((r) => !r.ok);
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toEqual({ ok: false, reason: "INVALID_TRANSITION" });

      const final = await prisma.contract.findUniqueOrThrow({ where: { id: draft.id } });
      expect(final.status).toBe("ACCEPTED");
      // Exactly one actor source populated -- never both, never neither.
      expect(final.acceptedByUserId === null).toBe(false);
      expect(final.acceptedByPortalUserId).toBeNull();
    });
  });

  describe("terminateContract", () => {
    it("ACCEPTED -> TERMINATED: terminatedAt set, snapshots untouched", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      await sendContract(fixtures.orgA.id, draft.id, owner);
      const accepted = await acceptContractByStaff(fixtures.orgA.id, draft.id, owner);
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) return;

      const result = await terminateContract(fixtures.orgA.id, draft.id, owner);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.contract.status).toBe("TERMINATED");
        expect(result.contract.terminatedAt).not.toBeNull();
        expect(result.contract.clientSnapshot).toEqual(accepted.contract.clientSnapshot);
      }
    });

    it("cannot terminate a DRAFT or SENT Contract", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draftOnly = await createDraft();
      expect(await terminateContract(fixtures.orgA.id, draftOnly.id, owner)).toEqual({ ok: false, reason: "INVALID_TRANSITION" });

      const sentOnly = await createDraft();
      await sendContract(fixtures.orgA.id, sentOnly.id, owner);
      expect(await terminateContract(fixtures.orgA.id, sentOnly.id, owner)).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
    });

    it("no un-terminate: terminating twice fails", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      await sendContract(fixtures.orgA.id, draft.id, owner);
      await acceptContractByStaff(fixtures.orgA.id, draft.id, owner);
      await terminateContract(fixtures.orgA.id, draft.id, owner);

      const second = await terminateContract(fixtures.orgA.id, draft.id, owner);
      expect(second).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
    });
  });

  describe("archiveContract / restoreContract", () => {
    it("archives and restores independently of status, idempotently", async () => {
      const draft = await createDraft();

      const archived = await archiveContract(fixtures.orgA.id, draft.id);
      expect(archived.ok).toBe(true);
      if (archived.ok) expect(archived.contract.archivedAt).not.toBeNull();

      // Idempotent no-op on a redundant call.
      const archivedAgain = await archiveContract(fixtures.orgA.id, draft.id);
      expect(archivedAgain.ok).toBe(true);
      if (archivedAgain.ok && archived.ok) {
        expect(archivedAgain.contract.archivedAt?.getTime()).toBe(archived.contract.archivedAt?.getTime());
      }

      const restored = await restoreContract(fixtures.orgA.id, draft.id);
      expect(restored.ok).toBe(true);
      if (restored.ok) expect(restored.contract.archivedAt).toBeNull();

      const restoredAgain = await restoreContract(fixtures.orgA.id, draft.id);
      expect(restoredAgain.ok).toBe(true);
      if (restoredAgain.ok) expect(restoredAgain.contract.archivedAt).toBeNull();
    });

    it("archive does not change status/sentAt/acceptedAt/terminatedAt/snapshots", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      const sent = await sendContract(fixtures.orgA.id, draft.id, owner);
      expect(sent.ok).toBe(true);
      if (!sent.ok) return;

      const archived = await archiveContract(fixtures.orgA.id, draft.id);
      expect(archived.ok).toBe(true);
      if (archived.ok) {
        expect(archived.contract.status).toBe("SENT");
        expect(archived.contract.sentAt?.getTime()).toBe(sent.contract.sentAt?.getTime());
        expect(archived.contract.clientSnapshot).toEqual(sent.contract.clientSnapshot);
      }
    });

    it("returns NOT_FOUND for a nonexistent/foreign-org Contract id", async () => {
      expect(await archiveContract(fixtures.orgA.id, randomUUID())).toEqual({ ok: false, reason: "NOT_FOUND" });
      expect(await restoreContract(fixtures.orgA.id, randomUUID())).toEqual({ ok: false, reason: "NOT_FOUND" });
    });
  });
});
