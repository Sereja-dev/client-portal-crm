import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createInvoiceAction } from "@/app/(dashboard)/invoices/new/actions";
import { updateInvoiceAction } from "@/app/(dashboard)/invoices/[id]/edit/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * Quotes / Estimates Phase 2.3 — the durable Invoice invariant
 * (clientId REQUIRED, projectId OPTIONAL) exercised through the real
 * createInvoiceAction/updateInvoiceAction Server Actions. Covers §AB
 * MANUAL CREATE (items 1-8) and UPDATE (items 9-14).
 */

const INVOICE_NUMBER_PREFIX = "INV-P23";

function uniqueInvoiceNumber(runId: string): string {
  return `${INVOICE_NUMBER_PREFIX}-${runId}-${randomUUID().slice(0, 8)}`;
}

function baseFields(overrides: Record<string, string> = {}) {
  return {
    mode: "flat",
    amount: "100.00",
    lineItems: "",
    currency: "USD",
    issueDate: "2026-08-16",
    dueDate: "",
    notes: "",
    internalNotes: "",
    discountType: "NONE",
    discountValue: "",
    taxRatePercent: "",
    taxLabel: "TAX",
    ...overrides,
  };
}

function buildFormData(invoiceNumber: string, clientId: string, projectId: string | null, overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("invoiceNumber", invoiceNumber);
  fd.set("clientId", clientId);
  fd.set("projectId", projectId ?? "");
  for (const [key, value] of Object.entries(baseFields(overrides))) fd.set(key, value);
  return fd;
}

async function expectRedirect(promise: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
}

