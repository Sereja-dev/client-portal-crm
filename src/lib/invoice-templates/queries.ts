import "server-only";
import { prisma } from "@/lib/prisma";
import type { InvoiceTemplate, InvoiceTemplateItem } from "@/generated/prisma/client";
import { isUuid } from "@/lib/validation/lead";
import type { PrismaClientOrTx } from "./types";

/**
 * Invoice Templates V1 — read-side queries for the Settings management UI
 * (list/manage) and the apply-prefill helper (apply.ts). Mirrors
 * src/lib/quote-templates/queries.ts's own identical shape exactly.
 *
 * Every lookup by id first checks isUuid() and returns null immediately
 * for a malformed id — never lets a non-UUID string reach the database
 * layer. A malformed id, a foreign-org id, and a genuinely nonexistent
 * id are therefore all indistinguishable from each other, matching this
 * codebase's universal "a foreign-org id is indistinguishable from a
 * nonexistent one" doctrine.
 */

export type InvoiceTemplateWithItems = InvoiceTemplate & { items: InvoiceTemplateItem[] };

const ITEMS_IN_POSITION_ORDER = { items: { orderBy: { position: "asc" as const } } };

export type ListInvoiceTemplatesOptions = {
  /** Defaults to excluding archived rows — same convention as listQuoteTemplates. */
  includeArchived?: boolean;
};

/** Deterministic order: name asc, then id asc as a stable tie-break (createdAt can collide at the same millisecond under concurrent creates; id never does). Includes items in position order so the list page can show an item count/summary without a second per-row query. */
export async function listInvoiceTemplates(
  organizationId: string,
  options: ListInvoiceTemplatesOptions = {},
  client: PrismaClientOrTx = prisma,
): Promise<InvoiceTemplateWithItems[]> {
  return client.invoiceTemplate.findMany({
    where: { organizationId, ...(options.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    include: ITEMS_IN_POSITION_ORDER,
  });
}

/** For management (edit/duplicate/archive/restore) — returned regardless of archived state, since a management UI must still be able to view/restore an archived template. Includes items in position order. */
export async function getInvoiceTemplateForManagement(
  organizationId: string,
  templateId: string,
  client: PrismaClientOrTx = prisma,
): Promise<InvoiceTemplateWithItems | null> {
  if (!isUuid(templateId)) return null;
  return client.invoiceTemplate.findFirst({
    where: { id: templateId, organizationId },
    include: ITEMS_IN_POSITION_ORDER,
  });
}

/**
 * For apply/prefill only — ACTIVE (archivedAt: null) exclusively. An
 * archived template is never returned here, even by a direct, otherwise-
 * valid, same-organization id — this is the one enforcement point
 * apply.ts's own getInvoiceTemplateDefaults() relies on for "applying an
 * archived template must fail server-side."
 */
export async function getActiveInvoiceTemplateForApply(
  organizationId: string,
  templateId: string,
  client: PrismaClientOrTx = prisma,
): Promise<InvoiceTemplateWithItems | null> {
  if (!isUuid(templateId)) return null;
  return client.invoiceTemplate.findFirst({
    where: { id: templateId, organizationId, archivedAt: null },
    include: ITEMS_IN_POSITION_ORDER,
  });
}
