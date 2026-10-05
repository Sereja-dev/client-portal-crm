import "server-only";
import { prisma } from "@/lib/prisma";
import type { Attachment, AttachmentEntityType } from "@/generated/prisma/client";
import { buildClientResultUrl, buildProjectResultUrl, buildInvoiceResultUrl } from "@/lib/search/result-links";

/**
 * Documents Slice D — Global Files V1. A read-only, tenant-scoped index
 * over the EXISTING Attachment table — no new storage framework, no new
 * upload surface, no CONTRACT entity type (locked spec §5/§6/§7). Reuses
 * Attachment's own already-indexed shape directly
 * (@@index([organizationId, createdAt, id]), prisma/schema.prisma) —
 * exactly the access pattern a global "every file in this org" index
 * needs, with no new index required.
 *
 * No pagination in V1 — a bounded `take`, matching listContracts()'s own
 * identical "no pagination in V1, bounded scale" reasoning
 * (src/lib/contracts/queries.ts) rather than building a cursor the
 * global Files page doesn't yet need.
 */
const GLOBAL_FILES_ROW_BOUND = 200;

export type ListGlobalAttachmentsOptions = {
  entityType?: AttachmentEntityType;
  /** Matches originalName only — never storagePath/storageBucket (never user-facing beyond the file's own display name). */
  search?: string;
};

export async function listGlobalAttachments(
  organizationId: string,
  options: ListGlobalAttachmentsOptions = {},
  client = prisma,
): Promise<Attachment[]> {
  const search = options.search?.trim();
  return client.attachment.findMany({
    where: {
      organizationId,
      ...(options.entityType ? { entityType: options.entityType } : {}),
      ...(search ? { originalName: { contains: search, mode: "insensitive" } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: GLOBAL_FILES_ROW_BOUND,
  });
}

export type FileEntityContext = { label: string; href: string } | null;

/**
 * Batched (never N+1) context resolution for a page of attachments —
 * Attachment.entityId is deliberately not a declared Prisma relation
 * (see Attachment's own schema comment — the same "entityId is not a
 * foreign key" shape Activity/Comment already establish), so this is a
 * hand-written, bounded fan-out: group ids by entityType, issue exactly
 * one additional org-scoped query per supported type, map results back.
 *
 * A key's absence from the returned Map (never a thrown error) is the
 * single, uniform signal for "this attachment's own backing record is
 * foreign-org, deleted, or otherwise unavailable" — the caller renders a
 * neutral "Unavailable" context for a missing key, exactly the same
 * rendering for every one of those three causes, so this never leaks
 * *which* one it was, let alone whether a foreign-org record with that
 * id exists at all.
 *
 * Link hrefs are built from the same allowlisted, per-type templates
 * Global Search already uses (src/lib/search/result-links.ts) — never a
 * second, independently hand-rolled path template.
 */
export async function resolveFileEntityContexts(
  organizationId: string,
  attachments: { entityType: AttachmentEntityType; entityId: string }[],
  client = prisma,
): Promise<Map<string, FileEntityContext>> {
  const key = (entityType: AttachmentEntityType, entityId: string) => `${entityType}:${entityId}`;
  const result = new Map<string, FileEntityContext>();

  const clientIds = [...new Set(attachments.filter((a) => a.entityType === "CLIENT").map((a) => a.entityId))];
  const projectIds = [...new Set(attachments.filter((a) => a.entityType === "PROJECT").map((a) => a.entityId))];
  const invoiceIds = [...new Set(attachments.filter((a) => a.entityType === "INVOICE").map((a) => a.entityId))];

  const [clients, projects, invoices] = await Promise.all([
    clientIds.length > 0
      ? client.client.findMany({ where: { id: { in: clientIds }, organizationId }, select: { id: true, name: true } })
      : Promise.resolve([]),
    projectIds.length > 0
      ? client.project.findMany({ where: { id: { in: projectIds }, organizationId }, select: { id: true, name: true } })
      : Promise.resolve([]),
    invoiceIds.length > 0
      ? client.invoice.findMany({ where: { id: { in: invoiceIds }, organizationId }, select: { id: true, invoiceNumber: true } })
      : Promise.resolve([]),
  ]);

  for (const c of clients) {
    const href = buildClientResultUrl(c.id);
    if (href) result.set(key("CLIENT", c.id), { label: c.name, href });
  }
  for (const p of projects) {
    const href = buildProjectResultUrl(p.id);
    if (href) result.set(key("PROJECT", p.id), { label: p.name, href });
  }
  for (const inv of invoices) {
    const href = buildInvoiceResultUrl(inv.id);
    if (href) result.set(key("INVOICE", inv.id), { label: `Invoice #${inv.invoiceNumber}`, href });
  }

  return result;
}

export function fileEntityContextKey(entityType: AttachmentEntityType, entityId: string): string {
  return `${entityType}:${entityId}`;
}
