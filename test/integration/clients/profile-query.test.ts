import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  fetchClientHealth,
  fetchClientProjects,
  fetchClientTasks,
  fetchClientInvoices,
  fetchClientQuotes,
  fetchClientContracts,
  CLIENT_TAB_ROW_BOUND,
} from "@/app/(dashboard)/clients/[id]/profile-query";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Client Profile Hub V1 — the bounded, tenant-scoped query layer behind
 * the Hub's Overview health strip and each relationship tab. Mirrors
 * pipeline-query.test.ts's own established convention exactly: tests the
 * query functions directly, never the page.tsx Server Component itself
 * (this repo's own consistent precedent — no existing test renders a
 * page.tsx directly either).
 */

const PREFIX = "ClientHub-Query";

function uniqueName(): string {
  return `${PREFIX}-${randomUUID().slice(0, 8)}`;
}

describe("Client Profile Hub — health signals", () => {
  let fixtures: TestFixtures;
  const actor = { id: "", name: "Test Owner", role: "OWNER" as const };

  beforeAll(async () => {
    fixtures = await seedTestData();
    actor.id = fixtures.owner.id;
  });

  afterAll(async () => {
    // Invoice.clientId is onDelete: Restrict — must be cleared before the
    // Client rows themselves can be deleted (same order delete.test.ts's
    // own afterAll already establishes).
    await prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: PREFIX } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await cleanupTestData(fixtures);
  });

  async function createClient(organizationId: string) {
    return prisma.client.create({ data: { name: uniqueName(), organizationId, userId: fixtures.owner.id } });
  }

  it("unpaid invoices: counts only DRAFT/SENT/OVERDUE, never PAID/CANCELLED, scoped to this client only", async () => {
    const client = await createClient(fixtures.orgA.id);
    const otherClient = await createClient(fixtures.orgA.id);

    await prisma.invoice.createMany({
      data: [
        { invoiceNumber: `${PREFIX}-1`, organizationId: fixtures.orgA.id, clientId: client.id, status: "DRAFT", amount: "10.00" },
        { invoiceNumber: `${PREFIX}-2`, organizationId: fixtures.orgA.id, clientId: client.id, status: "SENT", amount: "10.00" },
        { invoiceNumber: `${PREFIX}-3`, organizationId: fixtures.orgA.id, clientId: client.id, status: "OVERDUE", amount: "10.00" },
        { invoiceNumber: `${PREFIX}-4`, organizationId: fixtures.orgA.id, clientId: client.id, status: "PAID", amount: "10.00" },
        { invoiceNumber: `${PREFIX}-5`, organizationId: fixtures.orgA.id, clientId: client.id, status: "CANCELLED", amount: "10.00" },
        // Different Client, same org — must never be counted.
        { invoiceNumber: `${PREFIX}-6`, organizationId: fixtures.orgA.id, clientId: otherClient.id, status: "SENT", amount: "10.00" },
      ],
    });

    const health = await fetchClientHealth(fixtures.orgA.id, client.id, actor);
    expect(health.unpaidInvoiceCount).toBe(3);
  });

  it("open tasks: status != DONE through Client's own Projects only, excludes DONE and another Client's/org's tasks", async () => {
    const client = await createClient(fixtures.orgA.id);
    const otherClient = await createClient(fixtures.orgA.id);
    const foreignOrgClient = await createClient(fixtures.orgB.id);

    const project = await prisma.project.create({
      data: { name: uniqueName(), organizationId: fixtures.orgA.id, clientId: client.id, ownerId: fixtures.owner.id },
    });
    const otherProject = await prisma.project.create({
      data: { name: uniqueName(), organizationId: fixtures.orgA.id, clientId: otherClient.id, ownerId: fixtures.owner.id },
    });
    const foreignProject = await prisma.project.create({
      data: { name: uniqueName(), organizationId: fixtures.orgB.id, clientId: foreignOrgClient.id, ownerId: fixtures.orgBOwner.id },
    });

    await prisma.task.createMany({
      data: [
        { title: `${PREFIX}-todo`, projectId: project.id, organizationId: fixtures.orgA.id, status: "TODO" },
        { title: `${PREFIX}-in-progress`, projectId: project.id, organizationId: fixtures.orgA.id, status: "IN_PROGRESS" },
        { title: `${PREFIX}-done`, projectId: project.id, organizationId: fixtures.orgA.id, status: "DONE" },
        { title: `${PREFIX}-other-client`, projectId: otherProject.id, organizationId: fixtures.orgA.id, status: "TODO" },
        { title: `${PREFIX}-foreign-org`, projectId: foreignProject.id, organizationId: fixtures.orgB.id, status: "TODO" },
      ],
    });

    const health = await fetchClientHealth(fixtures.orgA.id, client.id, actor);
    expect(health.openTaskCount).toBe(2);
  });

  it("active projects: only IN_PROGRESS counts — never PLANNING/ON_HOLD/COMPLETED/CANCELLED — scoped to this client only", async () => {
    const client = await createClient(fixtures.orgA.id);
    const otherClient = await createClient(fixtures.orgA.id);

    await prisma.project.createMany({
      data: [
        { name: `${PREFIX}-planning`, organizationId: fixtures.orgA.id, clientId: client.id, ownerId: fixtures.owner.id, status: "PLANNING" },
        { name: `${PREFIX}-in-progress`, organizationId: fixtures.orgA.id, clientId: client.id, ownerId: fixtures.owner.id, status: "IN_PROGRESS" },
        { name: `${PREFIX}-on-hold`, organizationId: fixtures.orgA.id, clientId: client.id, ownerId: fixtures.owner.id, status: "ON_HOLD" },
        { name: `${PREFIX}-completed`, organizationId: fixtures.orgA.id, clientId: client.id, ownerId: fixtures.owner.id, status: "COMPLETED" },
        { name: `${PREFIX}-cancelled`, organizationId: fixtures.orgA.id, clientId: client.id, ownerId: fixtures.owner.id, status: "CANCELLED" },
        { name: `${PREFIX}-other-client-active`, organizationId: fixtures.orgA.id, clientId: otherClient.id, ownerId: fixtures.owner.id, status: "IN_PROGRESS" },
      ],
    });

    const health = await fetchClientHealth(fixtures.orgA.id, client.id, actor);
    expect(health.activeProjectCount).toBe(1);
  });

  it("last activity: null when there is no timeline history yet, and reflects the most recent item once one exists", async () => {
    const client = await createClient(fixtures.orgA.id);
    // A brand-new Client already has its own CREATED Activity row
    // (createClientAction's own convention) — this one, however, was
    // created directly via prisma.client.create, bypassing that Server
    // Action, so it genuinely has zero Activity/TimelineNote rows yet.
    const emptyHealth = await fetchClientHealth(fixtures.orgA.id, client.id, actor);
    expect(emptyHealth.lastActivityAt).toBeNull();

    const noteCreatedAt = new Date();
    await prisma.timelineNote.create({
      data: { organizationId: fixtures.orgA.id, entityType: "CLIENT", entityId: client.id, authorId: fixtures.owner.id, body: "Note", createdAt: noteCreatedAt },
    });

    const health = await fetchClientHealth(fixtures.orgA.id, client.id, actor);
    expect(health.lastActivityAt?.getTime()).toBe(noteCreatedAt.getTime());
  });
});

