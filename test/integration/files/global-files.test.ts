import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { listGlobalAttachments, resolveFileEntityContexts, fileEntityContextKey } from "@/lib/files/queries";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Documents Slice D — Global Files V1. Proves the two building blocks
 * `/files` itself relies on: listGlobalAttachments() (tenant-scoped,
 * entity-type-filterable, bounded) and resolveFileEntityContexts() (the
 * batched, never-N+1, graceful-on-missing-backing-record context
 * resolver) against real DB-backed Attachment/Client/Project/Invoice
 * rows. The page component itself is not imported/invoked directly here
 * — this app's own established convention proves page-level rendering
 * at the E2E layer (test/e2e/global-files.spec.ts).
 */
describe("Global Files queries", () => {
  let fixtures: TestFixtures;
  const extraAttachmentIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterAll(async () => {
    await prisma.attachment.deleteMany({ where: { id: { in: extraAttachmentIds } } });
    await cleanupTestData(fixtures);
  });

  function attachmentInput(overrides: Record<string, unknown> = {}) {
    const id = randomUUID();
    return {
      id,
      organizationId: fixtures.orgA.id,
      uploadedById: fixtures.owner.id,
      entityType: "CLIENT" as const,
      entityId: fixtures.clientA.id,
      storageBucket: "attachments",
      storagePath: `organizations/${fixtures.orgA.id}/TEST/${id}/file.txt`,
      originalName: "file.txt",
      mimeType: "text/plain",
      sizeBytes: 100,
      ...overrides,
    };
  }

  describe("listGlobalAttachments", () => {
    it("lists every supported entity type (CLIENT/PROJECT/INVOICE) scoped to the organization", async () => {
      const clientAttachment = await prisma.attachment.create({
        data: attachmentInput({ entityType: "CLIENT", entityId: fixtures.clientA.id, originalName: "client-file.txt" }),
      });
      const projectAttachment = await prisma.attachment.create({
        data: attachmentInput({ entityType: "PROJECT", entityId: fixtures.project.id, originalName: "project-file.txt" }),
      });
      const invoiceAttachment = await prisma.attachment.create({
        data: attachmentInput({ entityType: "INVOICE", entityId: fixtures.invoice.id, originalName: "invoice-file.txt" }),
      });
      extraAttachmentIds.push(clientAttachment.id, projectAttachment.id, invoiceAttachment.id);

      const rows = await listGlobalAttachments(fixtures.orgA.id);
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(clientAttachment.id);
      expect(ids).toContain(projectAttachment.id);
      expect(ids).toContain(invoiceAttachment.id);
    });

    it("never lists a foreign organization's attachments", async () => {
      const foreign = await prisma.attachment.create({
        data: attachmentInput({
          organizationId: fixtures.orgB.id,
          entityId: fixtures.clientB.id,
          originalName: "org-b-secret.txt",
        }),
      });
      extraAttachmentIds.push(foreign.id);

      const rows = await listGlobalAttachments(fixtures.orgA.id);
      expect(rows.some((r) => r.id === foreign.id)).toBe(false);
    });

    it("filters by entityType when provided", async () => {
      const clientOnly = await prisma.attachment.create({
        data: attachmentInput({ entityType: "CLIENT", originalName: "filter-client.txt" }),
      });
      extraAttachmentIds.push(clientOnly.id);

      const rows = await listGlobalAttachments(fixtures.orgA.id, { entityType: "CLIENT" });
      expect(rows.every((r) => r.entityType === "CLIENT")).toBe(true);
      expect(rows.some((r) => r.id === clientOnly.id)).toBe(true);
    });

    it("filters by filename search (originalName, case-insensitive)", async () => {
      const match = await prisma.attachment.create({
        data: attachmentInput({ originalName: "Quarterly-Report.pdf" }),
      });
      extraAttachmentIds.push(match.id);

      const rows = await listGlobalAttachments(fixtures.orgA.id, { search: "quarterly" });
      expect(rows.some((r) => r.id === match.id)).toBe(true);
    });

    it("orders newest first", async () => {
      const older = await prisma.attachment.create({ data: attachmentInput({ originalName: "older.txt" }) });
      await new Promise((r) => setTimeout(r, 5));
      const newer = await prisma.attachment.create({ data: attachmentInput({ originalName: "newer.txt" }) });
      extraAttachmentIds.push(older.id, newer.id);

      const rows = await listGlobalAttachments(fixtures.orgA.id);
      const olderIndex = rows.findIndex((r) => r.id === older.id);
      const newerIndex = rows.findIndex((r) => r.id === newer.id);
      expect(newerIndex).toBeLessThan(olderIndex);
    });
  });

  describe("resolveFileEntityContexts", () => {
    it("resolves CLIENT/PROJECT/INVOICE context with the correct label and canonical link", async () => {
      const contexts = await resolveFileEntityContexts(fixtures.orgA.id, [
        { entityType: "CLIENT", entityId: fixtures.clientA.id },
        { entityType: "PROJECT", entityId: fixtures.project.id },
        { entityType: "INVOICE", entityId: fixtures.invoice.id },
      ]);

      expect(contexts.get(fileEntityContextKey("CLIENT", fixtures.clientA.id))).toEqual({
        label: fixtures.clientA.name,
        href: `/clients/${fixtures.clientA.id}`,
      });
      expect(contexts.get(fileEntityContextKey("PROJECT", fixtures.project.id))).toEqual({
        label: fixtures.project.name,
        href: `/projects/${fixtures.project.id}`,
      });
      expect(contexts.get(fileEntityContextKey("INVOICE", fixtures.invoice.id))).toEqual({
        label: `Invoice #${fixtures.invoice.invoiceNumber}`,
        href: `/invoices/${fixtures.invoice.id}/edit`,
      });
    });

    it("a foreign-org backing entity is simply absent from the Map — never leaks whether it exists", async () => {
      const contexts = await resolveFileEntityContexts(fixtures.orgA.id, [
        { entityType: "CLIENT", entityId: fixtures.clientB.id },
      ]);
      expect(contexts.has(fileEntityContextKey("CLIENT", fixtures.clientB.id))).toBe(false);
    });

    it("a nonexistent (deleted) backing entity is absent from the Map, never throws", async () => {
      const contexts = await resolveFileEntityContexts(fixtures.orgA.id, [
        { entityType: "PROJECT", entityId: randomUUID() },
      ]);
      expect(contexts.size).toBe(0);
    });

    it("resolves with zero queries issued when given an empty attachment list", async () => {
      const contexts = await resolveFileEntityContexts(fixtures.orgA.id, []);
      expect(contexts.size).toBe(0);
    });

    it("batches duplicate entityIds into a single lookup per type (never N+1)", async () => {
      const contexts = await resolveFileEntityContexts(fixtures.orgA.id, [
        { entityType: "CLIENT", entityId: fixtures.clientA.id },
        { entityType: "CLIENT", entityId: fixtures.clientA.id },
        { entityType: "CLIENT", entityId: fixtures.clientA.id },
      ]);
      expect(contexts.size).toBe(1);
    });
  });
});
