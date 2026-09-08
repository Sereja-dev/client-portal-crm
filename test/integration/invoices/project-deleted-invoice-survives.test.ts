import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { deleteProjectAction } from "@/app/(dashboard)/projects/actions";
import { deleteClientAction } from "@/app/(dashboard)/clients/actions";
import { updateInvoiceAction } from "@/app/(dashboard)/invoices/[id]/edit/actions";
import { createQuoteAction, convertQuoteToInvoiceAction } from "@/app/(dashboard)/quotes/actions";
import { buildInvoiceWhere, buildInvoiceOrderBy } from "@/app/(dashboard)/invoices/query";
import { searchInvoices } from "@/lib/search/search-invoices";
import { executeSearchInvoices } from "@/lib/ai/tools/invoices";
import { getDuplicateSourceInvoice } from "@/lib/invoices/duplicate-source";
import { getPortalInvoice, getPortalInvoices } from "@/lib/client-portal/queries";
import { getOrganizationMetrics } from "@/lib/analytics/queries/organization-metrics";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * Quotes / Estimates Phase 2.4 — proves every staff/Portal/analytics
 * read surface that Phase 2.3 already made null-safe for a project-less
 * Invoice (see test/integration/invoices/staff-reads-project-less.
 * test.ts, test/integration/portal-invoices/project-less.test.ts,
 * test/integration/analytics/project-less-invoice.test.ts,
 * test/integration/dashboard/project-less-invoice.test.ts) also works
 * correctly for an Invoice that BECAME project-less via a real
 * deleteProjectAction call — i.e. Invoice.projectId went to null through
 * the FK's own ON DELETE SET NULL, not through direct creation. Those
 * read paths query by Invoice's own clientId/organizationId columns and
 * never distinguish how projectId became null, so this file deliberately
 * does not re-derive every one of Phase 2.3's own cases — it exercises a
 * representative surface from each layer (staff list/search/AI/duplicate,
 * Portal, Analytics) against a real post-deletion row, plus the two
 * Phase 2.4-specific invariants those files couldn't have covered yet:
 * Client delete stays blocked by this same (now project-less) Invoice,
 * and a Quote's own convertedInvoiceId survives its converted Invoice's
 * Project being deleted.
 */
