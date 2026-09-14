import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { InvoiceStatus, LeadStage } from "@/generated/prisma/enums";

/**
 * Reports Phase 1 — shared row builders for the Reports integration
 * suite. seedTestData()'s own fixtures (test/fixtures/seed.ts) already
 * provide orgA/orgB, owner/admin/member/orgBOwner, clientA/clientB, one
 * Project, one Task, and one DRAFT Invoice — every function here creates
 * ADDITIONAL rows a specific Reports test needs (extra Invoices at
 * specific statuses/currencies/paidAt instants, extra Clients, Leads,
 * TimeEntries) and returns their ids for that test's own explicit
 * cleanup (see cleanupExtraReportsData below).
 *
 * FK order matters: Invoice.clientId is `onDelete: Restrict` (never
 * Cascade/SetNull — see prisma/schema.prisma's own Invoice comment), so
 * any Invoice referencing an extra Client this file creates MUST be
 * deleted before that Client is. cleanupExtraReportsData enforces this
 * order itself so no individual test has to remember it.
 */

export async function createExtraClient(organizationId: string, ownerUserId: string, name: string) {
  return prisma.client.create({ data: { name, organizationId, userId: ownerUserId } });
}

export async function createExtraProject(organizationId: string, clientId: string, ownerUserId: string, name: string) {
  return prisma.project.create({
    data: { name, clientId, organizationId, ownerId: ownerUserId, status: "IN_PROGRESS" },
  });
}

export type ExtraInvoiceInput = {
  organizationId: string;
  clientId: string;
  projectId?: string | null;
  status?: InvoiceStatus;
  amount: string;
  currency?: string;
  paidAt?: Date | null;
  createdAt?: Date;
  issueDate?: Date;
};

export async function createExtraInvoice(input: ExtraInvoiceInput) {
  return prisma.invoice.create({
    data: {
      invoiceNumber: `RPT-${randomUUID().slice(0, 8)}`,
      organizationId: input.organizationId,
      clientId: input.clientId,
      projectId: input.projectId ?? null,
      status: input.status ?? "DRAFT",
      amount: input.amount,
      currency: input.currency ?? "USD",
      paidAt: input.paidAt ?? null,
      issueDate: input.issueDate ?? new Date(),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
}

export type ExtraLeadInput = {
  organizationId: string;
  name?: string;
  stage?: LeadStage;
  value?: string | null;
  createdAt?: Date;
  convertedAt?: Date | null;
  archivedAt?: Date | null;
};

export async function createExtraLead(input: ExtraLeadInput) {
  return prisma.lead.create({
    data: {
      organizationId: input.organizationId,
      name: input.name ?? `Reports Test Lead ${randomUUID().slice(0, 8)}`,
      stage: input.stage ?? "NEW",
      value: input.value ?? null,
      convertedAt: input.convertedAt ?? null,
      archivedAt: input.archivedAt ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
}

export type ExtraTimeEntryInput = {
  organizationId: string;
  projectId?: string | null;
  userId?: string | null;
  durationMinutes: number;
  workDate: Date;
  archivedAt?: Date | null;
};

export async function createExtraTimeEntry(input: ExtraTimeEntryInput) {
  return prisma.timeEntry.create({
    data: {
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      userId: input.userId ?? null,
      durationMinutes: input.durationMinutes,
      workDate: input.workDate,
      archivedAt: input.archivedAt ?? null,
    },
  });
}

/**
 * Deletes every extra row a test created, in FK-safe order: Invoices ->
 * TimeEntries/Leads (no ordering constraint between these two, both
 * independent of everything else here) -> Projects -> Clients. Safe to
 * call with empty arrays. Organization/Client/User fixture rows
 * themselves are left untouched — cleanupTestData() (test/fixtures/seed.ts)
 * owns those.
 */
export async function cleanupExtraReportsData(ids: {
  invoiceIds?: string[];
  timeEntryIds?: string[];
  leadIds?: string[];
  projectIds?: string[];
  clientIds?: string[];
}): Promise<void> {
  if (ids.invoiceIds?.length) {
    await prisma.invoice.deleteMany({ where: { id: { in: ids.invoiceIds } } });
  }
  if (ids.timeEntryIds?.length) {
    await prisma.timeEntry.deleteMany({ where: { id: { in: ids.timeEntryIds } } });
  }
  if (ids.leadIds?.length) {
    await prisma.lead.deleteMany({ where: { id: { in: ids.leadIds } } });
  }
  if (ids.projectIds?.length) {
    await prisma.project.deleteMany({ where: { id: { in: ids.projectIds } } });
  }
  if (ids.clientIds?.length) {
    await prisma.client.deleteMany({ where: { id: { in: ids.clientIds } } });
  }
}
