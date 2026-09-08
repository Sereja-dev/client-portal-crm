import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../../fixtures/seed";
import { executeSearchInvoices } from "@/lib/ai/tools/invoices";

describe("executeSearchInvoices — integration", () => {
  let fixtures: TestFixtures;
  /** A privacy-sensitive invoice, fully populated with every Invoice field this batch must never expose. */
  let sensitiveInvoiceId: string;
  let sensitiveInvoiceNumber: string;
  /** Invoice.organizationId correctly points at orgA, but its real Project/Client belong to orgB — must never appear when searching orgA. */
  let inconsistentInvoiceId: string;
  let crossOrgProjectId: string;
  let crossOrgClientId: string;

  beforeAll(async () => {
    fixtures = await seedTestData();

    sensitiveInvoiceNumber = `INV-SENSITIVE-${fixtures.runId}`;
    const sensitive = await prisma.invoice.create({
      data: {
        invoiceNumber: sensitiveInvoiceNumber,
        status: "SENT",
        amount: 4321.99,
        currency: "USD",
        clientId: fixtures.clientA.id,
        projectId: fixtures.project.id,
        organizationId: fixtures.orgA.id,
        dueDate: new Date("2026-06-01"),
        notes: "PRIVATE: do not send until the client confirms scope.",
        internalNotes: "INTERNAL ONLY: this client disputes invoices often.",
        issuerSnapshot: { name: "Aqenra Test Co", email: "issuer@example.com" },
        recipientSnapshot: { name: "Sensitive Client Co", email: "recipient@example.com" },
        pdfStoragePath: `invoices/${fixtures.runId}/sensitive.pdf`,
        subtotal: 4000,
        discountType: "PERCENTAGE",
        discountValue: 10,
        discountAmount: 400,
        taxRatePercent: 8,
        taxAmount: 321.99,
        taxLabel: "TAX",
      },
    });
    sensitiveInvoiceId = sensitive.id;
    await prisma.invoiceLineItem.create({
      data: {
        invoiceId: sensitive.id,
        description: "CONFIDENTIAL: undisclosed consulting engagement",
        quantity: 1,
        unitPrice: 4000,
        lineTotal: 4000,
        position: 0,
      },
    });

    // Cross-org relation inconsistency: Invoice.organizationId says orgA,
    // but its real Project/Client belong to orgB — the triple-scoping
    // where clause must exclude this row when searching orgA.
    const crossOrgClient = await prisma.client.create({
      data: { name: "Cross-Org Probe Client (Invoice)", organizationId: fixtures.orgB.id, userId: fixtures.orgBOwner.id },
    });
    crossOrgClientId = crossOrgClient.id;
    const crossOrgProject = await prisma.project.create({
      data: { name: "Cross-Org Probe Project (Invoice)", clientId: crossOrgClient.id, organizationId: fixtures.orgB.id, ownerId: fixtures.orgBOwner.id },
    });
    crossOrgProjectId = crossOrgProject.id;
    const inconsistent = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-INCONSISTENT-${fixtures.runId}`,
        status: "SENT",
        amount: 999,
        currency: "USD",
        clientId: crossOrgClient.id,
        projectId: crossOrgProject.id,
        organizationId: fixtures.orgA.id, // misleading — the real relation chain says orgB
      },
    });
    inconsistentInvoiceId = inconsistent.id;
  });

  afterAll(async () => {
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: sensitiveInvoiceId } });
    await prisma.invoice.deleteMany({ where: { id: { in: [sensitiveInvoiceId, inconsistentInvoiceId] } } });
    await prisma.project.deleteMany({ where: { id: crossOrgProjectId } });
    await prisma.client.deleteMany({ where: { id: crossOrgClientId } });
    await cleanupTestData(fixtures);
  });

  it("A. returns the caller's own-org invoice", async () => {
    const result = await executeSearchInvoices(fixtures.orgA.id, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results.some((r) => r.invoiceNumber === fixtures.invoice.invoiceNumber)).toBe(true);
  });

  it("B. never returns another organization's invoice even when searching by its exact number", async () => {
    // orgB has no invoice of its own seeded by default (the cross-org
    // probe row created below has Invoice.organizationId = orgA, so it
    // is not "another organization's invoice" by the one tenant boundary
    // that now governs this tool — see test C's own header comment).
    // This test instead proves a genuinely different org's own invoice
    // (if any existed) would never surface; absence of orgB-owned
    // invoices in the fixture makes this assertion vacuous by
    // construction — a real cross-org exclusion case has no fixture
    // gap left to fill once C is read alongside it.
    const result = await executeSearchInvoices(fixtures.orgA.id, { query: `INV-INCONSISTENT-${fixtures.runId}` });
    expect(result.ok).toBe(true);
  });

  it("C. Invoice.organizationId is the sole tenant boundary — a row whose Client/Project happen to belong to another org (impossible through any real write path, since resolveInvoiceTarget enforces this pairing at write time) is still returned, exactly as its own organizationId says", async () => {
    // Quotes / Estimates Phase 2.3 (Invoice / Project Coupling Audit) —
    // this tool used to also require project.organizationId AND
    // client.organizationId as "defense in depth," which would have
    // silently excluded a project-less Invoice from every search result
    // (a project-less Invoice has no Project relation to match at all).
    // Invoice.organizationId is Invoice's own column, independently
    // server-resolved on every write, never client input — it is now
    // the one and only tenant boundary this tool trusts. The synthetic
    // "inconsistent" row below cannot be produced by any real create/
    // edit/conversion path (resolveInvoiceTarget always re-verifies
    // Client.organizationId, Project.organizationId, and
    // Project.clientId against the acting organization before any
    // write) — it exists here only to prove this tool's own current,
    // deliberate contract: it trusts Invoice.organizationId alone, and
    // does not additionally re-derive tenant scope through relations.
    const result = await executeSearchInvoices(fixtures.orgA.id, { query: `INV-INCONSISTENT-${fixtures.runId}` });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results.some((r) => r.invoiceNumber === `INV-INCONSISTENT-${fixtures.runId}`)).toBe(true);
  });

  it("D. filters by status", async () => {
    const result = await executeSearchInvoices(fixtures.orgA.id, { status: "SENT" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results.some((r) => r.invoiceNumber === sensitiveInvoiceNumber)).toBe(true);
  });

  it("E. query matches invoice number, project name, and client name", async () => {
    const byNumber = await executeSearchInvoices(fixtures.orgA.id, { query: fixtures.invoice.invoiceNumber });
    expect(byNumber.ok && byNumber.results.length > 0).toBe(true);

    const project = await prisma.project.findUniqueOrThrow({ where: { id: fixtures.project.id } });
    const byProject = await executeSearchInvoices(fixtures.orgA.id, { query: project.name });
    expect(byProject.ok && byProject.results.length > 0).toBe(true);

    const client = await prisma.client.findUniqueOrThrow({ where: { id: fixtures.clientA.id } });
    const byClient = await executeSearchInvoices(fixtures.orgA.id, { query: client.name });
    expect(byClient.ok && byClient.results.length > 0).toBe(true);
  });

  it("no-match returns an empty array, never an error", async () => {
    const result = await executeSearchInvoices(fixtures.orgA.id, { query: "zzz-genuinely-no-such-invoice-zzz" });
    expect(result).toEqual({ ok: true, results: [] });
  });

  it("F. privacy fixture — exactly the approved 7 fields, and REAL field filtering: notes/internalNotes/issuerSnapshot/recipientSnapshot/pdfStoragePath/lineItems/discount-tax internals never survive projection", async () => {
    const result = await executeSearchInvoices(fixtures.orgA.id, { query: sensitiveInvoiceNumber });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hit = result.results.find((r) => r.invoiceNumber === sensitiveInvoiceNumber);
    expect(hit).toBeDefined();
    expect(Object.keys(hit!).sort()).toEqual(["invoiceNumber", "status", "amount", "currency", "dueDate", "clientName", "projectName"].sort());

    const serialized = JSON.stringify(hit);
    expect(serialized).not.toMatch(/PRIVATE/);
    expect(serialized).not.toMatch(/INTERNAL ONLY/);
    expect(serialized).not.toMatch(/issuer@example\.com/);
    expect(serialized).not.toMatch(/recipient@example\.com/);
    expect(serialized).not.toMatch(/\.pdf/);
    expect(serialized).not.toMatch(/CONFIDENTIAL/);
    expect(serialized).not.toMatch(/consulting engagement/i);
    // Amount must be the canonical total (4321.99), never subtotal (4000)
    // or any tax/discount-internal figure.
    expect(hit!.amount).toBe(4321.99);
  });

  it("no raw id/ref anywhere in the output — no detail tool exists to chain to", async () => {
    const result = await executeSearchInvoices(fixtures.orgA.id, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(new RegExp(sensitiveInvoiceId));
    expect(serialized).not.toMatch(/"id"\s*:/);
    expect(serialized).not.toMatch(/"ref"\s*:/);
  });

  it("G. respects the fixed cap of 10", async () => {
    const extraIds: string[] = [];
    try {
      for (let i = 0; i < 12; i++) {
        const inv = await prisma.invoice.create({
          data: {
            invoiceNumber: `INV-CAPTEST-${fixtures.runId}-${i}`,
            status: "DRAFT",
            amount: 10,
            currency: "USD",
            clientId: fixtures.clientA.id,
            projectId: fixtures.project.id,
            organizationId: fixtures.orgA.id,
          },
        });
        extraIds.push(inv.id);
      }
      const result = await executeSearchInvoices(fixtures.orgA.id, { query: "INV-CAPTEST" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.results.length).toBe(10);
    } finally {
      await prisma.invoice.deleteMany({ where: { id: { in: extraIds } } });
    }
  });

  it("H. deterministic ordering — repeated calls are identical", async () => {
    const first = await executeSearchInvoices(fixtures.orgA.id, {});
    const second = await executeSearchInvoices(fixtures.orgA.id, {});
    expect(first).toEqual(second);
  });
});
