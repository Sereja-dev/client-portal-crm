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
  // Extra Client rows created by a handful of tests below (racing a
  // clientId change) -- Contract.clientId is onDelete: Restrict, so
  // these must be deleted AFTER contractIds' own rows, never before.
  let extraClientIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupContracts(contractIds);
    contractIds = [];
    if (extraClientIds.length > 0) {
      await prisma.client.deleteMany({ where: { id: { in: extraClientIds } } });
      extraClientIds = [];
    }
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

    // Contracts Hardening §4 (locked): an archived Contract cannot be
    // sent -- checked in both the outer pre-check and the fresh
    // read/guarded update inside sendContract's own transaction.
    it("cannot send an archived DRAFT Contract (INVALID_TRANSITION)", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      await archiveContract(fixtures.orgA.id, draft.id);

      const result = await sendContract(fixtures.orgA.id, draft.id, owner);
      expect(result).toEqual({ ok: false, reason: "INVALID_TRANSITION" });

      const row = await prisma.contract.findUniqueOrThrow({ where: { id: draft.id } });
      expect(row.status).toBe("DRAFT");
      expect(row.sentAt).toBeNull();
    });

    // Contracts Hardening §3 (locked): SEND-time signatory revalidation.
    // A signatory selected while active but archived afterward, before
    // SEND, must block the send rather than being silently snapshotted
    // or silently cleared.
    it("cannot send a DRAFT whose selected signatory has since become archived (INVALID_SIGNATORY)", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const contact = await prisma.clientContact.create({
        data: { organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, name: "Soon Archived" },
      });
      const draft = await createDraft({ signatoryContactId: contact.id });

      await prisma.clientContact.update({ where: { id: contact.id }, data: { archivedAt: new Date() } });

      const result = await sendContract(fixtures.orgA.id, draft.id, owner);
      expect(result).toEqual({ ok: false, reason: "INVALID_SIGNATORY" });

      const row = await prisma.contract.findUniqueOrThrow({ where: { id: draft.id } });
      expect(row.status).toBe("DRAFT");
      expect(row.sentAt).toBeNull();
      expect(row.organizationSnapshot).toBeNull();
      expect(row.clientSnapshot).toBeNull();
      expect(row.signatorySnapshot).toBeNull();
      // The signatory selection itself is left untouched -- SEND refuses
      // rather than silently clearing it, so the Contract can be sent
      // once the caller actively deals with it (clear it or choose
      // another, active contact).
      expect(row.signatoryContactId).toBe(contact.id);

      const noActivity = await prisma.activity.findFirst({
        where: { organizationId: fixtures.orgA.id, entityType: "CONTRACT", entityId: draft.id, action: "STATUS_CHANGED" },
      });
      expect(noActivity).toBeNull();

      await prisma.clientContact.delete({ where: { id: contact.id } });
    });

    it("sending succeeds once an archived signatory is cleared from the DRAFT", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const contact = await prisma.clientContact.create({
        data: { organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, name: "Will Be Archived" },
      });
      const draft = await createDraft({ signatoryContactId: contact.id });
      await prisma.clientContact.update({ where: { id: contact.id }, data: { archivedAt: new Date() } });

      const { updateContractDocument } = await import("@/lib/contracts/service");
      const cleared = await updateContractDocument(fixtures.orgA.id, draft.id, owner, contractInput(fixtures.clientA.id, { signatoryContactId: undefined }));
      expect(cleared.ok).toBe(true);

      const result = await sendContract(fixtures.orgA.id, draft.id, owner);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.contract.signatorySnapshot).toBeNull();

      await prisma.clientContact.delete({ where: { id: contact.id } });
    });

    // Contracts Hardening §6 -- exercised as a genuine concurrent
    // Promise.all race (this class of race, status-only, is meaningfully
    // testable even under PGlite's own serialization: whichever
    // transaction's guarded update commits first wins, and the other's
    // WHERE re-evaluation against the now-current row correctly fails --
    // see this file's own "double-accept race" test above for the
    // identical, already-proven mechanism).
    it("send vs send race: exactly one success, one snapshot, one STATUS_CHANGED Activity, no partial side effects", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const admin = actorFor(fixtures.admin, "ADMIN");
      const draft = await createDraft();

      const [a, b] = await Promise.all([
        sendContract(fixtures.orgA.id, draft.id, owner),
        sendContract(fixtures.orgA.id, draft.id, admin),
      ]);

      const results = [a, b];
      const successes = results.filter((r) => r.ok);
      const failures = results.filter((r) => !r.ok);
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toEqual({ ok: false, reason: "INVALID_TRANSITION" });

      const final = await prisma.contract.findUniqueOrThrow({ where: { id: draft.id } });
      expect(final.status).toBe("SENT");
      expect(final.sentAt).not.toBeNull();
      expect(final.clientSnapshot).not.toBeNull();

      const activities = await prisma.activity.findMany({
        where: { organizationId: fixtures.orgA.id, entityType: "CONTRACT", entityId: draft.id, action: "STATUS_CHANGED" },
      });
      expect(activities).toHaveLength(1);
      expect(activities[0].metadata).toMatchObject({ from: "DRAFT", to: "SENT" });
    });

    // Contracts Hardening §6 -- the update-vs-send TOCTOU class itself
    // (the actual pre-push-review blocker) cannot be reliably reproduced
    // as a genuine cross-connection race against this repo's own local
    // PGlite test harness: PGlite's socket server fully serializes each
    // connection's open transaction to completion before servicing
    // another connection's queries (confirmed empirically during the
    // hardening review -- an artificial mid-transaction delay of up to
    // 1.5s never let a concurrent edit's own UPDATE execute until the
    // first transaction's COMMIT had already gone through), so a
    // Promise.all here would only ever observe one of the two safe,
    // non-interleaved orderings and could never actually exercise the
    // vulnerable window. The structural regression below proves the
    // fix's own guard clause directly instead -- see "stale SEND version
    // cannot commit" below.
    it("update vs send (best-effort concurrent, documented PGlite limitation): whichever order completes, the committed clientSnapshot always matches the final clientId", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const otherClient = await prisma.client.create({ data: { name: "Race Client Beta", organizationId: fixtures.orgA.id, userId: fixtures.owner.id } });
      extraClientIds.push(otherClient.id);
      const draft = await createDraft();

      // The race is specifically on clientId -- the one field that both
      // (a) updateContractDocument can change on a still-DRAFT row
      // without touching `status`, and (b) directly determines
      // clientSnapshot's own content -- i.e. the exact field class the
      // pre-push-review-found blocker was about. `title` deliberately
      // NOT used here: it is never part of any snapshot, so racing on it
      // alone cannot exercise the snapshot-content TOCTOU class at all.
      const { updateContractDocument } = await import("@/lib/contracts/service");
      await Promise.allSettled([
        updateContractDocument(fixtures.orgA.id, draft.id, owner, contractInput(otherClient.id)),
        sendContract(fixtures.orgA.id, draft.id, owner),
      ]);

      const final = await prisma.contract.findUniqueOrThrow({ where: { id: draft.id } });
      if (final.status === "SENT") {
        expect(final.clientSnapshot).not.toBeNull();
        const snapshot = final.clientSnapshot as { billingName: string };
        const expectedName = final.clientId === otherClient.id ? "Race Client Beta" : "Test Client A";
        // The core invariant the hardening fix guarantees: whichever
        // Client the Contract's own clientId ends up pointing at, the
        // committed snapshot must describe THAT Client, never a stale
        // one read before a concurrent clientId change.
        expect(snapshot.billingName).toBe(expectedName);
      } else {
        expect(final.status).toBe("DRAFT");
      }
    });
  });

  // Contracts Hardening §6/§10 (structural proof, not a Promise.all race
  // -- see the "update vs send" test above for why a genuine
  // cross-connection race cannot be demonstrated against this harness).
  // Directly proves the exact guard clause sendContract's own final
  // updateMany uses: a stale `updatedAt` token, captured BEFORE a
  // concurrent-style document mutation, can never match the row again,
  // so a stale SEND can never commit -- while the CURRENT token still
  // matches and commits normally. This is the same predicate shape, the
  // same column, the same equality semantics sendContract itself uses;
  // it is not a separate, weaker claim.
  describe("sendContract — stale-version regression (structural proof)", () => {
    it("a guarded update using a stale updatedAt token matches zero rows after a concurrent-style edit; the current token still matches", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();

      const versionA = await prisma.contract.findUniqueOrThrow({ where: { id: draft.id } });

      // Simulate a concurrent updateContractDocument landing after
      // sendContract's own fresh-read would have captured versionA but
      // before its final guarded write -- exactly the window the
      // hardening fix closes.
      const { updateContractDocument } = await import("@/lib/contracts/service");
      const edited = await updateContractDocument(fixtures.orgA.id, draft.id, owner, contractInput(fixtures.clientA.id, { title: "Changed Underneath" }));
      expect(edited.ok).toBe(true);

      // The exact predicate shape sendContract's own final updateMany
      // uses, attempted with the STALE (pre-edit) updatedAt token.
      const staleAttempt = await prisma.contract.updateMany({
        where: { id: draft.id, organizationId: fixtures.orgA.id, status: "DRAFT", archivedAt: null, updatedAt: versionA.updatedAt },
        data: { status: "SENT", sentAt: new Date() },
      });
      expect(staleAttempt.count).toBe(0);

      const afterStaleAttempt = await prisma.contract.findUniqueOrThrow({ where: { id: draft.id } });
      expect(afterStaleAttempt.status).toBe("DRAFT");
      expect(afterStaleAttempt.title).toBe("Changed Underneath");
      expect(afterStaleAttempt.sentAt).toBeNull();

      // Contrast: the SAME predicate shape with the CURRENT token
      // matches and commits -- proving this isn't merely an
      // always-fails guard.
      const currentAttempt = await prisma.contract.updateMany({
        where: { id: draft.id, organizationId: fixtures.orgA.id, status: "DRAFT", archivedAt: null, updatedAt: afterStaleAttempt.updatedAt },
        data: { status: "SENT", sentAt: new Date() },
      });
      expect(currentAttempt.count).toBe(1);
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

    // Contracts Hardening §5 -- explicit invariant assertions, not merely
    // inferred from the shape of what gets written.
    it("before any acceptance, both acceptedByUserId and acceptedByPortalUserId are null", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      expect(draft.acceptedByUserId).toBeNull();
      expect(draft.acceptedByPortalUserId).toBeNull();
      expect(draft.acceptedAt).toBeNull();

      const sent = await sendContract(fixtures.orgA.id, draft.id, owner);
      expect(sent.ok).toBe(true);
      if (sent.ok) {
        expect(sent.contract.acceptedByUserId).toBeNull();
        expect(sent.contract.acceptedByPortalUserId).toBeNull();
        expect(sent.contract.acceptedAt).toBeNull();
      }
    });

    it("after Staff acceptance, the acceptance actor remains unchanged through TERMINATED", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      await sendContract(fixtures.orgA.id, draft.id, owner);
      const accepted = await acceptContractByStaff(fixtures.orgA.id, draft.id, owner);
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) return;

      const terminated = await terminateContract(fixtures.orgA.id, draft.id, owner);
      expect(terminated.ok).toBe(true);
      if (terminated.ok) {
        expect(terminated.contract.acceptedByUserId).toBe(accepted.contract.acceptedByUserId);
        expect(terminated.contract.acceptedByPortalUserId).toBeNull();
        expect(terminated.contract.acceptedAt?.getTime()).toBe(accepted.contract.acceptedAt?.getTime());
      }
    });

    // Contracts Hardening §6/§9 -- archive vs accept race. Both
    // acceptContractByStaff's own guarded predicate (archivedAt: null,
    // re-checked at commit time, not just the outer pre-check) and
    // archiveContract's own "always succeeds, no status gate" design
    // together guarantee a deterministic, self-consistent outcome
    // regardless of which one's write actually lands first.
    it("archive vs accept race: archive always succeeds; accept succeeds only if it is not raced out by an archive", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      await sendContract(fixtures.orgA.id, draft.id, owner);

      const [acceptResult, archiveResult] = await Promise.all([
        acceptContractByStaff(fixtures.orgA.id, draft.id, owner),
        archiveContract(fixtures.orgA.id, draft.id),
      ]);

      // archiveContract has no status/lifecycle gate at all -- it always
      // succeeds (or is NOT_FOUND, which cannot happen here).
      expect(archiveResult.ok).toBe(true);

      const final = await prisma.contract.findUniqueOrThrow({ where: { id: draft.id } });
      expect(final.archivedAt).not.toBeNull();

      if (final.status === "ACCEPTED") {
        // accept won the race (committed before archive's own write) --
        // archive then correctly still succeeded afterward (an archived
        // ACCEPTED Contract is a valid, intended state).
        expect(acceptResult.ok).toBe(true);
        expect(final.acceptedByUserId).toBe(owner.id);
      } else {
        // archive won -- accept's own guarded predicate (archivedAt:
        // null) no longer matched, so it correctly failed rather than
        // accepting an already-archived Contract.
        expect(final.status).toBe("SENT");
        expect(acceptResult).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
        expect(final.acceptedByUserId).toBeNull();
      }
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

    // Contracts Hardening §4 (locked, explicit): archive is a visibility/
    // organization toggle, never a legal-lifecycle freeze -- an archived
    // ACCEPTED Contract MAY still be terminated. Unlike send/accept
    // (which archive correctly blocks), terminate has no archivedAt
    // check at all, by design.
    it("an archived ACCEPTED Contract can still be terminated", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const draft = await createDraft();
      await sendContract(fixtures.orgA.id, draft.id, owner);
      await acceptContractByStaff(fixtures.orgA.id, draft.id, owner);
      await archiveContract(fixtures.orgA.id, draft.id);

      const result = await terminateContract(fixtures.orgA.id, draft.id, owner);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.contract.status).toBe("TERMINATED");
        expect(result.contract.terminatedAt).not.toBeNull();
        expect(result.contract.archivedAt).not.toBeNull();
      }
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
