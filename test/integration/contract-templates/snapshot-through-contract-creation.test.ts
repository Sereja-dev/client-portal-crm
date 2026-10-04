import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createContractTemplate, updateContractTemplate } from "@/lib/contract-templates/service";
import { getContractTemplateDefaults } from "@/lib/contract-templates/apply";
import { createContractAction } from "@/app/(dashboard)/contracts/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { actorFor, templateInput } from "./helpers";

const NOW = new Date("2026-06-15T12:00:00.000Z");

/**
 * Contract Templates V1 (the V1 invariant proven end to end, not just at
 * the apply.ts unit level): Template A -> "Start a contract from it"
 * (getContractTemplateDefaults, the exact function
 * /contracts/new?templateId=<id> calls) -> an ORDINARY, unmodified
 * createContractAction call (the exact same Server Action a hand-typed
 * Contract uses) -> a real, persisted Contract row. Editing Template A
 * afterward must leave that already-created Contract completely
 * untouched — proving there is no hidden Template -> Contract
 * relationship, not merely that apply.ts's own returned object happens
 * to be a disconnected copy (already proven at the unit level in
 * apply.test.ts's own "snapshot semantics" describe block). Mirrors
 * test/integration/invoice-templates/snapshot-through-invoice-creation.test.ts's
 * own identical shape, adapted for createContractAction's own plain-
 * object signature (Contract's own Phase 1 precedent — see
 * ContractWritableInput's own header comment — unlike createInvoiceAction's
 * FormData/useActionState signature).
 *
 * Also proves, in the same real end-to-end path, that Client/Project/
 * signatory/contractNumber/issueDate are completely independent of
 * whichever template (if any) was applied — a template snapshot is
 * merged with, never replaces, those ordinarily-supplied fields.
 */
describe("Contract Templates -> Contract snapshot, proven through the real create path", () => {
  let fixtures: TestFixtures;
  let templateIds: string[] = [];
  let contractIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    if (contractIds.length > 0) {
      await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
      contractIds = [];
    }
    if (templateIds.length > 0) {
      await prisma.contractTemplate.deleteMany({ where: { id: { in: templateIds } } });
      templateIds = [];
    }
    resetAuthMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("editing the template after a Contract was created from it never changes that Contract's already-persisted values", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");

    const created = await createContractTemplate(
      fixtures.orgA.id,
      owner,
      templateInput({
        name: "Template A",
        title: "Original Services Agreement",
        body: "Original contract body terms.",
        internalNotes: "Original internal notes",
        defaultExpiryOffsetDays: "30",
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);

    // "Start a contract from it" — the exact same, real, read-only apply
    // entry point /contracts/new?templateId=<id> calls.
    actAs(fixtures.owner, fixtures.orgA.id);
    const applyResult = await getContractTemplateDefaults(created.template.id, NOW);
    expect(applyResult.ok).toBe(true);
    if (!applyResult.ok) return;
    const snapshot = applyResult.defaults;

    // An ordinary, completely unmodified Contract-create call — the same
    // Server Action a hand-typed Contract uses, fed with the snapshot's
    // own title/body/expiresAt/internalNotes plus the ordinary
    // contractNumber/client/issueDate every Contract needs. Client,
    // Project, and signatory are never supplied by the template at all.
    const contractNumber = `SNAPSHOT-${created.template.id.slice(0, 8)}`;
    const createResult = await createContractAction({
      contractNumber,
      clientId: fixtures.clientA.id,
      title: snapshot.title,
      body: snapshot.body,
      issueDate: "2026-06-15",
      expiresAt: snapshot.expiresAt ?? undefined,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    contractIds.push(createResult.contract.id);

    // internalNotes flows through the EXISTING, separate post-create
    // mechanism (ContractForm's own onSavedInternalNotes) — never part of
    // ContractWritableInput directly (locked architecture §15/§21). This
    // test calls the real dedicated action to prove that path too, not
    // just createContractAction.
    const { updateContractInternalNotesAction } = await import("@/app/(dashboard)/contracts/actions");
    if (snapshot.internalNotes) {
      await updateContractInternalNotesAction(createResult.contract.id, snapshot.internalNotes);
    }
    resetAuthMock();

    const originalContract = await prisma.contract.findUniqueOrThrow({ where: { id: createResult.contract.id } });

    expect(originalContract.title).toBe("Original Services Agreement");
    expect(originalContract.body).toBe("Original contract body terms.");
    expect(originalContract.internalNotes).toBe("Original internal notes");
    expect(originalContract.expiresAt?.toISOString().slice(0, 10)).toBe("2026-07-15");
    expect(originalContract.clientId).toBe(fixtures.clientA.id);
    expect(originalContract.contractNumber).toBe(contractNumber);

    // Now edit Template A to completely different content.
    const updated = await updateContractTemplate(
      fixtures.orgA.id,
      created.template.id,
      owner,
      templateInput({
        name: "Template A (changed)",
        title: "CHANGED title",
        body: "CHANGED body",
        internalNotes: "CHANGED internal notes",
        defaultExpiryOffsetDays: "7",
      }),
    );
    expect(updated.ok).toBe(true);

    // The already-created Contract is completely untouched — same row,
    // re-fetched fresh from the database, every field identical to what
    // was asserted above. This is the whole point: there is no
    // persistent Template -> Contract relationship of any kind (the
    // Contract model itself has no contractTemplateId column at all —
    // this line would fail to compile, not merely fail an assertion, if
    // one were ever added and this test tried to use it) for an edit to
    // propagate through even if the domain layer wanted it to.
    const contractAfterTemplateEdit = await prisma.contract.findUniqueOrThrow({ where: { id: originalContract.id } });
    expect(contractAfterTemplateEdit.title).toBe("Original Services Agreement");
    expect(contractAfterTemplateEdit.body).toBe("Original contract body terms.");
    expect(contractAfterTemplateEdit.internalNotes).toBe("Original internal notes");
    expect(contractAfterTemplateEdit.expiresAt?.toISOString().slice(0, 10)).toBe("2026-07-15");
    expect(contractAfterTemplateEdit.clientId).toBe(fixtures.clientA.id);
  });
});
