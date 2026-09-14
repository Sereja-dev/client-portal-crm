import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createContract, sendContract, acceptContractByStaff, updateContractDocument } from "@/lib/contracts/service";
import { getContractForStaff } from "@/lib/contracts/queries";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actorFor, contractInput, cleanupContracts } from "./helpers";

/**
 * Contracts Phase 1 — the two critical, explicitly-required test
 * sequences (locked architecture §9/§10/§26/§27):
 *
 * 1. Snapshot immutability: DRAFT -> Send -> capture snapshots -> edit
 *    OrganizationProfile -> edit Client -> edit/archive the signatory
 *    ClientContact -> read the Contract again -> snapshots are
 *    byte-identical; document fields cannot be edited after SEND.
 * 2. Send-vs-accept: snapshots are written ONCE at SEND, never rebuilt
 *    at acceptance, even when Client/Profile changed in between.
 */
describe("Contracts — snapshot immutability", () => {
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

  it("snapshots remain byte-identical after Profile/Client/Contact edits post-SEND, and document fields become uneditable", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");

    // 1. A signatory Contact, so all three snapshot kinds are exercised.
    const contact = await prisma.clientContact.create({
      data: { organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, name: "Original Signatory", email: "orig@example.com", role: "CFO" },
    });

    // 2. Create DRAFT.
    const created = await createContract(
      fixtures.orgA.id,
      owner,
      contractInput(fixtures.clientA.id, { signatoryContactId: contact.id }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    contractIds.push(created.contract.id);

    // 3. Send -- snapshots are built and persisted here, exactly once.
    const sent = await sendContract(fixtures.orgA.id, created.contract.id, owner);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    // 4. Capture the stored snapshots immediately after send.
    const organizationSnapshotAtSend = sent.contract.organizationSnapshot;
    const clientSnapshotAtSend = sent.contract.clientSnapshot;
    const signatorySnapshotAtSend = sent.contract.signatorySnapshot;
    expect(organizationSnapshotAtSend).not.toBeNull();
    expect(clientSnapshotAtSend).not.toBeNull();
    expect(signatorySnapshotAtSend).not.toBeNull();

    // 5. Edit OrganizationProfile (create one if none exists yet for this fixture org).
    const existingProfile = await prisma.organizationProfile.findUnique({ where: { organizationId: fixtures.orgA.id } });
    if (existingProfile) {
      await prisma.organizationProfile.update({ where: { organizationId: fixtures.orgA.id }, data: { legalName: "Mutated Legal Name LLC" } });
    } else {
      await prisma.organizationProfile.create({
        data: { organizationId: fixtures.orgA.id, legalName: "Mutated Legal Name LLC", country: "US", currency: "USD", timezone: "UTC" },
      });
    }

    // 6. Edit Client.
    await prisma.client.update({ where: { id: fixtures.clientA.id }, data: { name: "Mutated Client Name", billingLegalName: "Mutated Billing LLC" } });

    // 7. Edit, then archive, the signatory ClientContact.
    await prisma.clientContact.update({ where: { id: contact.id }, data: { name: "Mutated Signatory Name", role: "COO" } });
    await prisma.clientContact.update({ where: { id: contact.id }, data: { archivedAt: new Date() } });

    // 8. Read the Contract again -- snapshots must be byte-identical to what was captured right after send.
    const reread = await getContractForStaff(fixtures.orgA.id, created.contract.id);
    expect(reread).not.toBeNull();
    expect(reread?.organizationSnapshot).toEqual(organizationSnapshotAtSend);
    expect(reread?.clientSnapshot).toEqual(clientSnapshotAtSend);
    expect(reread?.signatorySnapshot).toEqual(signatorySnapshotAtSend);

    // Also prove document fields cannot be edited after SEND.
    const editAttempt = await updateContractDocument(
      fixtures.orgA.id,
      created.contract.id,
      owner,
      contractInput(fixtures.clientA.id, { title: "Attempted post-send edit" }),
    );
    expect(editAttempt).toEqual({ ok: false, reason: "NOT_EDITABLE" });
    const afterEditAttempt = await getContractForStaff(fixtures.orgA.id, created.contract.id);
    expect(afterEditAttempt?.title).toBe(reread?.title);

    // Cleanup the ClientContact and restore Client/Profile back to their fixture defaults.
    await prisma.clientContact.delete({ where: { id: contact.id } });
    await prisma.client.update({ where: { id: fixtures.clientA.id }, data: { name: "Test Client A", billingLegalName: null } });
    if (existingProfile) {
      await prisma.organizationProfile.update({ where: { organizationId: fixtures.orgA.id }, data: { legalName: existingProfile.legalName } });
    } else {
      await prisma.organizationProfile.delete({ where: { organizationId: fixtures.orgA.id } });
    }
  });

  it("send-vs-accept: acceptance never rebuilds or alters snapshots, even though Client/Profile changed in between", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");

    const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    contractIds.push(created.contract.id);

    const sent = await sendContract(fixtures.orgA.id, created.contract.id, owner);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const snapshotsAtSend = {
      organization: sent.contract.organizationSnapshot,
      client: sent.contract.clientSnapshot,
      signatory: sent.contract.signatorySnapshot,
    };

    await prisma.client.update({ where: { id: fixtures.clientA.id }, data: { name: "Changed Between Send And Accept" } });

    const accepted = await acceptContractByStaff(fixtures.orgA.id, created.contract.id, owner);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.contract.organizationSnapshot).toEqual(snapshotsAtSend.organization);
      expect(accepted.contract.clientSnapshot).toEqual(snapshotsAtSend.client);
      expect(accepted.contract.signatorySnapshot).toEqual(snapshotsAtSend.signatory);
    }

    await prisma.client.update({ where: { id: fixtures.clientA.id }, data: { name: "Test Client A" } });
  });
});