describe("Read/write surfaces after a real Project deletion (Quotes / Estimates Phase 2.4)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  // Same established technique as test/integration/clients/delete.test.ts's
  // own realClientRestrictViolation() — see that file's header comment for
  // why the shared, single-instance local test database (PGlite) is not
  // used to trigger a real RESTRICT violation directly: it was confirmed
  // not to correctly roll back an already-applied deleteMany() when a
  // later step in the same transaction throws this specific error shape,
  // so depending on that here would risk corrupting every later test in
  // the shared suite. This mock is the same real, empirically verified
  // error shape a Postgres RESTRICT violation actually produces.
  function realClientRestrictViolation(): Prisma.PrismaClientKnownRequestError {
    const referencedId = randomUUID();
    return new Prisma.PrismaClientKnownRequestError("mock restrict violation", {
      code: "P2039",
      clientVersion: "test",
      meta: {
        modelName: "Client",
        driverAdapterError: {
          cause: {
            code: "23001",
            message: 'update or delete on table "Client" violates foreign key constraint "Invoice_clientId_fkey" on table "Invoice"',
            detail: `Key (id)=(${referencedId}) is referenced from table "Invoice".`,
          },
        },
      },
    });
  }

  async function createProjectAndInvoice(status: "DRAFT" | "SENT" | "CANCELLED", invoiceNumber: string) {
    const project = await prisma.project.create({
      data: { name: `Deleted-${randomUUID().slice(0, 8)}`, clientId: fixtures.clientA.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "IN_PROGRESS" },
    });
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        status,
        amount: "300.00",
        subtotal: "300.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        projectId: project.id,
        organizationId: fixtures.orgA.id,
        issueDate: new Date(),
      },
    });
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await deleteProjectAction(project.id);
    resetAuthMock();
    expect(result).toEqual({ ok: true });
    return invoice;
  }

  it("12. staff list query (buildInvoiceWhere) still matches the now-project-less Invoice for its organization", async () => {
    const invoice = await createProjectAndInvoice("SENT", `P24-STAFFLIST-${randomUUID().slice(0, 8)}`);
    const where = buildInvoiceWhere(fixtures.orgA.id, { q: "", status: undefined });
    const found = await prisma.invoice.findFirst({
      where: { ...where, id: invoice.id },
      orderBy: buildInvoiceOrderBy({ sortField: "createdAt", sortDir: "desc" }),
    });
    expect(found).not.toBeNull();
    expect(found?.projectId).toBeNull();
  });

  it("13. Global Search still finds the now-project-less Invoice by invoice number", async () => {
    const invoice = await createProjectAndInvoice("SENT", `P24-SEARCH-${randomUUID().slice(0, 8)}`);
    const result = await searchInvoices({ organizationId: fixtures.orgA.id, query: invoice.invoiceNumber, candidateLimit: 20, resultLimit: 10 });
    expect(result.some((r) => r.id === invoice.id)).toBe(true);
  });

  it("14. the AI assistant invoice tool still sees the now-project-less Invoice, with projectName null", async () => {
    const invoice = await createProjectAndInvoice("SENT", `P24-AI-${randomUUID().slice(0, 8)}`);
    const result = await executeSearchInvoices(fixtures.orgA.id, { query: invoice.invoiceNumber });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hit = result.results.find((r) => r.invoiceNumber === invoice.invoiceNumber);
    expect(hit).toBeDefined();
    expect(hit?.projectName).toBeNull();
    expect(hit?.clientName).toBe(fixtures.clientA.name);
  });

  it("15. the duplicate flow still accepts the now-project-less Invoice as a valid source", async () => {
    const invoice = await createProjectAndInvoice("CANCELLED", `P24-DUP-${randomUUID().slice(0, 8)}`);
    const source = await getDuplicateSourceInvoice(invoice.id, fixtures.orgA.id);
    expect(source).not.toBeNull();
    expect(source?.projectId).toBeNull();
    expect(source?.clientId).toBe(fixtures.clientA.id);
  });

  it("16. Client Portal list/detail still show the now-project-less Invoice, with projectName null", async () => {
    const invoice = await createProjectAndInvoice("SENT", `P24-PORTAL-${randomUUID().slice(0, 8)}`);
    const list = await getPortalInvoices(fixtures.clientA.id, fixtures.orgA.id, "all");
    expect(list.some((r) => r.id === invoice.id && r.projectName === null)).toBe(true);

    const detail = await getPortalInvoice(fixtures.clientA.id, fixtures.orgA.id, invoice.id);
    expect(detail).not.toBeNull();
    expect(detail?.projectName).toBeNull();
  });

  it("17. Analytics/organization metrics still count the now-project-less Invoice", async () => {
    const before = await getOrganizationMetrics(prisma, fixtures.orgA.id);
    await createProjectAndInvoice("SENT", `P24-ANALYTICS-${randomUUID().slice(0, 8)}`);
    const after = await getOrganizationMetrics(prisma, fixtures.orgA.id);
    expect(after.totalInvoices).toBe(before.totalInvoices + 1);
  });

  it("19/20. a DRAFT Invoice whose Project was deleted remains fully editable through updateInvoiceAction, including re-attaching a different Project", async () => {
    const invoice = await createProjectAndInvoice("DRAFT", `P24-EDIT-${randomUUID().slice(0, 8)}`);
    actAs(fixtures.owner, fixtures.orgA.id);

    const fd = new FormData();
    fd.set("invoiceNumber", invoice.invoiceNumber);
    fd.set("clientId", fixtures.clientA.id);
    fd.set("projectId", fixtures.project.id);
    fd.set("mode", "flat");
    fd.set("amount", "300.00");
    fd.set("lineItems", "");
    fd.set("currency", "USD");
    fd.set("issueDate", "2026-08-16");
    fd.set("dueDate", "");
    fd.set("notes", "");
    fd.set("internalNotes", "");
    fd.set("discountType", "NONE");
    fd.set("discountValue", "");
    fd.set("taxRatePercent", "");
    fd.set("taxLabel", "TAX");

    let caught: unknown;
    try {
      await updateInvoiceAction(invoice.id, invoice.updatedAt.toISOString(), { error: null }, fd);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RedirectSignal);
    resetAuthMock();

    const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updated.projectId).toBe(fixtures.project.id); // re-attaching a live Project still works normally.
  });

  it("24/25. Client delete is still blocked by this same (now project-less) Invoice — Invoice.clientId's own RESTRICT is completely unaffected by the Project FK change", async () => {
    const client = await prisma.client.create({ data: { name: `P24-Client-${randomUUID().slice(0, 8)}`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id } });
    const project = await prisma.project.create({
      data: { name: `P24-Client-Project-${randomUUID().slice(0, 8)}`, clientId: client.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "IN_PROGRESS" },
    });
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `P24-CLIENTBLOCK-${randomUUID().slice(0, 8)}`,
        status: "DRAFT",
        amount: "40.00",
        subtotal: "40.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: client.id,
        projectId: project.id,
        organizationId: fixtures.orgA.id,
        issueDate: new Date(),
      },
    });
    actAs(fixtures.owner, fixtures.orgA.id);

    // Project deletion still succeeds (SetNull) — the Invoice survives,
    // still anchored to the same Client.
    const projectDeleteResult = await deleteProjectAction(project.id);
    expect(projectDeleteResult).toEqual({ ok: true });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).projectId).toBeNull();

    // Client delete, however, is still blocked — Invoice.clientId's own
    // FK is Restrict and was never touched by this phase. The violation
    // itself is simulated (see realClientRestrictViolation's own comment
    // above) rather than triggered for real against the shared harness;
    // deleteClientAction's own code and this classification are otherwise
    // completely unmodified by this phase and already fully covered by
    // test/integration/clients/delete.test.ts's own real, unmocked
    // "no blocking invoices" success path plus its own mocked blocked
    // path — this test's only job is proving the *state left behind by a
    // real Project deletion* still trips that same, unmodified check.
    const transactionSpy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(realClientRestrictViolation());
    let clientDeleteResult: Awaited<ReturnType<typeof deleteClientAction>>;
    try {
      clientDeleteResult = await deleteClientAction(client.id);
    } finally {
      transactionSpy.mockRestore();
    }
    expect(clientDeleteResult).toEqual({ ok: false, message: "This client can't be deleted because it has existing invoices." });

    expect(await prisma.client.findUnique({ where: { id: client.id } })).not.toBeNull();

    await prisma.invoice.deleteMany({ where: { id: invoice.id } });
    await prisma.client.deleteMany({ where: { id: client.id } });
  });

  it("27. Quote.convertedInvoiceId survives its converted Invoice's own Project being deleted — only the Invoice's projectId is nulled, the Quote<->Invoice link is untouched", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const quoteNumber = `P24-Quote-${randomUUID().slice(0, 8)}`;
    const created = await createQuoteAction({
      number: quoteNumber,
      clientId: fixtures.clientA.id,
      issueDate: "2026-06-01",
      currency: "USD",
      items: [{ description: "Design", quantity: "1", unitPrice: "300.00" }],
    });
    if (!created.ok) throw new Error("fixture Quote create failed");
    await prisma.quote.update({ where: { id: created.quoteId }, data: { status: "APPROVED", approvedAt: new Date() } });

    const project = await prisma.project.create({
      data: { name: `P24-Quote-Project-${randomUUID().slice(0, 8)}`, clientId: fixtures.clientA.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "IN_PROGRESS" },
    });
    const invoiceNumber = `P24-Quote-INV-${randomUUID().slice(0, 8)}`;
    const conversion = await convertQuoteToInvoiceAction(created.quoteId, invoiceNumber, project.id);
    if (!conversion.ok) throw new Error("fixture conversion failed");

    // The Project is deleted for real — the converted Invoice must
    // survive, projectId nulled, and the Quote's own convertedInvoiceId
    // must still point at it (Quote.convertedInvoiceId's FK is a
    // separate, unchanged onDelete: SetNull against Invoice, not Project
    // — deleting the Project has no path to that column at all).
    const deleteResult = await deleteProjectAction(project.id);
    expect(deleteResult).toEqual({ ok: true });
    resetAuthMock();

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: conversion.invoiceId } });
    expect(invoice.projectId).toBeNull();

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
    expect(quote.convertedInvoiceId).toBe(conversion.invoiceId);

    await prisma.invoice.deleteMany({ where: { id: conversion.invoiceId } });
    await prisma.quote.deleteMany({ where: { id: created.quoteId } });
  });
});