describe("Client Profile Hub — relationship tab query isolation", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterAll(async () => {
    // Invoice/Quote/Contract.clientId are all onDelete: Restrict — must
    // be cleared before the Client rows themselves can be deleted (same
    // order delete.test.ts's own afterAll already establishes).
    await prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: PREFIX } } });
    await prisma.quote.deleteMany({ where: { number: { startsWith: PREFIX } } });
    await prisma.contract.deleteMany({ where: { contractNumber: { startsWith: PREFIX } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await cleanupTestData(fixtures);
  });

  async function createClient(organizationId: string) {
    return prisma.client.create({ data: { name: uniqueName(), organizationId, userId: fixtures.owner.id } });
  }

  it("Projects: Client A only receives Client A's own projects, cross-org/cross-client rows excluded, results bounded", async () => {
    const client = await createClient(fixtures.orgA.id);
    const otherClient = await createClient(fixtures.orgA.id);
    const foreignOrgClient = await createClient(fixtures.orgB.id);

    await prisma.project.createMany({
      data: Array.from({ length: CLIENT_TAB_ROW_BOUND + 5 }, (_, i) => ({
        name: `${PREFIX}-p-${i}`,
        organizationId: fixtures.orgA.id,
        clientId: client.id,
        ownerId: fixtures.owner.id,
      })),
    });
    await prisma.project.create({
      data: { name: `${PREFIX}-other-client`, organizationId: fixtures.orgA.id, clientId: otherClient.id, ownerId: fixtures.owner.id },
    });
    await prisma.project.create({
      data: { name: `${PREFIX}-foreign-org`, organizationId: fixtures.orgB.id, clientId: foreignOrgClient.id, ownerId: fixtures.orgBOwner.id },
    });

    const rows = await fetchClientProjects(fixtures.orgA.id, client.id);
    expect(rows).toHaveLength(CLIENT_TAB_ROW_BOUND);
    expect(rows.every((r) => r.name.startsWith(`${PREFIX}-p-`))).toBe(true);
  });

  it("Tasks: Client A only receives tasks from Client A's own projects, cross-org/cross-client tasks excluded, bounded", async () => {
    const client = await createClient(fixtures.orgA.id);
    const otherClient = await createClient(fixtures.orgA.id);
    const project = await prisma.project.create({
      data: { name: uniqueName(), organizationId: fixtures.orgA.id, clientId: client.id, ownerId: fixtures.owner.id },
    });
    const otherProject = await prisma.project.create({
      data: { name: uniqueName(), organizationId: fixtures.orgA.id, clientId: otherClient.id, ownerId: fixtures.owner.id },
    });

    await prisma.task.createMany({
      data: [
        { title: `${PREFIX}-own-1`, projectId: project.id, organizationId: fixtures.orgA.id },
        { title: `${PREFIX}-own-2`, projectId: project.id, organizationId: fixtures.orgA.id },
        { title: `${PREFIX}-other-client`, projectId: otherProject.id, organizationId: fixtures.orgA.id },
      ],
    });

    const rows = await fetchClientTasks(fixtures.orgA.id, client.id);
    expect(rows.map((r) => r.title).sort()).toEqual([`${PREFIX}-own-1`, `${PREFIX}-own-2`]);
    expect(rows.every((r) => r.project.id === project.id)).toBe(true);
  });

  it("Invoices: Client A only receives Client A's own invoices, cross-org/cross-client rows excluded, bounded, each row keeps its own currency", async () => {
    const client = await createClient(fixtures.orgA.id);
    const otherClient = await createClient(fixtures.orgA.id);

    await prisma.invoice.createMany({
      data: [
        { invoiceNumber: `${PREFIX}-inv-1`, organizationId: fixtures.orgA.id, clientId: client.id, amount: "50.00", currency: "USD" },
        { invoiceNumber: `${PREFIX}-inv-2`, organizationId: fixtures.orgA.id, clientId: client.id, amount: "75.00", currency: "EUR" },
        { invoiceNumber: `${PREFIX}-inv-other`, organizationId: fixtures.orgA.id, clientId: otherClient.id, amount: "1.00" },
      ],
    });

    const rows = await fetchClientInvoices(fixtures.orgA.id, client.id);
    expect(rows.map((r) => r.invoiceNumber).sort()).toEqual([`${PREFIX}-inv-1`, `${PREFIX}-inv-2`]);
    const byNumber = new Map(rows.map((r) => [r.invoiceNumber, r]));
    expect(byNumber.get(`${PREFIX}-inv-1`)?.currency).toBe("USD");
    expect(byNumber.get(`${PREFIX}-inv-2`)?.currency).toBe("EUR");
  });

  it("Quotes: Client A only receives Client A's own quotes, cross-client rows excluded, each row keeps its own currency", async () => {
    const client = await createClient(fixtures.orgA.id);
    const otherClient = await createClient(fixtures.orgA.id);

    async function createQuote(number: string, clientId: string, currency: string) {
      return prisma.quote.create({
        data: {
          number,
          status: "DRAFT",
          subtotal: "20.00",
          discountAmount: "0.00",
          taxAmount: "0.00",
          total: "20.00",
          currency,
          organizationId: fixtures.orgA.id,
          createdByUserId: fixtures.owner.id,
          clientId,
        },
      });
    }

    await createQuote(`${PREFIX}-q-1`, client.id, "USD");
    await createQuote(`${PREFIX}-q-2`, client.id, "GBP");
    await createQuote(`${PREFIX}-q-other`, otherClient.id, "USD");

    const rows = await fetchClientQuotes(fixtures.orgA.id, client.id);
    expect(rows.map((r) => r.number).sort()).toEqual([`${PREFIX}-q-1`, `${PREFIX}-q-2`]);
    const byNumber = new Map(rows.map((r) => [r.number, r]));
    expect(byNumber.get(`${PREFIX}-q-1`)?.currency).toBe("USD");
    expect(byNumber.get(`${PREFIX}-q-2`)?.currency).toBe("GBP");
  });

  it("Contracts: Client A only receives Client A's own contracts, cross-client rows excluded, archived contracts included with archivedAt intact", async () => {
    const client = await createClient(fixtures.orgA.id);
    const otherClient = await createClient(fixtures.orgA.id);

    async function createContract(contractNumber: string, clientId: string, archivedAt: Date | null) {
      return prisma.contract.create({
        data: {
          organization: { connect: { id: fixtures.orgA.id } },
          client: { connect: { id: clientId } },
          createdByUser: { connect: { id: fixtures.owner.id } },
          contractNumber,
          title: "Title",
          body: "Body",
          status: "DRAFT",
          archivedAt,
        },
      });
    }

    await createContract(`${PREFIX}-c-active`, client.id, null);
    await createContract(`${PREFIX}-c-archived`, client.id, new Date());
    await createContract(`${PREFIX}-c-other-client`, otherClient.id, null);

    const rows = await fetchClientContracts(fixtures.orgA.id, client.id);
    expect(rows.map((r) => r.contractNumber).sort()).toEqual([`${PREFIX}-c-active`, `${PREFIX}-c-archived`]);
    const byNumber = new Map(rows.map((r) => [r.contractNumber, r]));
    expect(byNumber.get(`${PREFIX}-c-active`)?.archivedAt).toBeNull();
    expect(byNumber.get(`${PREFIX}-c-archived`)?.archivedAt).not.toBeNull();
  });
});
