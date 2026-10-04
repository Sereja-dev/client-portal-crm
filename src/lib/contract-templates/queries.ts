import "server-only";
import { prisma } from "@/lib/prisma";
import type { ContractTemplate } from "@/generated/prisma/client";
import { isUuid } from "@/lib/validation/lead";
import type { PrismaClientOrTx } from "./types";

/**
 * Contract Templates V1 — read-side queries for the Settings management
 * UI (list/manage) and the apply-prefill helper (apply.ts). Mirrors
 * src/lib/invoice-templates/queries.ts's own identical shape exactly —
 * no `items` include anywhere, since ContractTemplate has no child table
 * at all (a single-row configuration entity, see its own schema
 * comment).
 *
 * Every lookup by id first checks isUuid() and returns null immediately
 * for a malformed id — never lets a non-UUID string reach the database
 * layer. A malformed id, a foreign-org id, and a genuinely nonexistent
 * id are therefore all indistinguishable from each other, matching this
 * codebase's universal "a foreign-org id is indistinguishable from a
 * nonexistent one" doctrine.
 */

export type ListContractTemplatesOptions = {
  /** Defaults to excluding archived rows — same convention as listInvoiceTemplates/listQuoteTemplates. */
  includeArchived?: boolean;
};

/** Deterministic order: name asc, then id asc as a stable tie-break (createdAt can collide at the same millisecond under concurrent creates; id never does). */
export async function listContractTemplates(
  organizationId: string,
  options: ListContractTemplatesOptions = {},
  client: PrismaClientOrTx = prisma,
): Promise<ContractTemplate[]> {
  return client.contractTemplate.findMany({
    where: { organizationId, ...(options.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

/** For management (edit/duplicate/archive/restore) — returned regardless of archived state, since a management UI must still be able to view/restore an archived template. */
export async function getContractTemplateForManagement(
  organizationId: string,
  templateId: string,
  client: PrismaClientOrTx = prisma,
): Promise<ContractTemplate | null> {
  if (!isUuid(templateId)) return null;
  return client.contractTemplate.findFirst({ where: { id: templateId, organizationId } });
}

/**
 * For apply/prefill only — ACTIVE (archivedAt: null) exclusively. An
 * archived template is never returned here, even by a direct, otherwise-
 * valid, same-organization id — this is the one enforcement point
 * apply.ts's own getContractTemplateDefaults() relies on for "applying
 * an archived template must fail server-side."
 */
export async function getActiveContractTemplateForApply(
  organizationId: string,
  templateId: string,
  client: PrismaClientOrTx = prisma,
): Promise<ContractTemplate | null> {
  if (!isUuid(templateId)) return null;
  return client.contractTemplate.findFirst({ where: { id: templateId, organizationId, archivedAt: null } });
}