describe("createInvoiceAction / updateInvoiceAction — Client required, Project optional (Quotes / Estimates Phase 2.3)", () => {
  let fixtures: TestFixtures;
  let clientA2: { id: string };
  let projectA2: { id: string };

  beforeAll(async () => {
    fixtures = await seedTestData();
    clientA2 = await prisma.client.create({
      data: { name: `P23 Second Client ${fixtures.runId}`, userId: fixtures.owner.id, organizationId: fixtures.orgA.id },
    });
    projectA2 = await prisma.project.create({
      data: {
        name: `P23 Second Project ${fixtures.runId}`,
        clientId: clientA2.id,
        organizationId: fixtures.orgA.id,
        ownerId: fixtures.owner.id,
        status: "IN_PROGRESS",
      },
    });
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: `${INVOICE_NUMBER_PREFIX}-${fixtures.runId}` } } });
    await prisma.project.deleteMany({ where: { id: projectA2.id } });
    await prisma.client.deleteMany({ where: { id: clientA2.id } });
    await cleanupTestData(fixtures);
  });

  describe("MANUAL CREATE", () => {
    it("1. Client-only Invoice succeeds (projectId null)", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const invoiceNumber = uniqueInvoiceNumber(fixtures.runId);
      await expectRedirect(createInvoiceAction({ error: null }, buildFormData(invoiceNumber, fixtures.clientA.id, null)));

      const created = await prisma.invoice.findUniqueOrThrow({
        where: { organizationId_invoiceNumber: { organizationId: fixtures.orgA.id, invoiceNumber } },
      });
      expect(created.clientId).toBe(fixtures.clientA.id);
      expect(created.projectId).toBeNull();
      expect(created.status).toBe("DRAFT");
    });

    it("2. Client+Project Invoice succeeds", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const invoiceNumber = uniqueInvoiceNumber(fixtures.runId);
      await expectRedirect(
        createInvoiceAction({ error: null }, buildFormData(invoiceNumber, fixtures.clientA.id, fixtures.project.id)),
      );

      const created = await prisma.invoice.findUniqueOrThrow({
        where: { organizationId_invoiceNumber: { organizationId: fixtures.orgA.id, invoiceNumber } },
      });
      expect(created.clientId).toBe(fixtures.clientA.id);
      expect(created.projectId).toBe(fixtures.project.id);
    });

    it("3. Client is required — an empty clientId is rejected before any DB write", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const invoiceNumber = uniqueInvoiceNumber(fixtures.runId);
      const result = await createInvoiceAction({ error: null }, buildFormData(invoiceNumber, "", null));
      expect(result.fieldErrors?.clientId).toBeTruthy();
      expect(await prisma.invoice.findFirst({ where: { invoiceNumber } })).toBeNull();
    });

    it("4. a foreign-org Client is rejected", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const invoiceNumber = uniqueInvoiceNumber(fixtures.runId);
      const result = await createInvoiceAction({ error: null }, buildFormData(invoiceNumber, fixtures.clientB.id, null));
      expect(result).toEqual({ error: null, fieldErrors: { clientId: "Select a valid client." } });
      expect(await prisma.invoice.findFirst({ where: { invoiceNumber } })).toBeNull();
    });

    it("5. a foreign-org Project is rejected", async () => {
      const foreignProject = await prisma.project.create({
        data: { name: "Foreign org project", clientId: fixtures.clientB.id, organizationId: fixtures.orgB.id, ownerId: fixtures.orgBOwner.id, status: "IN_PROGRESS" },
      });
      try {
        actAs(fixtures.owner, fixtures.orgA.id);
        const invoiceNumber = uniqueInvoiceNumber(fixtures.runId);
        const result = await createInvoiceAction(
          { error: null },
          buildFormData(invoiceNumber, fixtures.clientA.id, foreignProject.id),
        );
        expect(result).toEqual({ error: null, fieldErrors: { clientId: "Select a valid client." } });
        expect(await prisma.invoice.findFirst({ where: { invoiceNumber } })).toBeNull();
      } finally {
        await prisma.project.deleteMany({ where: { id: foreignProject.id } });
      }
    });

    it("6. a Project belonging to a DIFFERENT Client (same org) is rejected", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const invoiceNumber = uniqueInvoiceNumber(fixtures.runId);
      const result = await createInvoiceAction(
        { error: null },
        buildFormData(invoiceNumber, fixtures.clientA.id, projectA2.id),
      );
      expect(result).toEqual({ error: null, fieldErrors: { clientId: "Select a valid client." } });
      expect(await prisma.invoice.findFirst({ where: { invoiceNumber } })).toBeNull();
    });

    it("7. a caller-supplied organizationId in the FormData is silently ignored — never accepted", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const invoiceNumber = uniqueInvoiceNumber(fixtures.runId);
      const fd = buildFormData(invoiceNumber, fixtures.clientA.id, null);
      fd.set("organizationId", fixtures.orgB.id);
      await expectRedirect(createInvoiceAction({ error: null }, fd));

      const created = await prisma.invoice.findUniqueOrThrow({
        where: { organizationId_invoiceNumber: { organizationId: fixtures.orgA.id, invoiceNumber } },
      });
      expect(created.organizationId).toBe(fixtures.orgA.id);
    });

    it("8. a zero-Project organization can still create a Client-only Invoice", async () => {
      const soloOrg = await prisma.organization.create({ data: { name: "Zero Project Org", slug: `zero-project-${fixtures.runId}` } });
      const soloUser = await prisma.user.create({ data: { email: `zero-project-${fixtures.runId}@example.com`, name: "Solo Owner" } });
      await prisma.membership.create({ data: { userId: soloUser.id, organizationId: soloOrg.id, role: "OWNER" } });
      const soloClient = await prisma.client.create({ data: { name: "Solo Client", userId: soloUser.id, organizationId: soloOrg.id } });
      try {
        actAs(soloUser, soloOrg.id);
        const invoiceNumber = uniqueInvoiceNumber(fixtures.runId);
        await expectRedirect(createInvoiceAction({ error: null }, buildFormData(invoiceNumber, soloClient.id, null)));

        const created = await prisma.invoice.findUniqueOrThrow({
          where: { organizationId_invoiceNumber: { organizationId: soloOrg.id, invoiceNumber } },
        });
        expect(created.clientId).toBe(soloClient.id);
        expect(created.projectId).toBeNull();

        const projectCount = await prisma.project.count({ where: { organizationId: soloOrg.id } });
        expect(projectCount).toBe(0);
      } finally {
        resetAuthMock();
        await prisma.invoice.deleteMany({ where: { organizationId: soloOrg.id } });
        await prisma.client.deleteMany({ where: { id: soloClient.id } });
        await prisma.membership.deleteMany({ where: { organizationId: soloOrg.id } });
        await prisma.user.deleteMany({ where: { id: soloUser.id } });
        await prisma.organization.deleteMany({ where: { id: soloOrg.id } });
      }
    });
  });

  describe("UPDATE", () => {
    async function createDraft(clientId: string, projectId: string | null) {
      actAs(fixtures.owner, fixtures.orgA.id);
      const invoiceNumber = uniqueInvoiceNumber(fixtures.runId);
      await expectRedirect(createInvoiceAction({ error: null }, buildFormData(invoiceNumber, clientId, projectId)));
      resetAuthMock();
      actAs(fixtures.owner, fixtures.orgA.id);
      const created = await prisma.invoice.findUniqueOrThrow({
        where: { organizationId_invoiceNumber: { organizationId: fixtures.orgA.id, invoiceNumber } },
      });
      resetAuthMock();
      return created;
    }

    it("9. adds a Project to a project-less DRAFT", async () => {
      const draft = await createDraft(fixtures.clientA.id, null);
      actAs(fixtures.owner, fixtures.orgA.id);
      await expectRedirect(
        updateInvoiceAction(
          draft.id,
          draft.updatedAt.toISOString(),
          { error: null },
          buildFormData(draft.invoiceNumber, fixtures.clientA.id, fixtures.project.id),
        ),
      );
      const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } });
      expect(updated.projectId).toBe(fixtures.project.id);
    });

    it("10. removes the Project from a DRAFT that has one", async () => {
      const draft = await createDraft(fixtures.clientA.id, fixtures.project.id);
      actAs(fixtures.owner, fixtures.orgA.id);
      await expectRedirect(
        updateInvoiceAction(
          draft.id,
          draft.updatedAt.toISOString(),
          { error: null },
          buildFormData(draft.invoiceNumber, fixtures.clientA.id, null),
        ),
      );
      const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } });
      expect(updated.projectId).toBeNull();
      expect(updated.clientId).toBe(fixtures.clientA.id);
    });

    it("11. switches the Project within the same Client", async () => {
      const secondProject = await prisma.project.create({
        data: { name: "Second project, same client", clientId: fixtures.clientA.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "IN_PROGRESS" },
      });
      let draftId: string | undefined;
      try {
        const draft = await createDraft(fixtures.clientA.id, fixtures.project.id);
        draftId = draft.id;
        actAs(fixtures.owner, fixtures.orgA.id);
        await expectRedirect(
          updateInvoiceAction(
            draft.id,
            draft.updatedAt.toISOString(),
            { error: null },
            buildFormData(draft.invoiceNumber, fixtures.clientA.id, secondProject.id),
          ),
        );
        const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } });
        expect(updated.projectId).toBe(secondProject.id);
        expect(updated.clientId).toBe(fixtures.clientA.id);
      } finally {
        // Must be gone BEFORE deleting secondProject — Invoice.projectId
        // is Restrict. This file's own afterAll would otherwise also
        // sweep it (invoiceNumber prefix match), but that runs too late
        // for this test's own project cleanup.
        if (draftId) await prisma.invoice.deleteMany({ where: { id: draftId } });
        await prisma.project.deleteMany({ where: { id: secondProject.id } });
      }
    });

    it("12. changes Client together with a compatible Project", async () => {
      const draft = await createDraft(fixtures.clientA.id, fixtures.project.id);
      actAs(fixtures.owner, fixtures.orgA.id);
      await expectRedirect(
        updateInvoiceAction(
          draft.id,
          draft.updatedAt.toISOString(),
          { error: null },
          buildFormData(draft.invoiceNumber, clientA2.id, projectA2.id),
        ),
      );
      const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } });
      expect(updated.clientId).toBe(clientA2.id);
      expect(updated.projectId).toBe(projectA2.id);
    });

    it("13. an incompatible Client/Project pairing is rejected — the invoice is left unchanged", async () => {
      const draft = await createDraft(fixtures.clientA.id, fixtures.project.id);
      actAs(fixtures.owner, fixtures.orgA.id);
      const result = await updateInvoiceAction(
        draft.id,
        draft.updatedAt.toISOString(),
        { error: null },
        // clientA2 selected, but projectA2 belongs to clientA2 while
        // fixtures.project belongs to fixtures.clientA — pairing clientA2
        // with fixtures.project (the WRONG project for that client) must
        // be rejected.
        buildFormData(draft.invoiceNumber, clientA2.id, fixtures.project.id),
      );
      expect(result).toEqual({ error: null, fieldErrors: { clientId: "Select a valid client." } });

      const unchanged = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } });
      expect(unchanged.clientId).toBe(fixtures.clientA.id);
      expect(unchanged.projectId).toBe(fixtures.project.id);
    });

    it("14. editing an already project-less DRAFT (no project change) works normally", async () => {
      const draft = await createDraft(fixtures.clientA.id, null);
      actAs(fixtures.owner, fixtures.orgA.id);
      await expectRedirect(
        updateInvoiceAction(
          draft.id,
          draft.updatedAt.toISOString(),
          { error: null },
          buildFormData(draft.invoiceNumber, fixtures.clientA.id, null, { amount: "999.00" }),
        ),
      );
      const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } });
      expect(updated.amount.toFixed(2)).toBe("999.00");
      expect(updated.projectId).toBeNull();
    });
  });
});
